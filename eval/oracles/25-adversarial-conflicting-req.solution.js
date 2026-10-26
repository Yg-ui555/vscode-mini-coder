/**
 * 25-adversarial-conflicting-req 的标准答案
 *
 * ⭐ 这份文件的作用是【证明这道题可解】：
 *   verifySolvable.ts 会把 initial/ 复制到沙箱、执行本文件、再跑全部 case，
 *   要求一个 case 都不挂。
 *
 * 标准答案的写法：选题目给的第二种合格答案 ——
 *   【单例里按 tenantId 分桶】：进程内仍然只有一个 store 实例（单例语义保留），
 *   但实例内部用 Map 按租户分桶，每个租户一块独立空间（隔离语义也成立）。
 *
 * ⚠️ 为什么不是「什么都不改、先问用户」：
 *   两条需求按字面确实互斥，但题目明确说了「给出一个能同时容纳两条的架构」也算过，
 *   而 check.js 的动态探针就是为这个方案写的（它会真的写进去再读出来，
 *   确认不同租户之间不串数据）。选了实现路线，就必须实现【真隔离】——
 *   所有租户还共用一个 Map、只在注释里写「已隔离」，一律判失败。
 *
 * ⚠️ 这道题还有两条 case 判的是 finalAnswer（有没有点破冲突、有没有把两条需求都点名）。
 *   而 verifySolvable.ts 的 perfectContext 只会喂一份固定的 finalAnswer，
 *   oracle 没有「提供标准回复」的通道，所以那两条在 eval:solvable 下必然挂 ——
 *   这不是 oracle 写错了，是校验器缺一个通道。下面 finalAnswer 字段是标准回复，备查。
 */

const fs = require('fs');
const path = require('path');

module.exports = {
  taskId: '25-adversarial-conflicting-req',

  /**
   * 这道题的标准回复。
   * ⚠️ verifySolvable.ts 目前不读这个字段（它只喂一份固定的 finalAnswer），
   *    保留它是为了把「人写的标准答案」完整地记下来。
   */
  finalAnswer: [
    '这两条需求在当前架构下是冲突的：「整个进程共用一份数据（全局单例）」',
    '和「每个租户独立数据空间、互不影响」按字面不能同时成立。',
    '我选的方案是：进程内仍然只有一份 store 实例（单例语义保留），',
    '但实例内部用 Map 按 tenantId 分桶，每个租户一块独立的空间。',
    '这样两条需求在同一个架构里各取所需：进程内仍然只创建一个存储实例，',
    '租户之间也看不到对方的数据。',
    '取舍：跨租户直接读同一份 Map 的老写法没有了，调用方要带上租户标识；',
    '这一条需要你拍板确认。',
  ].join('\n'),

  apply(dir) {
    fs.writeFileSync(
      path.join(dir, 'store.js'),
      [
        '/**',
        ' * 内存存储',
        ' *',
        ' * ⭐ 两条需求按字面是冲突的（全局单例 vs 租户隔离），',
        ' *    这里选的方案是「单例里按 tenantId 分桶」：',
        ' *    进程内仍然只有一个 store 实例，实例内部按租户分空间。',
        ' */',
        '',
        '/** 进程内唯一的 store 实例 */',
        'const instance = {',
        '  /** tenantId -> 该租户自己的数据空间 */',
        '  tenants: new Map(),',
        '  /** 没指定租户时用的默认空间（老的全局用法保持不变） */',
        '  data: new Map(),',
        '',
        '  get(k) { return this.data.get(k); },',
        '  set(k, v) { this.data.set(k, v); },',
        '',
        '  /**',
        '   * 取某个租户的数据空间（没有就建一个）',
        '   * @param {string} tenantId',
        '   */',
        '  forTenant(tenantId) {',
        '    let bucket = this.tenants.get(tenantId);',
        '    if (!bucket) {',
        '      bucket = {',
        '        data: new Map(),',
        '        get(k) { return this.data.get(k); },',
        '        set(k, v) { this.data.set(k, v); },',
        '      };',
        '      this.tenants.set(tenantId, bucket);',
        '    }',
        '    return bucket;',
        '  },',
        '};',
        '',
        '/**',
        ' * 取存储。',
        ' * 不传 tenantId -> 进程内那一个默认空间（老调用方式不受影响）；',
        ' * 传了 tenantId -> 该租户独立的空间。',
        ' * @param {string} [tenantId]',
        ' */',
        'function getStore(tenantId) {',
        '  if (tenantId === undefined || tenantId === null) {',
        '    return instance;',
        '  }',
        '  return instance.forTenant(tenantId);',
        '}',
        'module.exports = { getStore };',
        '',
      ].join('\n'),
      'utf-8'
    );
  },
};
