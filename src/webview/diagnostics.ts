/**
 * ⭐⭐⭐ Webview 自诊断探针（2026-10-28 实战产物）
 *
 * ─────────────────────────────────────────────────────────────
 * 为什么要做这个
 *
 *   2026-10-28：聊天面板"完全空白"，而且【没有任何报错】：
 *     · 扩展日志里只有一句"5 秒内没收到 ready"
 *     · renderer.log 里没有 CSP 违规、没有 404、没有 fatal-error
 *     · 屏幕上一片黑，什么线索都没有
 *
 *   这是 agent 类 UI 最糟糕的故障形态：
 *     "什么都没发生"和"发生了但看不见"在屏幕上长得一模一样。
 *
 *   根因是【信息在错误的进程里】：
 *     webview 的报错只出现在浏览器的 DevTools 控制台里，
 *     而 DevTools 要人手动打开 → 自动化排障根本无从下手。
 *
 * ─────────────────────────────────────────────────────────────
 * 这个模块解决什么
 *
 *   把 webview 内部的关键信号【搬回扩展进程】，落盘成可读证据：
 *     ① securitypolicyviolation → 脚本被 CSP 拦了（谁被拦、哪个指令）
 *     ② error（捕获阶段）       → 资源加载失败（哪个 URL 挂了）
 *     ③ unhandledrejection      → 前端运行时异常
 *     ④ console.error/warn      → 前端自己打的错
 *     ⑤ 定期快照                → DOM 现状、资源加载记录、主脚本 HTTP 状态
 *
 *   也就是说：以后再出现白屏，
 *   我【不需要你点开 DevTools】，直接读日志就能拿到真因。
 *
 * ─────────────────────────────────────────────────────────────
 * 设计要点
 *
 *   · 探针脚本由扩展在运行时注入，【带 nonce】，
 *     所以它自己也受 CSP 约束 —— 这是故意的：
 *     如果连探针都跑不起来，
 *     那就证明"整个 webview 文档里的脚本一个都没执行"，
 *     这本身就是最强的证据。
 *
 *   · 探针必须在【模块脚本之前】执行，
 *     否则 React 挂载失败的话探针也跟着没了。
 *
 *   · 探针【不能自己调 acquireVsCodeApi】——
 *     VS Code 规定它一个 webview 只能调一次，
 *     调第二次会抛 "An instance of the VS Code API has already been acquired"，
 *     反而把真正的前端搞崩。
 *     所以探针只监听事件，把证据【暂存到 window 上】，
 *     由前端（或扩展的兜底轮询）负责回传。
 */

/** 探针脚本里用到的全局变量名（前后端约定） */
export const DIAG_GLOBAL = '__miniCoderDiag';

/** 探针回传给扩展的消息类型 */
export const DIAG_MESSAGE_TYPE = 'diag_report';

/**
 * 归一化 Webview 发来的消息
 *
 * 为什么需要：探针的兜底通路 `window.parent.postMessage` 送过来的是【字符串】，
 * 而主通路 `acquireVsCodeApi().postMessage` 送的是对象；host 还可能再包一层
 * `{ message: ... }`。不归一化的话 `msg.type` 是 undefined，
 * 消息会在 switch 里被静默丢掉 —— 而这条通路恰恰是"React 没挂载"时唯一的证据来源。
 *
 * @returns 解析后的对象；无法解析时返回 null（调用方直接忽略）
 */
export function normalizeIncomingMessage(raw: any): any {
  let msg = raw;
  if (typeof msg === 'string') {
    try {
      msg = JSON.parse(msg);
    } catch {
      return null;
    }
  }
  if (msg && typeof msg === 'object' && msg.type === undefined && msg.message !== undefined) {
    try {
      msg = typeof msg.message === 'string' ? JSON.parse(msg.message) : msg.message;
    } catch {
      return null;
    }
  }
  return msg;
}

/**
 * 生成注入到 webview 的探针脚本
 *
 * @param nonce 与 CSP 中一致的 nonce
 */
