/**
 * /doctor 自检命令 - 一键诊断配置问题
 *
 * 类比：手机输入 *#06# 看 IMEI —— 输入 /doctor 看 mini-coder 各项配置是否正常
 *
 * 检查项：
 *   1. API Key 是否设置
 *   2. Provider 是否选了
 *   3. Webview 是否构建了（dist-webview/index.html）
 *   4. Extension 是否编译了（out/extension.js）
 *   5. .env 文件是否存在（开发用）
 *   6. ⭐ 工具是否已注册（判断 activate 有没有跑完）
 *
 * 输出格式：
 *   🎉 一切正常
 *   或
 *   ⚠ 发现 N 个问题
 *   ✅/❌ 项名：详情
 *
 * ⭐ 之前它只挂在 slash command 里，用户根本不知道存在。
 *   现在既是 slash command（/doctor）也是正式 VS Code 命令
 *   （命令面板 → "Mini-Coder: 环境自检"），并且扩展激活时
 *   会在「输出」面板打一条体检日志。
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { ConfigManager, PROVIDER_CONFIGS } from '../config';
import { getApprovalTier, TIER_INFO, blockedToolsIn } from '../agent/tools/approval';
import { info, warn } from '../logger';

export async function runDoctor(
  context: vscode.ExtensionContext,
  configManager: ConfigManager,
): Promise<string> {
  const checks: Array<{ name: string; ok: boolean; detail: string }> = [];

  // ⭐ 0. 先算清"真正会生效的那一套配置"
  //    /doctor 显示的和实际发请求用的必须是同一个 —— 否则就成了"配置项骗用户"。
  const eff = await configManager.getEffective();

  // 1. API Key
  checks.push({
    name: 'API Key',
    ok: !!eff.key,
    detail: eff.key
      ? `已设置（长度 ${eff.key.length}，来自 ${
          eff.keySource === 'env'
            ? `.env → ${eff.envPath ?? '项目根'}`
            : 'SecretStorage（加密存储）'
        }）`
      : eff.foreignSecret
        ? `未设置 —— ⚠️ 加密存储里那把 key 属于 ${
            eff.secretProvider ?? '别的 provider'
          }，当前 provider 是 ${eff.provider}，没有拿来顶替\n           （拿外家 key 硬打只会换来一个没有信息量的 401）\n           💡 解决：命令面板 → "Mini-Coder: 设置 API Key" 换一把`
        : '未设置',
  });

  // 2. 实际生效的配置（设置界面 > .env > provider 默认）
  //    ⭐ 修复记录：之前这里只显示 globalState 里向导选的值，
  //      用户在设置界面改 mini-coder.provider 后 /doctor 显示的还是旧值，
  //      完全无法验证配置是否生效。现在显示真正会用的那一组。
  const pConfig = PROVIDER_CONFIGS[eff.provider];
  checks.push({
    name: '生效配置',
    ok: !!pConfig,
    detail: pConfig
      ? `${eff.provider}（来自${providerSourceLabel(eff.providerSource)}） → 模型 ${eff.model}\n           地址 ${eff.baseUrl}`
      : `${eff.provider}（未知 provider，检查设置项）`,
  });

  // 3. ⭐⭐⭐ API 连通性 —— 真打一次接口，别让用户猜
  checks.push(await probeApi(eff));

  // 3. Webview 构建产物
  const htmlPath = path.join(context.extensionPath, 'dist-webview', 'index.html');
  const webviewBuilt = fs.existsSync(htmlPath);
  checks.push({
    name: 'Webview 构建',
    ok: webviewBuilt,
    detail: webviewBuilt ? 'dist-webview/index.html 存在' : '需要跑 npm run build:webview',
  });

  // 4. Extension 编译产物
  const outPath = path.join(context.extensionPath, 'out', 'extension.js');
  const outBuilt = fs.existsSync(outPath);
  checks.push({
    name: 'Extension 编译',
    ok: outBuilt,
    detail: outBuilt ? 'out/extension.js 存在' : '需要跑 npm run compile',
  });

  // 5. .env 文件（开发用）
  const envPath = eff.envPath;
  checks.push({
    name: '.env 配置',
    ok: true, // .env 不是必须的
    detail: envPath
      ? `已读取：${envPath}`
      : '未找到（用 SecretStorage 里的 key；也可以在工作区根目录放 .env）',
  });

  // 6. ⭐ 工具注册检查 —— 覆盖写文件时如果白名单没配好会在这里暴露
  checks.push(await checkToolRegistration());

  // 7. ⭐ 权限档位 —— 用户最需要随时知道"现在它能对我做什么"
  checks.push(describeApprovalTier());

  // 8. ⭐ 重复调用检测状态（2026-10-24）
  //    让用户能看见"省 token 的机制在工作"，而不只是相信它
  checks.push(describeRepeatGuard());

  // 9. ⭐⭐ Hook 机制状态（2026-10-25）
  //    hook 是用户自己写的脚本，"我配了怎么没生效"是最常见的问题
  checks.push(describeHooks());

  // 输出报告
  const lines = checks.map((c) => {
    const icon = c.ok ? '✅' : '❌';
    return `${icon} **${c.name}**：${c.detail}`;
  });

  const failCount = checks.filter((c) => !c.ok).length;
  const summary =
    failCount === 0
      ? '🎉 一切正常！'
      : `⚠ 发现 ${failCount} 个问题`;

  // 修复提示
  let fixHint = '';
  if (!webviewBuilt) {
    fixHint += '\n\n💡 修复 Webview 构建：在项目根目录跑\n   npm run build:webview';
  }
  if (!outBuilt) {
    fixHint += '\n\n💡 修复 Extension 编译：在项目根目录跑\n   npm run compile';
  }
  if (!eff.key) {
    fixHint += '\n\n💡 设置 API Key：点命令面板 → "Mini-Coder: 设置 API Key"';
  }

  const report = `${summary}\n\n${lines.join('\n')}${fixHint}`;

  info(`Doctor 报告：${failCount === 0 ? '一切正常' : `${failCount} 个问题`}`);
  return report;
}

/** provider 是从哪来的 —— 让用户知道"我改哪里才有用" */
function providerSourceLabel(src: string): string {
  if (src === 'settings') return '设置界面';
  if (src === 'env') return '.env';
  return '上次向导选择';
}

