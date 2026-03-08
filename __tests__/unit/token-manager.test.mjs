/**
 * Unit tests for lib/token-manager.js
 *
 * Tests locked read-modify-write of village-tokens.json:
 *   read, update, generate, revoke, concurrent safety.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// token-manager reads DATA_DIR from env at module load time.
// We set VILLAGE_DATA_DIR before importing so each suite gets its own dir.

let tmpDir;
let tokenManager;

async function freshManager() {
  tmpDir = await mkdtemp(join(tmpdir(), 'vtk-test-'));
  process.env.VILLAGE_DATA_DIR = tmpDir;
  // Force fresh module load by appending a query param (Node ESM cache-busting)
  const url = new URL('../../lib/token-manager.js', import.meta.url);
  url.searchParams.set('bust', Date.now().toString());
  tokenManager = await import(url.href);
}

afterEach(async () => {
  if (tmpDir) await rm(tmpDir, { recursive: true, force: true });
  tmpDir = null;
});

describe('token-manager read()', () => {
  it('returns {} when file does not exist', async () => {
    await freshManager();
    const data = await tokenManager.read();
    expect(data).toEqual({});
  });

  it('parses existing tokens file', async () => {
    await freshManager();
    const { writeFile } = await import('node:fs/promises');
    await writeFile(tokenManager.TOKENS_FILE,
      JSON.stringify({ vtk_abc: { botName: 'alice', displayName: 'Alice' } }) + '\n',
      { mode: 0o600 }
    );
    const data = await tokenManager.read();
    expect(data['vtk_abc'].botName).toBe('alice');
    expect(data['vtk_abc'].displayName).toBe('Alice');
  });
});

describe('token-manager update()', () => {
  it('creates file with {} if it does not exist', async () => {
    await freshManager();
    await tokenManager.update((tokens) => { tokens.vtk_x = { botName: 'bob' }; });
    const raw = await readFile(tokenManager.TOKENS_FILE, 'utf8');
    const data = JSON.parse(raw);
    expect(data.vtk_x.botName).toBe('bob');
  });

  it('reads existing file and mutates in place', async () => {
    await freshManager();
    await tokenManager.update((tokens) => { tokens.vtk_a = { botName: 'alice' }; });
    await tokenManager.update((tokens) => { tokens.vtk_b = { botName: 'bob' }; });
    const data = await tokenManager.read();
    expect(data.vtk_a.botName).toBe('alice');
    expect(data.vtk_b.botName).toBe('bob');
  });

  it('supports mutator returning a new object', async () => {
    await freshManager();
    await tokenManager.update(() => ({ vtk_new: { botName: 'charlie' } }));
    const data = await tokenManager.read();
    expect(data.vtk_new.botName).toBe('charlie');
  });

  it('handles corrupt JSON by using empty object', async () => {
    await freshManager();
    const { writeFile, mkdir } = await import('node:fs/promises');
    await mkdir(tmpDir, { recursive: true });
    await writeFile(tokenManager.TOKENS_FILE, 'not valid json', { mode: 0o600 });
    await tokenManager.update((tokens) => { tokens.vtk_x = { botName: 'dave' }; });
    const data = await tokenManager.read();
    expect(data.vtk_x.botName).toBe('dave');
  });

  it('sequential updates are serialized without data loss', async () => {
    await freshManager();
    for (let i = 0; i < 5; i++) {
      await tokenManager.update((tokens) => {
        tokens[`vtk_seq_${i}`] = { botName: `bot${i}` };
      });
    }
    const data = await tokenManager.read();
    for (let i = 0; i < 5; i++) {
      expect(data[`vtk_seq_${i}`].botName).toBe(`bot${i}`);
    }
  });

  it('concurrent updates do not lose data', async () => {
    await freshManager();
    await Promise.all([
      tokenManager.update((tokens) => { tokens.vtk_c1 = { botName: 'c1' }; }),
      tokenManager.update((tokens) => { tokens.vtk_c2 = { botName: 'c2' }; }),
      tokenManager.update((tokens) => { tokens.vtk_c3 = { botName: 'c3' }; }),
    ]);
    const data = await tokenManager.read();
    expect(data.vtk_c1.botName).toBe('c1');
    expect(data.vtk_c2.botName).toBe('c2');
    expect(data.vtk_c3.botName).toBe('c3');
  });
});

describe('token-manager generate()', () => {
  it('creates a vtk_ prefixed token', async () => {
    await freshManager();
    const token = await tokenManager.generate('alice', 'Alice');
    expect(token).toMatch(/^vtk_[a-f0-9]{40}$/);
  });

  it('stores botName and displayName', async () => {
    await freshManager();
    const token = await tokenManager.generate('alice', 'Alice');
    const data = await tokenManager.read();
    expect(data[token].botName).toBe('alice');
    expect(data[token].displayName).toBe('Alice');
    expect(data[token].createdAt).toBeTruthy();
  });

  it('defaults displayName to botName when omitted', async () => {
    await freshManager();
    const token = await tokenManager.generate('bob');
    const data = await tokenManager.read();
    expect(data[token].displayName).toBe('bob');
  });

  it('each call generates a unique token', async () => {
    await freshManager();
    const t1 = await tokenManager.generate('alice', 'Alice');
    const t2 = await tokenManager.generate('alice', 'Alice');
    expect(t1).not.toBe(t2);
  });
});

describe('token-manager revoke()', () => {
  it('removes all tokens for a bot', async () => {
    await freshManager();
    const t1 = await tokenManager.generate('alice', 'Alice');
    const t2 = await tokenManager.generate('alice', 'Alice Two');
    await tokenManager.generate('bob', 'Bob'); // unrelated

    await tokenManager.revoke('alice');
    const data = await tokenManager.read();
    expect(data[t1]).toBeUndefined();
    expect(data[t2]).toBeUndefined();
    // Bob's token must be untouched
    const bobTokens = Object.values(data).filter(e => e.botName === 'bob');
    expect(bobTokens.length).toBe(1);
  });

  it('is a no-op when bot has no tokens', async () => {
    await freshManager();
    await expect(tokenManager.revoke('nobody')).resolves.toBeUndefined();
  });
});
