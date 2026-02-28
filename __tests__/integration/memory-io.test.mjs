import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

// Monkey-patch paths before importing memory.js (same approach as village-manager.test.mjs)
const originalPaths = require('../../../lib/paths');
const savedMemoryDir = originalPaths.memoryDir;
const savedIsAdminBot = originalPaths.isAdminBot;
const savedChown = originalPaths.chown;

let tmpDir;
let chownCalls;

describe('appendVillageMemory (file I/O)', () => {
  // Import the ESM module — it uses createRequire internally to get paths,
  // so we monkey-patch before the first test runs
  let appendVillageMemory;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'village-mem-'));
    chownCalls = [];

    // Patch paths for this test
    originalPaths.memoryDir = () => tmpDir;
    originalPaths.isAdminBot = (name) => name === 'admin-bot';
    originalPaths.chown = async (p) => { chownCalls.push(p); };

    // Dynamic import after patching (cached after first import, which is fine
    // since memory.js captures `paths` reference at module load — the object
    // is the same, we just changed its methods)
    const mod = await import('../../memory.js');
    appendVillageMemory = mod.appendVillageMemory;
  });

  afterEach(async () => {
    originalPaths.memoryDir = savedMemoryDir;
    originalPaths.isAdminBot = savedIsAdminBot;
    originalPaths.chown = savedChown;
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('creates village.md when it does not exist (MEM-001)', async () => {
    await appendVillageMemory('test-bot', '## Coffee Hub — Jan 15, 10:00\n\n**Bot** (say): "Hello"');

    const content = await readFile(join(tmpDir, 'village.md'), 'utf-8');
    expect(content).toContain('## Coffee Hub');
    expect(content).toContain('**Bot** (say): "Hello"');
  });

  it('appends to existing village.md (MEM-002)', async () => {
    await writeFile(join(tmpDir, 'village.md'), '## Previous Entry\n\nOld content\n');

    await appendVillageMemory('test-bot', '## New Entry\n\n**Bot** (say): "Hi"');

    const content = await readFile(join(tmpDir, 'village.md'), 'utf-8');
    expect(content).toContain('## Previous Entry');
    expect(content).toContain('## New Entry');
    expect(content).toContain('Old content');
    expect(content).toContain('**Bot** (say): "Hi"');
  });

  it('adds newline separator when existing content lacks trailing newline', async () => {
    await writeFile(join(tmpDir, 'village.md'), '## Previous Entry\n\nOld content');

    await appendVillageMemory('test-bot', '## New Entry');

    const content = await readFile(join(tmpDir, 'village.md'), 'utf-8');
    expect(content).toContain('Old content\n## New Entry');
  });

  it('calls chown for customer bots', async () => {
    await appendVillageMemory('customer-bot', '## Entry');

    expect(chownCalls).toContain(join(tmpDir, 'village.md'));
  });

  it('skips chown for admin bot', async () => {
    await appendVillageMemory('admin-bot', '## Entry');

    expect(chownCalls).toHaveLength(0);
  });

  it('creates memory directory if it does not exist', async () => {
    const subDir = join(tmpDir, 'nested', 'memory');
    originalPaths.memoryDir = () => subDir;

    await appendVillageMemory('test-bot', '## Entry');

    const content = await readFile(join(subDir, 'village.md'), 'utf-8');
    expect(content).toContain('## Entry');
  });

  it('handles multiple sequential appends', async () => {
    await appendVillageMemory('test-bot', '## Entry 1');
    await appendVillageMemory('test-bot', '## Entry 2');
    await appendVillageMemory('test-bot', '## Entry 3');

    const content = await readFile(join(tmpDir, 'village.md'), 'utf-8');
    expect(content).toContain('## Entry 1');
    expect(content).toContain('## Entry 2');
    expect(content).toContain('## Entry 3');
  });
});
