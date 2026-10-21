/**
 * 日志封装 - VS Code OutputChannel
 *
 * 原理：VS Code 给每个扩展一个"专属日志窗口"，叫 OutputChannel
 *      类比：扩展的"朋友圈"，每干一件事发一条带时间的记录
 *      出问题能调出来看时间线，不用靠猜
 *
 * 用户怎么看日志：
 *   VS Code 底部 → "输出" 面板 → 下拉选 "Mini-Coder"
 *
 * 一键复制日志：用户按命令 "Mini-Coder: 复制日志" → 全复制到剪贴板 → 粘贴发给我
 */

import * as vscode from 'vscode';

let channel: vscode.OutputChannel | null = null;
// 内存里留一份 buffer，用于"一键复制"
let buffer: string[] = [];
const MAX_BUFFER = 500; // 最多保留 500 条，避免内存爆

/**
 * 初始化日志通道（在 activate 里调一次）
 */
export function initLogger(ch: vscode.OutputChannel) {
  channel = ch;
  buffer = [];
}

/**
 * 拿到通道（给 Copy 命令用）
 */
export function getChannel(): vscode.OutputChannel | null {
  return channel;
}

/**
 * 拿到所有日志文本（给"一键复制"用）
 */
export function getAllLogs(): string {
  return buffer.join('\n');
}

/**
 * 清空日志
 */
export function clearLogs() {
  buffer = [];
  channel?.clear();
}

/**
 * 写一行日志（内部用，自动加时间戳）
 */
function append(level: string, msg: string, e?: any) {
  const ts = new Date().toISOString().slice(11, 19); // HH:MM:SS
  const stack = e?.stack ? `\n  ${e.stack}` : '';
  const line = `[${ts}] [${level}] ${msg}${stack}`;

  // 控制台（给 Node.js 自己看）
  if (level === 'ERROR') console.error(line);
  else if (level === 'WARN') console.warn(line);
  else console.log(line);

  // VS Code 日志窗口（给用户看）
  channel?.appendLine(line);

  // 内存 buffer（给"一键复制"用）
  buffer.push(line);
  if (buffer.length > MAX_BUFFER) buffer.shift(); // 太长了丢最早的
}

/** 普通信息 */
export function info(msg: string) {
  append('INFO', msg);
}

/** 警告（还能跑但要注意） */
export function warn(msg: string, e?: any) {
  append('WARN', msg, e);
}

/** 错误（出事了） */
export function error(msg: string, e?: any) {
  append('ERROR', msg, e);
}
