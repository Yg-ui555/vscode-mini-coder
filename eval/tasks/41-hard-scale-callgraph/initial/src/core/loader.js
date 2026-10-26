/**
 * 加载器 —— 负责把 job 实现塞进注册表。
 *
 * ⚠️ 内置 handler 和扩展插件是【两套完全不同的加载方式】：
 *
 *    · 内置 handler：在自己的文件里调 register() 自注册，
 *      src/handlers/index.js 负责把各组 require 进来
 *
 *    · 扩展插件：文件自己【不】注册任何人，
 *      是这里在运行期扫目录才发现的
 *
 *   两者最终都会出现在同一个注册表里。
 */
const fs = require('fs');
const path = require('path');
const registry = require('./registry');

/** 扩展插件目录 */
const PLUGIN_DIR = path.join(__dirname, '..', 'extensions');

/** 载入内置 handler（静态 require，编译期就能看见全部） */
function loadCoreHandlers() {
  require('../handlers');
  return registry;
}

/**
 * 载入扩展插件 —— 运行期扫目录。
 *
 * ⚠️ 这里没有任何静态 import 指向插件文件：
 *    顺着 import 链是【找不到】它们的。
 *    只有跑一遍这个函数，才知道当前到底有哪些扩展插件。
 *
 *    插件的命名约定是 *.plugin.js —— 用普通后缀的文件会被跳过。
 */
function loadPlugins() {
  if (!fs.existsSync(PLUGIN_DIR)) return [];
  const loaded = [];
  for (const file of fs.readdirSync(PLUGIN_DIR).sort()) {
    if (!file.endsWith('.plugin.js')) continue;
    const mod = require(path.join(PLUGIN_DIR, file));
    if (!mod || typeof mod.kind !== 'string' || typeof mod.run !== 'function') continue;
    registry.register(mod.kind, mod.run);
    loaded.push(mod.kind);
  }
  return loaded;
}

/** 全量加载 */
function loadAll() {
  loadCoreHandlers();
  loadPlugins();
  return registry;
}

module.exports = { loadCoreHandlers, loadPlugins, loadAll, PLUGIN_DIR };
