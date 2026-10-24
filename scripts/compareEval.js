/**
 * Phase 1 前后对比 —— 把两次评测结果放一起看
 *
 * 用法：
 *   node scripts/compareEval.js <基线json> <改造后json>
 *
 * 例：
 *   node scripts/compareEval.js eval/baselines/baseline-6bb6b92.json eval/results.json
 *
 * 为什么需要这个脚本：
 *   改造前后要对比的维度有 5 个（pass rate / token / 轮数 / 耗时 / 成本），
 *   每次手算容易看漏 —— 而看漏一个就可能得出"优化有效"的错误结论。
 *   这跟本项目「测量工具的 bug 比被测对象更可怕」是同一个道理。
 */

const fs = require('fs');

function load(p) {
  return JSON.parse(fs.readFileSync(p, 'utf-8'));
}

function pct(before, after) {
  if (!before) return after ? '+∞' : '0%';
  const delta = ((after - before) / before) * 100;
  return `${delta >= 0 ? '+' : ''}${delta.toFixed(1)}%`;
}

function main() {
  const [, , basePath, newPath] = process.argv;
  if (!basePath || !newPath) {
    console.error('用法: node scripts/compareEval.js <基线json> <改造后json>');
    process.exit(1);
  }

  const b = load(basePath);
  const n = load(newPath);

  console.log('='.repeat(78));
  console.log('  Phase 1 改造前后对比');
  console.log('='.repeat(78));
  console.log(`  基线: ${basePath}`);
  console.log(`  改造: ${newPath}`);
  console.log(`  模型: ${n.provider} / ${n.model}`);
  console.log('');

  // ── 总览 ──
  console.log('┌─ 总览 ' + '─'.repeat(60));
  const rows = [
    ['Pass Rate', `${b.pass}/${b.total} (${b.passRate}%)`, `${n.pass}/${n.total} (${n.passRate}%)`],
    ['回归失败', `${b.regressed}`, `${n.regressed}`],
    ['总 token', b.totalUsage.totalTokens.toLocaleString(), n.totalUsage.totalTokens.toLocaleString()],
    ['  ├ 输入', b.totalUsage.promptTokens.toLocaleString(), n.totalUsage.promptTokens.toLocaleString()],
    ['  └ 输出', b.totalUsage.completionTokens.toLocaleString(), n.totalUsage.completionTokens.toLocaleString()],
    ['总成本 (¥)', b.totalCost.toFixed(4), n.totalCost.toFixed(4)],
    ['每通过一题 (¥)', (b.costPerPass || 0).toFixed(4), (n.costPerPass || 0).toFixed(4)],
    ['总耗时 (s)', (b.durationMs / 1000).toFixed(1), (n.durationMs / 1000).toFixed(1)],
    ['LLM 调用总数', sumLlmCalls(b), sumLlmCalls(n)],
  ];
  for (const [label, bv, nv] of rows) {
    console.log(`│ ${label.padEnd(22)} ${String(bv).padStart(16)}  →  ${String(nv).padStart(16)}`);
  }
  console.log('└' + '─'.repeat(78));
  console.log('');

  // ── 关键变化幅度 ──
  console.log('┌─ 变化幅度 ' + '─'.repeat(56));
  const changes = [
    ['总 token', b.totalUsage.totalTokens, n.totalUsage.totalTokens, true],
    ['输入 token', b.totalUsage.promptTokens, n.totalUsage.promptTokens, true],
    ['总耗时', b.durationMs, n.durationMs, true],
    ['总成本', b.totalCost, n.totalCost, true],
    ['LLM 调用数', sumLlmCalls(b), sumLlmCalls(n), true],
  ];
  for (const [label, bv, nv, lowerIsBetter] of changes) {
    const delta = pct(bv, nv);
    const good = lowerIsBetter ? (nv <= bv ? '✅' : '⚠️') : (nv >= bv ? '✅' : '⚠️');
    console.log(`│ ${good} ${label.padEnd(16)} ${String(bv).padStart(14)} → ${String(nv).padStart(14)}   ${delta}`);
  }
  console.log('└' + '─'.repeat(78));
  console.log('');

  // ── 逐题对比 ──
  console.log('┌─ 逐题对比 ' + '─'.repeat(56));
  console.log(
    `│ ${'题目'.padEnd(34)} ${'轮数'.padStart(12)} ${'token'.padStart(18)}`,
  );
  const baseMap = new Map((b.results || []).map((r) => [r.id, r]));
  const newMap = new Map((n.results || []).map((r) => [r.id, r]));

  let tokenSavedTotal = 0;
  let roundSavedTotal = 0;

  for (const [id, nr] of newMap) {
    const br = baseMap.get(id);
    if (!br) continue;
    const bt = br.usage?.totalTokens || 0;
    const nt = nr.usage?.totalTokens || 0;
    const brc = br.llmCalls || 0;
    const nrc = nr.llmCalls || 0;
    tokenSavedTotal += bt - nt;
    roundSavedTotal += brc - nrc;

    const verdictMark =
      br.verdict === nr.verdict ? '  ' : (nr.verdict === 'pass' ? '✅' : '❌');
    const idPadded = id.length > 33 ? id.slice(0, 33) : id;
    console.log(
      `│ ${verdictMark} ${idPadded.padEnd(32)} ` +
        `${String(brc).padStart(3)}→${String(nrc).padEnd(3)} ` +
        `${String(bt).padStart(8)}→${String(nt).padEnd(8)} ${pct(bt, nt)}`,
    );
  }
  console.log('└' + '─'.repeat(78));
  console.log('');

  // ── 结论 ──
  console.log('┌─ 结论 ' + '─'.repeat(64));
  const passChanged = b.pass !== n.pass;
  const regGrew = n.regressed > b.regressed;
  console.log(`│ pass rate: ${b.passRate}% → ${n.passRate}%  ${passChanged ? '⚠️ 有变化' : '✅ 持平'}`);
  console.log(`│ 回归失败: ${b.regressed} → ${n.regressed}  ${regGrew ? '⚠️ 新增回归！' : '✅ 未增加'}`);
  console.log(
    `│ token 节省: ${tokenSavedTotal.toLocaleString()} ` +
      `(${pct(b.totalUsage.totalTokens, n.totalUsage.totalTokens)})`,
  );
  console.log(`│ 轮数节省: ${roundSavedTotal} (${pct(sumLlmCalls(b), sumLlmCalls(n))})`);
  console.log(
    `│ 耗时节省: ${((b.durationMs - n.durationMs) / 1000).toFixed(1)}s ` +
      `(${pct(b.durationMs, n.durationMs)})`,
  );
  console.log('└' + '─'.repeat(78));
}

function sumLlmCalls(report) {
  return (report.results || []).reduce((n, r) => n + (r.llmCalls || 0), 0);
}

main();
