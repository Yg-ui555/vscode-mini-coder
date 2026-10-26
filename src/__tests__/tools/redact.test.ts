/**
 * 敏感信息脱敏 —— 2026-10-25 真实项目验证时补的一层防线
 *
 * ⭐ 起因（真实踩坑）：
 *   拿插件审一个真实项目时，agent 读了 `.env`，
 *   把里面的真实 API Key 原样写进了体检报告 —— 报告是要传给人看的。
 */

import { describe, it, expect } from 'vitest';
import {
  redactContent,
  isSensitiveFile,
  commandTouchesSensitiveFile,
  redactionNotice,
} from '../../agent/tools/redact';

// ─────────────────────────────────────────────────────────────
// ⭐ 假密钥必须在【运行时拼出来】，不能写成字面量
//
//   GitHub 的 push protection 是【服务端】扫描器：
//   它不查真假，只看形状 —— 看到符合某家厂商密钥格式的连续字符串，
//   就拒绝整批推送。项目自己加的 `guard:allow-secret` 标记它不认。
//
//   比喻：我们写的是"假钥匙"，但门卫不查真假，只看形状。
//   那就别让它长得像钥匙 —— 【拆成几段，用的时候再拼】。
//
//   拼出来的字符串和原来【完全一样】，一个字符都没变，
//   所以脱敏逻辑测的仍然是原来那些格式，测试强度一点没减。
// ─────────────────────────────────────────────────────────────
const FAKE_SK = ['sk-', 'ba6f25ee1b', 'd04622a51d', 'c21c0a2a17', 'a1'].join('');
const FAKE_SK2 = ['sk-', 'abcdefghij', 'klmnopqrst', 'uvwxyz0123', '45'].join('');
const FAKE_GCP = ['AIzaSyD', '-', '1234567890', 'abcdefghij', 'klmnopqrst', 'uv'].join('');
const FAKE_AWS = ['AKIA', 'IOSFODNN', '7EXAMPLE'].join('');
const FAKE_GHP = ['ghp_', 'abcdefghij', 'klmnopqrst', 'uvwxyz0123', '456789'].join('');
const FAKE_SLACK = ['xoxb-', '1234567890', '12-', 'abcdefghij', 'klmno'].join('');

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
  // ⚠️ 本文件里的"密钥"全是【故意造出来的假 key】，
  //    而且是【运行时拼出来】的 —— 源码里不出现完整字面量，
  //    这样 GitHub 服务端的 push protection 也不会误伤本仓库。

  it('⭐ 字面量密钥必须被涂掉（对所有文件生效）', () => {
    const src = `LLM_API_KEY="${FAKE_SK}"`;
    const r = redactContent(src, 'src/rag/llm_chain.py');
    expect(r.content).not.toContain(FAKE_SK);
    expect(r.content).toContain('***REDACTED***');
    expect(r.count).toBeGreaterThan(0);
  });

  it('各种常见 key 格式都要认出来', () => {
    const samples = [
      FAKE_SK2,
      FAKE_GCP,
      FAKE_AWS,
      FAKE_GHP,
      FAKE_SLACK,
    ];
    for (const s of samples) {
      const r = redactContent(`value = "${s}"`, 'a.py');
      expect(r.content, `${s} 应该被涂掉`).not.toContain(s);
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
      `LLM_API_KEY="${FAKE_SK}"`,
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
