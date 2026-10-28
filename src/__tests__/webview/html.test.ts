/**
 * ⭐ 回归测试：Webview HTML 生成
 *
 * ── 这条测试是被一次真实事故逼出来的 ──
 *
 *   2026-10-28：聊天面板打开后【完全空白】。
 *   控制台一片干净，没有任何报错，用户完全不知道发生了什么。
 *
 *   根因链（三层，见 src/webview/html.ts 的完整注释）：
 *     ① VS Code 1.142 把你�� HTML 塞进 sandbox iframe
 *     ② 它只自动重写 CSP 里的 `vscode-resource:` 旧式端点
 *     ③ 而 `webview.cspSource` 的真值是 `'self' https://*.vscode-cdn.net`
 *        —— 硬拼 `${cspSource}` 在版本间会失配，script 被静默拦掉
 *
 *   旧代码的 CSP 里**没有 nonce**，所以一旦域名推断失配，
 *   就没有任何兜底 → 白屏，且无法复现、无法写单测。
 *
 * 这个测试就是那道护栏：它断言"生成的 HTML 一定满足三条硬条件"，
 * 任何一条不满足就红。
 *
 *   ① CSP 里必须有 nonce（不依赖版本相关的域名推断）
 *   ② script / link 的 src 必须是 webview URI，不能还是 ./assets/xxx
 *   ③ 必须有 <base href> 兜底
 */

import { describe, it, expect } from 'vitest';
import { buildWebviewHtml, buildCsp } from '../../webview/html';

/** 模拟真实的 vite 产物（注意有 crossorigin，且用相对路径） */
const VITE_OUTPUT = `<!DOCTYPE html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <title>Mini-Coder Chat</title>
    <script type="module" crossorigin src="./assets/index-abc123.js"></script>
    <link rel="stylesheet" crossorigin href="./assets/index-def456.css">
  </head>
  <body>
    <div id="root"></div>
  </body>
</html>`;

const OPTS = {
  cspSource: `'self' https://*.vscode-cdn.net`,
  nonce: 'TESTNONCE1234567890',
  baseUri: 'https://file+.vscode-resource.vscode-cdn.net/abc',
  resolveResource: (rel: string) => `https://file+.vscode-resource.vscode-cdn.net/abc/${rel}`,
};

describe('buildCsp —— CSP 必须带 nonce', () => {
  it('script-src 必须包含 nonce', () => {
    const csp = buildCsp({ cspSource: OPTS.cspSource, nonce: 'N1' });
    expect(csp).toContain("script-src 'nonce-N1'");
  });

  it('default-src 必须是 none（安全底线）', () => {
    expect(buildCsp({ cspSource: OPTS.cspSource, nonce: 'N1' })).toContain("default-src 'none'");
  });

  it('style-src 必须允许 cspSource + unsafe-inline（webview 需要注入主题变量）', () => {
    const csp = buildCsp({ cspSource: OPTS.cspSource, nonce: 'N1' });
    expect(csp).toContain(`style-src ${OPTS.cspSource} 'unsafe-inline'`);
  });

  it('font-src / connect-src 必须显式声明（default-src none 会把它们一并禁掉）', () => {
    const csp = buildCsp({ cspSource: OPTS.cspSource, nonce: 'N1' });
    expect(csp).toContain('font-src');
    expect(csp).toContain('connect-src');
  });
});

