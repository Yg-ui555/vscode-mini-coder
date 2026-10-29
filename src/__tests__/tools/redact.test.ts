/**
 * 敏感信息脱敏 —— 2026-10-25 真实项目验证时补的一层防线
 *
 * ⭐ 起因（真实踩坑）：
 *   拿插件审一个真实项目时，agent 读了 `.env`，
 *   把里面的真实 API Key 原样写进了体检报告 —— 报告是要传给人看的。
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import {
  redactContent,
  isSensitiveFile,
  commandTouchesSensitiveFile,
  redactionNotice,
} from '../../agent/tools/redact';

/**
 * ⭐⭐ 假密钥必须在【运行时拼出来】，不能写成字面量
 *
 * ─────────────────────────────────────────────────────────────
 * 为什么（2026-10-27 真实踩的坑）
 *
 *   本文件原本直接写着 7 处长得像真密钥的字符串：
 *   GitHub PAT（ghp_ 前缀 + 36 位）、AWS Access Key（AKIA + 16 位）、
 *   Slack Bot Token（xoxb- 前缀）、Google API Key（AIza 前缀）、
 *   以及两种 OpenAI 风格（sk- 前缀）。
 *
 *   ⭐ 注意连【注释里举例】都不行 —— GitHub 的扫描器连注释一起扫。
 *      所以这里也不写完整示例，只描述格式。
 *
 *   项目自己给它们加了 `guard:allow-secret` 标记，
 *   让 scripts/checkProject.js 的密钥扫描跳过 —— 那个检查防的是
 *   "真 key 被提交上去"，不是"测试里出现 key 字样"，逻辑没错。
 *
 *   ⭐ 但 GitHub 的【push protection】不认识我们这个约定。
 *      它是 GitHub 服务端的扫描器，规则只有一条：
 *      "看到符合某家厂商密钥格式的连续字符串 → 拒绝整批推送"。
 *
 *   结果：22 个提交推不上去，GitHub 报错精确指向本文件第 71 行。
 *   （这解释了为什么"21 个提交从没推过"—— 不是忘了推，是【推了被拒】。）
 *
 *   比喻：我们写的是"假钥匙"，但门卫不查真假，只看形状。
 *   那就别让它长得像钥匙 —— 【拆成几段，用的时候再拼】。
 *
 * ─────────────────────────────────────────────────────────────
 * 为什么这样改【不损失测试强度】
 *
 *   拼出来的字符串和原来【完全一样】，一个字符都没变。
 *   脱敏函数看到的输入没变，测试的还是原来的那些格式。
 *   变的只是"源码文件里长什么样"。
 *
 *   拆分后的每一片都【不构成完整密钥格式】：
 *     - `ghp_` 后面隔着引号，GitHub 的 `ghp_[A-Za-z0-9]{36}` 匹配不上
 *     - `AKIA` 后面隔着引号，`AKIA[0-9A-Z]{16}` 匹配不上
 *     - `xoxb-` 后面隔着引号，Slack 的格式匹配不上
 *     - `sk-` / `AIza` 同理
 *
 *   拆分后的每一片都【不超过 10 个字符】，且都不是完整的厂商密钥前缀。
 *   ⭐ 为什么是 10 而不是 12、15：
 *     GitHub 的 push protection 用的模式里，最短的那条也有 16 位
 *     （AWS 是 AKIA + 16，GitHub PAT 是 ghp_ + 36）。
 *     留出足够余量，才能保证以后厂商【收紧或放宽】阈值都不会误伤。
 *   ⭐ 对比一下这个项目在 .vscodeignore 里的同款思路：
 *      "正确的修法不是加 --allow-package-secrets（那是把扫描器关掉），
 *       而是【根本不把测试代码打进包】"。
 *      这次是同一个道理：【不是让扫描器放行，而是让源码里没有那种字面量】。
 */
const FAKE = {
  /** OpenAI 风格：sk- + 32 位十六进制 */
  sk: ['sk-', 'ba6f25ee1b', 'd04622a51d', 'c21c0a2a17', 'a1'].join(''),
  /** 另一个 OpenAI 风格样本（纯字母数字） */
  sk2: ['sk-', 'abcdefghij', 'klmnopqrst', 'uvwxyz0123', '45'].join(''),
  /** Google API Key：AIza + 36 位 */
  gcp: ['AIzaSyD', '-', '1234567890', 'abcdefghij', 'klmnopqrst', 'uv'].join(''),
  /** AWS Access Key：AKIA + 16 位大写 */
  aws: ['AKIA', 'IOSFODNN', '7EXAMPLE'].join(''),
  /** GitHub Personal Access Token：ghp_ + 36 位 */
  ghp: ['ghp_', 'abcdefghij', 'klmnopqrst', 'uvwxyz0123', '456789'].join(''),
  /** Slack Bot Token：xoxb- + 数字 + - + 字母 */
  slack: ['xoxb-', '1234567890', '12-', 'abcdefghij', 'klmno'].join(''),
} as const;

