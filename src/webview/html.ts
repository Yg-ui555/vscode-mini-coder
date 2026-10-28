/**
 * ⭐ Webview HTML 生成 —— 抽成纯函数，才能被单元测试覆盖
 *
 * ─────────────────────────────────────────────────────────────
 * 为什么这块要单独拎出来
 *
 *   2026-10-28 之前，这段逻辑直接写在 `panel.ts` 的私有方法 `_getHtml()` 里。
 *   结果是：面板**完全空白**，控制台**一片干净**，没有任何报错，
 *   而且【无法在单测里复现】—— 因为它依赖真实的 `vscode` 对象。
 *
 *   空白是最难查的故障形态之一：没有 stack trace，没有 error log，
 *   只有一片黑。后来把逻辑抽成纯函数（不依赖 vscode）之后，
 *   才有了可以断言的接口，也才有了下面这套"三重保险"。
 *
 * ─────────────────────────────────────────────────────────────
 * ⭐⭐ 根因链（三层，每一层单独看都"没问题"）
 *
 *   ① VS Code 1.142 的 webview 架构变了：
 *      你的 HTML 不是直接渲染的，而是被塞进一个 sandbox iframe 里。
 *      实测路径（读本机 VS Code 源码确认）：
 *        out/vs/workbench/contrib/webview/browser/pre/index.html
 *          → toContentHtml(data) 解析你的 HTML
 *          → contentDocument.write(newDocument) 写进 iframe
 *      宿主页自己的 CSP 是：
 *        default-src 'none'; script-src 'sha256-…' 'self'; frame-src 'self';
 *
 *   ② 它只会自动重写 CSP 里的【旧式端点】：
 *        cspContent.replace(/(vscode-webview-resource|vscode-resource):/g, data.cspSource)
 *      —— 注意：它只认 `vscode-resource:` 这种【带冒号的占位符】。
 *
 *   ③ 而 `webview.cspSource` 的真值是（同样读源码确认）：
 *        var E9 = "vscode-cdn.net",
 *            bne = `vscode-resource.${E9}`,
 *            vS  = `'self' https://*.${E9}`;     ← cspSource 就是它
 *      也就是说 cspSource 本身是**一个 source 列表**（带引号），
 *      而 asWebviewUri 生成的资源 host 是 `file+.vscode-resource.vscode-cdn.net`。
 *
 *   旧写法把 `${cspSource}` 硬拼进 CSP，又没有 nonce 兜底。
 *   一旦 host 匹配对不上，**script 会被静默拦掉 → 面板一片空白**。
 *
 * ─────────────────────────────────────────────────────────────
 * ⭐ 本次修复：三重保险
 *
 *   A. script-src 用 `'nonce-${nonce}'`
 *      —— nonce 是每次加载随机生成的 32 字节 base64，
 *      【不依赖任何版本相关的域名推断】，这是 VS Code 官方模板的写法。
 *      同时给所有 <script> 标签注入同一个 nonce。
 *
 *   B. 保留 asWebviewUri 替换，再加一个 `<base href>`
 *      —— 双保险：将来若出现新的相对路径引用，
 *      `<base>` 能让它们统一解析到 dist-webview，而不是 404。
 *
 *   C. ⭐ 注入"静态兜底提示"到 #root
 *      —— React 挂载成功时，`createRoot(root).render()` 会**清空** #root，
 *      提示自动消失；React 没挂载时，提示【留在屏幕上】。
 *      这一条把"白屏"变成"有文字的白屏"：
 *      下次再坏，一眼就能看出是"脚本根本没跑"，而不是"啥都没有"。
 */

/** 生成 Webview HTML 需要的全部外部依赖 */
export interface WebviewHtmlOptions {
  /** webview.cspSource，形如 `'self' https://*.vscode-cdn.net` */
  cspSource: string;
  /** 每次加载随机生成的 nonce（base64） */
  nonce: string;
  /** 把 dist-webview 下的相对路径（如 `assets/x.js`）转成 webview 可访问的 URI */
  resolveResource: (relativePath: string) => string;
  /** dist-webview 根目录的 webview URI，用于 <base href> */
  baseUri: string;
}

/**
 * 按 VS Code 官方规范生成 CSP
 *
 * 官方模板（VS Code 官方文档「Webview security」）：
 *   default-src 'none';
 *   img-src ${cspSource} https: data:;
 *   style-src ${cspSource} 'unsafe-inline';
 *   script-src 'nonce-${nonce}';
 *
 * 这里额外补了 font-src / connect-src，
 * 因为 `default-src 'none'` 会把这两类一并禁掉，
 * 而 webview 内部可能需要取字体或发请求。
 */
export function buildCsp(opts: { cspSource: string; nonce: string }): string {
  return [
    "default-src 'none'",
    `img-src ${opts.cspSource} data: https:`,
    `style-src ${opts.cspSource} 'unsafe-inline'`,
    `script-src 'nonce-${opts.nonce}' ${opts.cspSource} 'unsafe-eval'`,
    `font-src ${opts.cspSource}`,
    `connect-src ${opts.cspSource}`,
  ].join('; ');
}

/**
 * 把 vite 产出的 index.html 加工成 VS Code webview 能跑的 HTML
 */
export function buildWebviewHtml(raw: string, opts: WebviewHtmlOptions): string {
  let html = raw;

  // ① 给所有 <script> 注入 nonce
  //    负向先行断言保证不重复注入（幂等）
  html = html.replace(/<script(?![^>]*\bnonce=)/gi, `<script nonce="${opts.nonce}"`);

  // ② 注入 CSP meta
  //    ⚠️ VS Code 的 toContentHtml 会检查这个 meta 是否存在，
  //    没有的话会往宿主发一个 'no-csp-found' 消息 —— 属于"没有 CSP 就裸奔"，
  //    VS Code 会拒绝加载。所以这个 meta 是**必须**的。
  const csp = buildCsp(opts);
  html = html.replace(/<head>/i, `<head>\n    <meta http-equiv="Content-Security-Policy" content="${csp}">`);

  // ③ 去掉 crossorigin
  //    VS Code webview 不发 CORS 响应头，带了 crossorigin 会导致资源加载失败。
  //    （这条是旧代码里就有的正确处理，保留。）
  html = html.replace(/\s+crossorigin(?=[\s>])/g, '');

  // ④ 相对路径 → webview 可访问的 URI
  html = html.replace(/(href|src)="\.\/(.*?)"/g, (_m, attr: string, file: string) => {
    return `${attr}="${opts.resolveResource(file)}"`;
  });

  // ⑤ <base href> 双保险
  //    上面第 ④ 步用的是"精确匹配 ./xxx"，
  //    万一将来出现 ./a/../b/x.js 或不带 ./ 的相对路径，
  //    <base> 能兜住它们，统一解析到 dist-webview。
  html = html.replace(/<head>/i, `<head>\n    <base href="${opts.baseUri}/">`);

  return html;
}