describe('buildWebviewHtml —— 面板白屏回归测试', () => {
  const html = buildWebviewHtml(VITE_OUTPUT, OPTS);

  it('① 注入的 CSP meta 里必须带 nonce', () => {
    expect(html).toContain('http-equiv="Content-Security-Policy"');
    expect(html).toContain(`'nonce-${OPTS.nonce}'`);
  });

  it('① 所有 script 标签都必须带上 nonce', () => {
    const scripts = html.match(/<script[^>]*>/g) ?? [];
    expect(scripts.length).toBeGreaterThan(0);
    for (const s of scripts) {
      expect(s).toContain(`nonce="${OPTS.nonce}"`);
    }
  });

  it('② script 的 src 必须是 webview URI，不能还是 ./assets/xxx', () => {
    // ⭐ 这条最关键：src 还是相对路径 = 资源 404 = 空白面板
    expect(html).not.toContain('src="./assets/');
    expect(html).toContain(
      'src="https://file+.vscode-resource.vscode-cdn.net/abc/assets/index-abc123.js"',
    );
  });

  it('② link 的 href 同样必须是 webview URI', () => {
    expect(html).not.toContain('href="./assets/');
    expect(html).toContain(
      'href="https://file+.vscode-resource.vscode-cdn.net/abc/assets/index-def456.css"',
    );
  });

  it('③ 必须有 <base href> 兜底', () => {
    expect(html).toContain(`<base href="${OPTS.baseUri}/">`);
  });

  it('crossorigin 必须被移除（VS Code webview 不发 CORS 头）', () => {
    expect(html).not.toContain('crossorigin');
  });

  it('幂等：重复处理不会注入第二个 nonce', () => {
    const twice = buildWebviewHtml(html, OPTS);
    const nonceCount = (twice.match(new RegExp(OPTS.nonce, 'g')) ?? []).length;
    // 同一个 nonce 出现多次是正常的（CSP 里一次 + script 标签里一次 + base 无关）
    // 但【每个 script 标签上不能有两个 nonce 属性】
    for (const s of twice.match(/<script[^>]*>/g) ?? []) {
      expect((s.match(/nonce=/g) ?? []).length).toBe(1);
    }
  });

  it('⭐ 回归：旧版那种"没有 nonce 的硬拼 CSP"不允许再出现', () => {
    // 这就是出事那天的写法：把 cspSource 直接拼进去，没有 nonce 兜底
    const legacyCsp = `default-src 'none'; script-src ${OPTS.cspSource} 'self' 'unsafe-inline' 'unsafe-eval';`;
    expect(legacyCsp).not.toContain('nonce-');

    // 新版必须有 nonce —— 两者不能等价
    const newCsp = buildCsp({ cspSource: OPTS.cspSource, nonce: 'X' });
    expect(newCsp).toContain('nonce-');
    expect(newCsp).not.toBe(legacyCsp);
  });

  it('原始 HTML 里如果没有 <head>，也不能崩', () => {
    const weird = '<body><div id="root"></div><script src="./a.js"></script></body>';
    const out = buildWebviewHtml(weird, OPTS);
    // 没有 <head> 就没有地方插 CSP —— 但也不能抛异常
    expect(typeof out).toBe('string');
    expect(out).toContain('nonce=');
  });
});

/**
 * ⭐ 自诊断探针的护栏
 *
 * 白屏故障里最要命的是"React 没挂载 → 证据传不回来"。
 * 探针就是为这种场景准备的，所以它必须：
 *   ① 真的被注入，且带 nonce（否则被 CSP 拦掉）
 *   ② 排在模块脚本【之前】（否则 React 崩了它也没机会跑）
 *   ③ 自己不调 acquireVsCodeApi（一个 webview 只能 acquire 一次）
 */
describe('buildWebviewHtml —— 自诊断探针注入', () => {
  const PROBE = 'window.__miniCoderDiag = { alive: true };';
  const withProbe = buildWebviewHtml(VITE_OUTPUT, { ...OPTS, probeScript: PROBE });

  it('探针必须被注入，且带 nonce', () => {
    expect(withProbe).toContain(`<script nonce="${OPTS.nonce}">${PROBE}</script>`);
  });

  it('探针必须排在模块脚本【之前】', () => {
    const probeAt = withProbe.indexOf(PROBE);
    const moduleAt = withProbe.indexOf('index-abc123.js');
    expect(probeAt).toBeGreaterThan(-1);
    expect(moduleAt).toBeGreaterThan(-1);
    expect(probeAt).toBeLessThan(moduleAt);
  });

  it('探针不得调用 acquireVsCodeApi（抢调会把前端搞崩）', () => {
    expect(PROBE.toLowerCase()).not.toContain('acquirevscodeapi');
  });

  it('没有传 probeScript 时不注入多余脚本', () => {
    const plain = buildWebviewHtml(VITE_OUTPUT, OPTS);
    expect(plain.match(/<script[^>]*>/g)?.length).toBe(1);
  });
});
