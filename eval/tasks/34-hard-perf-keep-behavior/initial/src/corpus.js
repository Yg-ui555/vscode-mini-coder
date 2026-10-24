/**
 * 语料库
 *
 * ⚠️ 本题目标：性能优化。
 *
 * ⚠️⚠️ 这份数据一个字都不许改 ——
 *    改了它，"行为不变"这件事就没法验证了。
 */

const TOPICS = ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon', 'Zeta', 'Eta', 'Theta'];
const KINDS = ['Guide', 'Note', 'Report', 'Summary', 'Plan', 'Log'];
const CORPUS_SIZE = 20000;

function buildCorpus() {
  const out = new Array(CORPUS_SIZE);
  for (let i = 0; i < CORPUS_SIZE; i++) {
    const t1 = TOPICS[i % TOPICS.length];
    const t2 = TOPICS[(i * 3) % TOPICS.length];
    const t3 = TOPICS[(i * 5) % TOPICS.length];
    const t4 = TOPICS[(i * 7) % TOPICS.length];
    const kind = KINDS[(i * 11) % KINDS.length];

    const body = (
      `The ${t1} ${kind} covers ${t2} and ${t3} in detail; ` +
      `Read this before touching ${t4}. ` +
      `Related topics: ${t1}, ${t2}, ${t3}, ${t4}. ` +
      `Owner team ${t3}-${kind}. ` +
      `Last reviewed by the ${t2} group. ` +
      `See also ${t4} ${kind} and ${t1} ${kind}. ` +
      `Summary: ${kind} for ${t1} and ${t2}. `
    ).repeat(2);

    out[i] = {
      id: `doc-${i}`,
      title: `${t1} ${kind} ${t2}`,
      body,
      status: i % 11 === 0 ? 'draft' : 'published',
      tags: [t1.toLowerCase(), t3.toLowerCase()],
    };
  }
  return out;
}

const CORPUS = buildCorpus();

module.exports = { CORPUS, CORPUS_SIZE };