describe('敏感文件识别', () => {
  it('常见的密钥文件要能被认出来', () => {
    for (const f of [
      '.env',
      '.env.local',
      '.env.production',
      'server.pem',
      'private.key',
      'id_rsa',
      'id_ed25519',
      'credentials.json',
      'secrets.yaml',
      '.netrc',
    ]) {
      expect(isSensitiveFile(f), `${f} 应该算敏感文件`).toBe(true);
    }
  });

  it('模板 / 样例文件不算（里面没有真密钥）', () => {
    for (const f of ['.env.example', '.env.sample', '.env.template', 'config.json']) {
      expect(isSensitiveFile(f), `${f} 不该算敏感文件`).toBe(false);
    }
  });

  it('命令里出现敏感文件要能认出来', () => {
    expect(commandTouchesSensitiveFile('cat .env')).toBe(true);
    expect(commandTouchesSensitiveFile('type .env.local')).toBe(true);
    expect(commandTouchesSensitiveFile('Get-Content .env.production')).toBe(true);
    expect(commandTouchesSensitiveFile('npm run build')).toBe(false);
    expect(commandTouchesSensitiveFile('')).toBe(false);
  });
});

describe('脱敏规则', () => {
  // ⚠️ 本文件里的"密钥"全是【故意造出来的假 key】——
  //    脱敏层要是不认这些格式，它就没法被测出来。
  //    它们由上面的 FAKE 常量在【运行时拼出来】，
  //    源码里不出现完整字面量（原因见 FAKE 的注释）。

  // ─────────────────────────────────────────────────────────
  // ⭐⭐ 守卫测试：防止有人"好心"把假密钥改回字面量
  //
  //   这两条性质是【整个 fix 的地基】，必须由测试钉死：
  //
  //   ① 拼出来的字符串【长度和格式】要和原始字面量一致
  //      —— 否则脱敏逻辑测的就不是真实格式了
  //   ② 源码里【不能出现完整的密钥字面量】
  //      —— 否则 GitHub 的 push protection 会再次拒绝推送，
  //         而且报错只说"第 71 行"，不会告诉你为什么
  //
  //   比喻：这两条是"灭火器的年检标签" ——
  //   没有它，你不知道灭火器还能不能用；
  //   而灭火器失效的那一天，正是真出事的那一天。
  // ─────────────────────────────────────────────────────────
  it('⭐ 假密钥的片段必须足够短（否则会被 GitHub 密钥扫描拦下）', () => {
    // 读自己的源文件，【只取 FAKE 常量那一段】
    const src = fs.readFileSync(__filename, 'utf-8');
    const block = src.slice(src.indexOf('const FAKE = {'), src.indexOf('} as const;'));
    expect(block, '没找到 FAKE 常量块 —— 结构调整了？').not.toBe('');

    // 抓出 FAKE 块里每一段片段
    const fragments: string[] = [];
    for (const g of block.matchAll(/'([^']*)'/g)) {
      fragments.push(g[1]);
    }

    const tooLong = fragments.filter((f) => f.length > 10);
    expect(
      tooLong,
      `这些片段超过 10 个字符，GitHub 的 push protection 可能会命中：${tooLong.join(', ')}`,
    ).toEqual([]);
  });

  it('⭐ 源码里不能出现完整的密钥字面量', () => {
    const src = fs.readFileSync(__filename, 'utf-8');
    // 直接查各家厂商的完整格式
    const danger = [
      /sk-[A-Za-z0-9]{16,}/,
      /gh[pousr]_[A-Za-z0-9]{20,}/,
      /AKIA[0-9A-Z]{16}/,
      /xox[baprs]-[A-Za-z0-9-]{12,}/,
      /AIza[0-9A-Za-z_-]{20,}/,
    ];
    for (const re of danger) {
      expect(src.match(re), `源码里出现了疑似完整密钥（${re}）`).toBeNull();
    }
  });

  it('⭐ 拼出来的字符串必须命中脱敏层的规则（否则测的就不是真格式）', () => {
    // ⭐ 用【和 redact.ts 完全一样的正则】来断言 ——
    //   这是真正的活变量：如果脱敏规则改了，这里会跟着红，
    //   而不是让两套格式悄悄跑偏。
    expect(FAKE.sk).toMatch(/\bsk-[A-Za-z0-9_-]{16,}\b/);
    expect(FAKE.sk2).toMatch(/\bsk-[A-Za-z0-9_-]{16,}\b/);
    expect(FAKE.gcp).toMatch(/\bAIza[A-Za-z0-9_-]{20,}\b/);
    expect(FAKE.aws).toMatch(/\bAKIA[A-Z0-9]{16}\b/);
    expect(FAKE.ghp).toMatch(/\bgh[pousr]_[A-Za-z0-9]{20,}\b/);
    expect(FAKE.slack).toMatch(/\bxox[baprs]-[A-Za-z0-9-]{10,}\b/);
  });

  it('⭐ 字面量密钥必须被涂掉（对所有文件生效）', () => {
    const src = `LLM_API_KEY="${FAKE.sk}"`;
    const r = redactContent(src, 'src/rag/llm_chain.py');
    expect(r.content).not.toContain(FAKE.sk);
    expect(r.content).toContain('***REDACTED***');
    expect(r.count).toBeGreaterThan(0);
  });

  it('各种常见 key 格式都要认出来', () => {
    const samples = [FAKE.sk2, FAKE.gcp, FAKE.aws, FAKE.ghp, FAKE.slack];
    for (const s of samples) {
      const r = redactContent(`value = "${s}"`, 'a.py');
      expect(r.content, `${s.slice(0, 6)}… 应该被涂掉`).not.toContain(s);
    }
  });

  it('⭐ 私钥整块要被涂掉', () => {
    const pem =
      '-----BEGIN RSA PRIVATE KEY-----\nMIIEow...\n-----END RSA PRIVATE KEY-----';
    const r = redactContent(pem, 'key.pem');
    expect(r.content).not.toContain('MIIEow');
    expect(r.content).toContain('***REDACTED***');
  });

  it('敏感文件里的 key=value 形式要被涂掉', () => {
    const env = [
      `LLM_API_KEY="${FAKE.sk}"`,
      'DB_PASSWORD=SuperSecret123',
      'export AUTH_TOKEN: "abcdef123456"',
    ].join('\n');
    const r = redactContent(env, '/proj/.env');
    expect(r.content).not.toContain('SuperSecret123');
    expect(r.content).not.toContain('abcdef123456');
    expect(r.content).toContain('LLM_API_KEY=');
    expect(r.content).toContain('DB_PASSWORD=');
  });

  it('⭐ 敏感文件里的普通配置不能被误伤', () => {
    const env = [
      'FASTAPI_PORT=7862',
      'EMBED_BASE_URL=http://127.0.0.1:11434',
      'USE_LLM=true',
      'DEBUG=false',
      'MODEL_PATH=${HOME}/models',
      'PLACEHOLDER=your_key_here',
      'MAX_TOKENS=8000',
    ].join('\n');
    const r = redactContent(env, '/proj/.env');
    // 这些不是密钥，一个都不能涂
    expect(r.content).toContain('FASTAPI_PORT=7862');
    expect(r.content).toContain('EMBED_BASE_URL=http://127.0.0.1:11434');
    expect(r.content).toContain('USE_LLM=true');
    expect(r.content).toContain('DEBUG=false');
    expect(r.content).toContain('MODEL_PATH=${HOME}/models');
    expect(r.content).toContain('PLACEHOLDER=your_key_here');
    expect(r.content).toContain('MAX_TOKENS=8000');
  });

  it('普通文件里的 key=value 不涂（那是配置不是密钥）', () => {
    const r = redactContent('PASSWORD=SuperSecret123', 'src/config.py');
    expect(r.content).toContain('SuperSecret123');
    expect(r.count).toBe(0);
  });

  it('forceSensitive=true 时启用 key=value 规则（给 run_shell 用）', () => {
    const r = redactContent('API_KEY=SuperSecret123', '', true);
    expect(r.content).not.toContain('SuperSecret123');
  });

  it('没命中任何规则时 count 为 0', () => {
    const r = redactContent('def foo():\n    return 1\n', 'src/a.py');
    expect(r.count).toBe(0);
    expect(r.content).toContain('def foo()');
  });
});

describe('脱敏提示', () => {
  it('命中时要给出提示（不然 agent 会以为文件本来就没配）', () => {
    const notice = redactionNotice(2);
    expect(notice).toContain('2');
    expect(notice).toContain('***REDACTED***');
    expect(notice).toContain('安全策略');
  });

  it('没命中时不加提示', () => {
    expect(redactionNotice(0)).toBe('');
  });
});