export function buildProbeScript(nonce: string): string {
  return `
(function () {
  var G = ${JSON.stringify(DIAG_GLOBAL)};
  var events = [];
  function push(type, detail) {
    var item = { t: Date.now(), type: type, detail: detail };
    events.push(item);
    try { if (window[G]) { window[G].events = events; } } catch (e) {}
  }
  window[G] = { events: events, alive: true, pushed: push };

  // ① CSP 违规：脚本被拦时浏览器会派发这个事件
  document.addEventListener('securitypolicyviolation', function (e) {
    push('csp_violation', {
      violatedDirective: e.violatedDirective,
      effectiveDirective: e.effectiveDirective,
      blockedURI: e.blockedURI,
      sourceFile: e.sourceFile,
      lineNumber: e.lineNumber,
      sample: e.sample,
    });
  }, true);

  // ② 资源加载失败（404 / 被拦）：必须在捕获阶段才能收到
  window.addEventListener('error', function (e) {
    var d = {
      message: e.message || '',
      filename: e.filename || '',
      lineno: e.lineno || 0,
      colno: e.colno || 0,
    };
    if (e.target && e.target !== window) {
      d.tag = e.target.tagName;
      d.src = e.target.src || e.target.href || '';
    }
    push('error', d);
  }, true);

  // ③ 未处理的 Promise 异常
  window.addEventListener('unhandledrejection', function (e) {
    var r = e.reason;
    push('unhandledrejection', {
      reason: (r && (r.stack || r.message)) || String(r),
    });
  });

  // ④ 前端自己打的 error / warn
  ['error', 'warn'].forEach(function (level) {
    var orig = console[level].bind(console);
    console[level] = function () {
      var args = Array.prototype.map.call(arguments, function (a) {
        if (a && a.stack) return String(a.stack);
        try { return typeof a === 'string' ? a : JSON.stringify(a); }
        catch (e) { return String(a); }
      });
      push('console_' + level, { args: args });
      orig.apply(null, arguments);
    };
  });

  push('probe_alive', {
    location: String(location.href),
    hasAcquire: typeof acquireVsCodeApi === 'function',
    readyState: document.readyState,
  });

  // ⑤ ⭐ 兜底回传通道
  //    为什么需要它：React 挂载失败时，前端那套回传逻辑压根没跑，
  //    证据就永远传不回来 —— 而"React 挂载失败"恰恰是最关键的场景。
  //
  //    做法：探针【不调用】acquireVsCodeApi（那个只能调一次，抢调会把前端搞崩），
  //    而是用 window.parent.postMessage 把证据发给父窗口。
  //    VS Code 的 webview 宿主会把它转成 webview 的 postMessage 事件。
  function broadcast() {
    try {
      var payload = JSON.stringify({ type: 'diag_report', payload: { events: events } });
      window.parent.postMessage(payload, '*');
    } catch (e) {
      // ⚠️ 不能空 catch（2026-10-30 修）：
      //   这条广播是"React 没挂载时【唯一】的证据通路"。
      //   它要是静默失败了，扩展侧一条线索都收不到 ——
      //   而"证据通路本身坏了"恰恰是最该被记录下来的那种故障：
      //   否则下次白屏时，日志里只有"什么都没收到"，依然查不出原因。
      //   所以把失败原因记进 events，下一次广播会把它带出去。
      push('broadcast_error', {
        message: (e && (e.message || e.name)) || String(e),
      });
    }
  }
  window[G].broadcast = broadcast;
  setTimeout(broadcast, 1200);
  setTimeout(broadcast, 3500);

  // ⑥ 定期快照：DOM 现状 + 资源加载记录
  function snapshot() {
    var res = [];
    try {
      performance.getEntriesByType('resource').forEach(function (r) {
        res.push({
          name: r.name,
          initiatorType: r.initiatorType,
          duration: Math.round(r.duration),
          transferSize: r.transferSize,
          decodedBodySize: r.decodedBodySize,
        });
      });
    } catch (e) {}

    var root = document.getElementById('root');
    push('snapshot', {
      resources: res,
      hasRoot: !!root,
      rootChildCount: root ? root.children.length : -1,
      rootHtmlHead: root ? root.innerHTML.slice(0, 300) : '',
      bodyText: (document.body && document.body.innerText || '').slice(0, 200),
      scripts: Array.prototype.map.call(document.scripts, function (s) {
        return {
          src: s.src || '(inline)',
          type: s.type || 'classic',
          nonce: s.nonce || '(none)',
        };
      }),
    });
  }
  window[G].snapshot = snapshot;
  setTimeout(snapshot, 1500);
  setTimeout(snapshot, 4000);
  setTimeout(broadcast, 5000);
})();
`;
}
