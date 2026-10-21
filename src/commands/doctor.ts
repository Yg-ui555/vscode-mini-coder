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
import { info, warn } from '../logger';

export async function runDoctor(
  context: vscode.ExtensionContext,
  configManager: ConfigManager,
): Promise<string> {
  const checks: Array<{ name: string; ok: boolean; detail: string }> = [];

  // 1. API Key
  const key = await configManager.getApiKey();
  checks.push({
    name: 'API Key',
    ok: !!key,
    detail: key
      ? `已设置（长度 ${key.length}${configManager.describeEffective().keyFromEnv ? '，来自 .env' : '，来自 SecretStorage'}）`
      : '未设置',
  });

  // 2. 实际生效的配置（.env > 设置界面 > SecretStorage 助手）
  //    ⭐ 修复记录：之前这里只显示 globalState 里向导选的值，
  //      用户在设置界面改 mini-coder.provider 后 /doctor 显示的还是旧值，
  //      完全无法验证配置是否生效。现在显示真正会用的那一组。
  const eff = configManager.describeEffective();
  const pConfig = PROVIDER_CONFIGS[eff.provider];
  checks.push({
    name: '生效配置',
    ok: !!pConfig,
    detail: pConfig
      ? `${eff.provider} → 模型 ${eff.model}\n           地址 ${eff.baseUrl}`
      : `${eff.provider}（未知 provider，检查设置项）`,
  });

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
  const envPath = path.join(context.extensionPath, '.env');
  const envExists = fs.existsSync(envPath);
  checks.push({
    name: '.env 配置',
    ok: true, // .env 不是必须的
    detail: envExists ? '存在（开发时优先于 SecretStorage）' : '不存在（生产模式用 SecretStorage）',
  });

  // 6. ⭐ 工具注册检查 —— 覆盖写文件时如果白名单没配好会在这里暴露
  checks.push(await checkToolRegistration());

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
  if (!key) {
    fixHint += '\n\n💡 设置 API Key：点命令面板 → "Mini-Coder: 设置 API Key"';
  }

  const report = `${summary}\n\n${lines.join('\n')}${fixHint}`;

  info(`Doctor 报告：${failCount === 0 ? '一切正常' : `${failCount} 个问题`}`);
  return report;
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