/**
 * ⭐⭐⭐ API 连通性探测（2026-10-29 加）
 *
 *   为什么 /doctor 必须真打一次接口：
 *     原来它只检查"key 有没有设置" —— 但 key 设了不代表能用。
 *     现实里的失败长这样：
 *       401 → key 填错 / 被撤销
 *       402 → key 没问题，【账户没钱】
 *       403 → key 没问题，套餐不覆盖这个模型
 *       404 → key 没问题，模型名写错了
 *       200 → 真的能用
 *     而这四种在用户眼里长得一模一样："插件坏了"。
 *
 *     这次用户就在这上面卡了很久：扩展日志写的是"余额用完"，
 *     界面 toast 却写"配额不足或无权限"，两边对不上，
 *     最后是他自己拿 key 去打接口，才定位到是【账上没钱】。
 *
 *     所以 /doctor 要能一句话回答"到底哪一环坏了"。
 *     代价：一次 max_tokens=1 的请求（几分钱以内）。
 */
export async function probeApi(eff: {
  key?: string;
  baseUrl: string;
  model: string;
  provider: string;
}): Promise<{ name: string; ok: boolean; detail: string }> {  const NAME = 'API 连通性';

  if (eff.provider === 'ollama') {
    return { name: NAME, ok: true, detail: '本地模型（ollama），不需要 key' };
  }
  if (!eff.key) {
    return { name: NAME, ok: false, detail: '没有 key，跳过探测' };
  }

  const url = `${eff.baseUrl.replace(/\/+$/, '')}/chat/completions`;
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${eff.key}`,
      },
      body: JSON.stringify({
        model: eff.model,
        messages: [{ role: 'user', content: 'ping' }],
        max_tokens: 1,
        stream: false,
      }),
    });

    if (resp.ok) {
      return {
        name: NAME,
        ok: true,
        detail: `key 有效、余额充足、模型 ${eff.model} 可用（HTTP ${resp.status}）`,
      };
    }

    const text = await resp.text().catch(() => '');
    const withRaw = (msg: string) => `${msg}\n           服务端原文：${text.slice(0, 160)}`;

    if (resp.status === 401) {
      return {
        name: NAME,
        ok: false,
        detail: withRaw('key 无效或已被撤销（401）—— 重新设置一次 key'),
      };
    }
    if (resp.status === 402) {
      return {
        name: NAME,
        ok: false,
        detail: withRaw(
          '余额不足（402）—— key 是好的！去平台「账户钱包 → 充值」，' +
            '或改用「套餐详情」里的订阅 Key（走套餐额度，不按量扣费）',
        ),
      };
    }
    if (resp.status === 403) {
      return {
        name: NAME,
        ok: false,
        detail: withRaw('无权限（403）—— key 是好的，但当前套餐不包含这个模型'),
      };
    }
    if (resp.status === 404) {
      return {
        name: NAME,
        ok: false,
        detail: withRaw(`模型不存在（404）—— 检查模型名「${eff.model}」`),
      };
    }
    if (resp.status === 429) {
      return { name: NAME, ok: false, detail: withRaw('被限流（429）—— 等一会儿再试') };
    }
    return { name: NAME, ok: false, detail: withRaw(`HTTP ${resp.status}`) };
  } catch (e: any) {
    return { name: NAME, ok: false, detail: `网络错误：${e?.message || e}` };
  }
}

/**
 * 当前权限档位 + 这一档到底拦哪些工具
 *
 * 为什么单列一项：用户问得最多的就是"它现在会不会改我的文件"。
 * /doctor 应该能一句话回答，而不是让人去翻设置界面。
 */
function describeApprovalTier(): { name: string; ok: boolean; detail: string } {
  const tier = getApprovalTier();
  const info_ = TIER_INFO[tier];

  let metas: Record<string, any> = {};
  try {
    const { createDefaultRegistry } = require('../agent/tools/factory');
    const registry = createDefaultRegistry();
    for (const name of registry.names) {
      const tool = (registry as any).get?.(name);
      if (tool?.meta) metas[name] = tool.meta;
    }
  } catch {
    // 拿不到就只显示档位本身
  }

  const blocked = Object.keys(metas).length ? blockedToolsIn(tier, metas) : [];

  return {
    name: '权限档位',
    ok: true, // 任何档位都是合法配置，不算"问题"
    detail:
      `${info_.label} —— ${info_.summary}\n` +
      `           只读工具（read_file / grep / glob / list_dir）在任何档位都不弹窗\n` +
      (blocked.length ? `           本档需要确认：${blocked.join(', ')}` : '           本档不拦截任何工具') +
      `\n           切换：命令面板 → "Mini-Coder: 权限档位"，或点状态栏的权限项`,
  };
}

/**
 * 重复调用检测的状态
 *
 * 为什么要在 /doctor 里展示这个：
 *   重复检测是个【看不见的优化】—— 用户只会感觉到"好像变快了/变便宜了"，
 *   但说不清为什么。把它显式列出来，用户能确认这个机制在工作。
 *
 * 顺便暴露一个设计意图：
 *   "省下来的 token"不是靠少做事，是靠【不重复做事】——
 *   而"不重复"的前提是每次重做都真的有必要。
 */
function describeRepeatGuard(): { name: string; ok: boolean; detail: string } {
  try {
    // 动态 require 避免顶层 import 造成循环依赖
    const { getGuard } = require('../agent/tools/repeatGuard');
    const guard = getGuard();

    const reads = guard.readCount;
    const queries = guard.queryCount;

    return {
      name: '重复调用检测',
      ok: true, // 只是状态展示，不是"问题"
      detail:
        `已记录 ${reads} 个文件读取回执 · ${queries} 个查询签名\n` +
        `           命中时会提示 agent "内容没变，直接用之前的结果"，省掉重复的上下文\n` +
        `           写文件后查询计数会自动失效（结果变了就该重查）`,
    };
  } catch {
    return {
      name: '重复调用检测',
      ok: false,
      detail: '无法读取状态（模块加载失败）',
    };
  }
}

/**
 * Hook 机制状态
 *
 * 为什么单列一项：hook 是【用户自己写的脚本】，
 * 出问题时用户第一个怀疑的就是它 —— "我明明配了，怎么没生效？"
 *
 * /doctor 要能一眼回答三件事：
 *   1. 配置到底有没有被读到（在哪读的）
 *   2. 配了几个事件点、分别是什么
 *   3. 配置本身有没有语法问题
 */
function describeHooks(): { name: string; ok: boolean; detail: string } {
  try {
    // 动态 require 避免顶层 import 造成循环依赖
    const { getHookManager } = require('../agent/hooks/manager');
    const { getDefaultCwd } = require('../agent/tools/paths');
    const mgr = getHookManager(getDefaultCwd());

    const cfgPath = mgr.configPath;
    const problems: string[] = mgr.problems || [];

    if (!cfgPath) {
      return {
        name: 'Hook 机制',
        ok: true, // 没配 hook 是正常状态，不是问题
        detail:
          '未配置 hook（正常）\n' +
          '           想用的话，在工作区放 .vscode/mini-coder-hooks.json\n' +
          '           内置的「测试没过不许收工」用设置项 mini-coder.hooks.stopAutoTest 开启',
      };
    }

    const events = Object.entries(mgr.config.hooks || {})
      .map(([ev, list]) => `${ev}×${(list as any[]).length}`)
      .join(' · ');

    const detail =
      `配置：${cfgPath}\n` +
      `           事件点：${events || '（空）'}\n` +
      (problems.length
        ? `           ⚠️ 配置问题：${problems.join('；')}`
        : '           配置格式正常');

    return { name: 'Hook 机制', ok: problems.length === 0, detail };
  } catch {
    return {
      name: 'Hook 机制',
      ok: false,
      detail: '无法读取状态（模块加载失败）',
    };
  }
}

/** 检查工具能否正常实例化（捕获构造期异常，比如白名单配置错误） */
async function checkToolRegistration(): Promise<{ name: string; ok: boolean; detail: string }> {
  try {
    // 动态 require 避免顶层 import 造成循环依赖
    const { createDefaultRegistry, ALL_TOOL_NAMES } = require('../agent/tools/factory');

    const registry = createDefaultRegistry();
    const names = registry.names;
    const missing = ALL_TOOL_NAMES.filter((n: string) => !names.includes(n));

    const readOnly = names.filter((n: string) =>
      ['read_file', 'grep', 'glob', 'list_dir'].includes(n),
    ).length;

    return {
      name: '工具注册',
      ok: missing.length === 0,
      detail:
        missing.length === 0
          ? `${names.length} 个工具就绪（${readOnly} 只读 + ${names.length - readOnly} 写入/执行）：\n` +
            `           ${names.join(', ')}`
          : `缺少：${missing.join(', ')}`,
    };
  } catch (e: any) {
    return { name: '工具注册', ok: false, detail: `加载失败：${e?.message || e}` };
  }
}

/**
 * 注册为正式 VS Code 命令（命令面板可见）
 * 原来是只有 /doctor slash command，用户不知道它存在
 */
export function registerDoctor(context: vscode.ExtensionContext, configManager: ConfigManager) {
  context.subscriptions.push(
    vscode.commands.registerCommand('mini-coder.doctor', async () => {
      const report = await runDoctor(context, configManager);

      // 弹窗显示（Markdown 语法会被渲染成加粗）
      const action = await vscode.window.showInformationMessage(
        report,
        '查看完整报告',
        '复制报告',
        '重新检查',
      );

      if (action === '复制报告') {
        await vscode.env.clipboard.writeText(report.replace(/\*\*/g, ''));
        vscode.window.showInformationMessage('✓ 报告已复制到剪贴板');
      } else if (action === '查看完整报告') {
        // 输出到 Mini-Coder 面板，方便长报告阅读
        const lines = report.split('\n');
        lines.forEach((l: string) => info(l));
        warn('（完整报告已输出到「输出 → Mini-Coder」面板）');
      }
    }),
  );
}
