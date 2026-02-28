import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

// We need to mock lib/paths to point to temp directories
// village-manager uses: paths.village(botName), paths.isAdminBot(botName), paths.chown(path)
// It also uses proper-lockfile from portal/node_modules

let tmpDir;
let villageFilePath;

// Mock paths module before requiring village-manager
const originalPaths = require('../../../lib/paths');
const mockVillagePath = (botName) => join(tmpDir, `${botName}-village.json`);

// Patch paths for testing
const savedVillage = originalPaths.village;
const savedIsAdmin = originalPaths.isAdminBot;
const savedChown = originalPaths.chown;

describe('village-manager (locked read-modify-write)', () => {
  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'village-mgr-'));

    // Monkey-patch paths for testing
    originalPaths.village = mockVillagePath;
    originalPaths.isAdminBot = () => false;
    originalPaths.chown = async () => {};
  });

  afterEach(async () => {
    // Restore original paths
    originalPaths.village = savedVillage;
    originalPaths.isAdminBot = savedIsAdmin;
    originalPaths.chown = savedChown;

    await rm(tmpDir, { recursive: true, force: true });
  });

  // Re-require fresh each time (module is cached, but paths are monkey-patched)
  function getManager() {
    return require('../../../lib/village-manager');
  }

  it('read() returns default when file does not exist', async () => {
    const mgr = getManager();
    const data = await mgr.read('nonexistent-bot');
    expect(data).toEqual({ enabled: false });
  });

  it('read() parses existing village.json', async () => {
    const mgr = getManager();
    const filePath = mockVillagePath('test-bot');
    await writeFile(filePath, JSON.stringify({ enabled: true, joinedAt: '2025-01-01' }));

    const data = await mgr.read('test-bot');
    expect(data.enabled).toBe(true);
    expect(data.joinedAt).toBe('2025-01-01');
  });

  it('update() creates file if it does not exist, applies mutator', async () => {
    const mgr = getManager();
    const result = await mgr.update('new-bot', (data) => {
      data.enabled = true;
      data.joinedAt = '2025-02-28';
    });

    expect(result.enabled).toBe(true);
    expect(result.joinedAt).toBe('2025-02-28');

    // Verify persisted
    const raw = await readFile(mockVillagePath('new-bot'), 'utf-8');
    const persisted = JSON.parse(raw);
    expect(persisted.enabled).toBe(true);
  });

  it('update() reads existing file and mutates in place', async () => {
    const mgr = getManager();
    const filePath = mockVillagePath('test-bot');
    await writeFile(filePath, JSON.stringify({ enabled: false, extra: 'data' }));

    const result = await mgr.update('test-bot', (data) => {
      data.enabled = true;
    });

    expect(result.enabled).toBe(true);
    expect(result.extra).toBe('data'); // Preserved
  });

  it('update() supports returning a new object from mutator', async () => {
    const mgr = getManager();
    const filePath = mockVillagePath('test-bot');
    await writeFile(filePath, JSON.stringify({ enabled: false }));

    const result = await mgr.update('test-bot', () => {
      return { enabled: true, joinedAt: '2025-02-28' };
    });

    expect(result).toEqual({ enabled: true, joinedAt: '2025-02-28' });
  });

  it('update() handles corrupt JSON by using defaults', async () => {
    const mgr = getManager();
    const filePath = mockVillagePath('corrupt-bot');
    await writeFile(filePath, 'not valid json!!!');

    const result = await mgr.update('corrupt-bot', (data) => {
      data.enabled = true;
    });

    expect(result.enabled).toBe(true);
  });

  it('sequential updates are serialized (no data loss)', async () => {
    const mgr = getManager();

    // Run 5 sequential updates
    for (let i = 0; i < 5; i++) {
      await mgr.update('serial-bot', (data) => {
        data.counter = (data.counter || 0) + 1;
      });
    }

    const data = await mgr.read('serial-bot');
    expect(data.counter).toBe(5);
  });

  it('concurrent updates do not lose data (lock serialization)', async () => {
    const mgr = getManager();

    // Run 3 concurrent updates — locks should serialize them
    await Promise.all([
      mgr.update('concurrent-bot', (data) => { data.a = true; }),
      mgr.update('concurrent-bot', (data) => { data.b = true; }),
      mgr.update('concurrent-bot', (data) => { data.c = true; }),
    ]);

    const data = await mgr.read('concurrent-bot');
    expect(data.a).toBe(true);
    expect(data.b).toBe(true);
    expect(data.c).toBe(true);
  });
});
