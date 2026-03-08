/**
 * Unit tests for ProcessManager.
 *
 * Uses real child processes via Node.js one-liners to test lifecycle behaviour
 * without mocking the spawn internals.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { ProcessManager } from '../../lib/process-manager.js';

// Track managers created in tests so we can stop them in afterEach
const managers = [];

afterEach(() => {
  for (const m of managers) {
    try { m.stop(); } catch { /* ignore */ }
  }
  managers.length = 0;
});

function trackManager(m) {
  managers.push(m);
  return m;
}

// ─── running getter ────────────────────────────────────────────────────────────

describe('running getter', () => {
  it('starts as false before start() is called', () => {
    const m = new ProcessManager('nonexistent.js');
    expect(m.running).toBe(false);
  });
});

// ─── start + stop lifecycle ───────────────────────────────────────────────────

describe('start / stop', () => {
  it('running becomes true after start()', async () => {
    // Script that stays running
    const script = join(tmpdir(), `pm-test-${randomBytes(4).toString('hex')}.js`);
    await writeFile(script, 'setTimeout(() => {}, 30000);\n');

    const m = trackManager(new ProcessManager(script, { cwd: tmpdir() }));
    m.start();
    expect(m.running).toBe(true);
  });

  it('running becomes false after stop()', async () => {
    const script = join(tmpdir(), `pm-test-${randomBytes(4).toString('hex')}.js`);
    await writeFile(script, 'setTimeout(() => {}, 30000);\n');

    const m = trackManager(new ProcessManager(script, { cwd: tmpdir() }));
    m.start();
    expect(m.running).toBe(true);

    m.stop();
    // Give the SIGTERM a moment to propagate
    await new Promise(r => setTimeout(r, 200));
    expect(m.running).toBe(false);

    await unlink(script).catch(() => {});
  });

  it('stop() is idempotent when not running', () => {
    const m = new ProcessManager('nonexistent.js');
    // Should not throw
    m.stop();
    m.stop();
  });
});

// ─── clean exit (code 0) ──────────────────────────────────────────────────────

describe('clean exit', () => {
  it('does not restart after exit code 0', async () => {
    const script = join(tmpdir(), `pm-test-${randomBytes(4).toString('hex')}.js`);
    // Script that exits cleanly with code 0
    await writeFile(script, 'process.exit(0);\n');

    const m = trackManager(new ProcessManager(script, { cwd: tmpdir() }));
    m.start();

    // Wait for it to exit
    await new Promise(r => setTimeout(r, 300));

    // Should not be running and should not restart
    expect(m.running).toBe(false);
    await new Promise(r => setTimeout(r, 1200)); // Wait longer than 1s min backoff
    expect(m.running).toBe(false);  // Still not restarted

    await unlink(script).catch(() => {});
  });
});

// ─── crash restart ────────────────────────────────────────────────────────────

describe('crash restart', () => {
  it('restarts after non-zero exit code', async () => {
    // Script that crashes on first run, stays running on subsequent runs.
    // Uses a state file to track run count.
    const countFile = join(tmpdir(), `pm-count-${randomBytes(4).toString('hex')}.txt`);
    const script = join(tmpdir(), `pm-test-${randomBytes(4).toString('hex')}.js`);

    await writeFile(script,
      `const fs = require('fs');\n` +
      `let count = 0;\n` +
      `try { count = parseInt(fs.readFileSync(${JSON.stringify(countFile)}, 'utf8')); } catch {}\n` +
      `count++;\n` +
      `fs.writeFileSync(${JSON.stringify(countFile)}, String(count));\n` +
      `if (count === 1) process.exit(1);\n` +
      `// Second run: stay alive\n` +
      `setTimeout(() => {}, 30000);\n`
    );

    const m = trackManager(new ProcessManager(script, { cwd: tmpdir() }));
    m.start();

    // Wait for first crash + 1s backoff + restart
    await new Promise(r => setTimeout(r, 2000));
    expect(m.running).toBe(true);

    m.stop();
    await unlink(script).catch(() => {});
    await unlink(countFile).catch(() => {});
  }, 10_000);

  it('does not restart after stop() + crash', async () => {
    const script = join(tmpdir(), `pm-test-${randomBytes(4).toString('hex')}.js`);
    await writeFile(script, 'setTimeout(() => {}, 30000);\n');

    const m = trackManager(new ProcessManager(script, { cwd: tmpdir() }));
    m.start();
    expect(m.running).toBe(true);

    m.stop();
    await new Promise(r => setTimeout(r, 300));
    expect(m.running).toBe(false);

    // Even after extended wait, should not restart
    await new Promise(r => setTimeout(r, 1200));
    expect(m.running).toBe(false);

    await unlink(script).catch(() => {});
  }, 10_000);
});

// ─── env and cwd passthrough ──────────────────────────────────────────────────

describe('env / cwd passthrough', () => {
  it('passes env vars to the child process', async () => {
    const outFile = join(tmpdir(), `pm-env-${randomBytes(4).toString('hex')}.txt`);
    const script = join(tmpdir(), `pm-env-script-${randomBytes(4).toString('hex')}.js`);

    const { writeFileSync } = await import('node:fs');
    writeFileSync(script,
      `const { writeFileSync } = require('fs');\n` +
      `writeFileSync(${JSON.stringify(outFile)}, process.env.TEST_VAR || 'unset');\n` +
      `process.exit(0);\n`
    );

    const m = trackManager(new ProcessManager(script, {
      cwd: tmpdir(),
      env: { ...process.env, TEST_VAR: 'hello-from-env' },
    }));
    m.start();

    await new Promise(r => setTimeout(r, 500));

    const { readFileSync } = await import('node:fs');
    let content;
    try { content = readFileSync(outFile, 'utf8'); } catch { content = null; }
    expect(content).toBe('hello-from-env');

    await unlink(script).catch(() => {});
    await unlink(outFile).catch(() => {});
  });
});
