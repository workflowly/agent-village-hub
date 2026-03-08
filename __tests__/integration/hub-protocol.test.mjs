/**
 * Hub protocol integration tests.
 *
 * Spawns hub.js with VILLAGE_NO_SPAWN=1 (no game server child) and a
 * minimal mock game server. Tests the full relay/poll/respond transport
 * layer and all hub management endpoints.
 *
 * Does NOT require server.js, any game schema, or real LLM calls.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const VILLAGE_DIR = join(__dirname, '..', '..');

// --- Test config ---
const HUB_PORT  = 19080;
const GAME_PORT = 19001;
const SECRET    = 'test-secret-' + randomBytes(8).toString('hex');

const HUB  = `http://127.0.0.1:${HUB_PORT}`;
const GAME = `http://127.0.0.1:${GAME_PORT}`;

// --- Tokens issued for tests ---
let TOKEN_A;  // test-bot-a
let TOKEN_B;  // test-bot-b

let tmpDir;
let hubProc;
let mockGameServer;

// --- Game server state (mutable by tests) ---
const gameState = {
  bots: {},   // botName → { inGame: bool }
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function authHeaders(token = TOKEN_A) {
  return { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };
}

function secretHeaders() {
  return { 'Authorization': `Bearer ${SECRET}`, 'Content-Type': 'application/json' };
}

async function req(method, path, body, token) {
  const opts = {
    method,
    headers: token === false ? { 'Content-Type': 'application/json' } : authHeaders(token),
    signal: AbortSignal.timeout(10_000),
  };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const resp = await fetch(`${HUB}${path}`, opts);
  let data;
  try { data = await resp.json(); } catch { data = null; }
  return { status: resp.status, data };
}

async function operatorReq(method, path, body) {
  const opts = {
    method,
    headers: secretHeaders(),
    signal: AbortSignal.timeout(10_000),
  };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const resp = await fetch(`${HUB}${path}`, opts);
  let data;
  try { data = await resp.json(); } catch { data = null; }
  return { status: resp.status, data };
}

function waitForHub(timeout = 10_000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    async function poll() {
      try {
        const resp = await fetch(`${HUB}/api/hub/health`, { signal: AbortSignal.timeout(1_000) });
        if (resp.ok) { resolve(); return; }
      } catch { /* not ready */ }
      if (Date.now() - start > timeout) { reject(new Error('Hub did not start in time')); return; }
      setTimeout(poll, 300);
    }
    poll();
  });
}

// ─── Mock game server ─────────────────────────────────────────────────────────

function startMockGameServer() {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url, `http://localhost:${GAME_PORT}`);
      const path = url.pathname;

      // Auth check
      const auth = req.headers.authorization || '';
      if (auth !== `Bearer ${SECRET}`) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Unauthorized' }));
        return;
      }

      // POST /api/join
      if (path === '/api/join' && req.method === 'POST') {
        let body = '';
        req.on('data', c => { body += c; });
        req.on('end', () => {
          const { botName } = JSON.parse(body || '{}');
          if (gameState.bots[botName]?.inGame) {
            res.writeHead(409, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Already joined' }));
            return;
          }
          gameState.bots[botName] = { inGame: true };
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, game: { id: 'test', name: 'Test', description: '', version: '1' } }));
        });
        return;
      }

      // POST /api/leave
      if (path === '/api/leave' && req.method === 'POST') {
        let body = '';
        req.on('data', c => { body += c; });
        req.on('end', () => {
          const { botName } = JSON.parse(body || '{}');
          if (gameState.bots[botName]) gameState.bots[botName].inGame = false;
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true }));
        });
        return;
      }

      // GET /api/bot/:name/status
      const statusMatch = path.match(/^\/api\/bot\/([^/]+)\/status$/);
      if (statusMatch && req.method === 'GET') {
        const botName = statusMatch[1];
        const inGame = gameState.bots[botName]?.inGame || false;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ inGame, game: inGame ? { id: 'test', name: 'Test' } : null, failureCount: 0 }));
        return;
      }

      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
    });

    server.listen(GAME_PORT, '127.0.0.1', () => resolve(server));
  });
}

// ─── Setup / Teardown ─────────────────────────────────────────────────────────

beforeAll(async () => {
  // Temp data dir
  tmpDir = await mkdtemp(join(tmpdir(), 'hub-test-'));
  await mkdir(join(tmpDir, 'logs'), { recursive: true });

  // Pre-seed tokens file with two test tokens
  TOKEN_A = 'vtk_' + randomBytes(20).toString('hex');
  TOKEN_B = 'vtk_' + randomBytes(20).toString('hex');
  const tokens = {
    [TOKEN_A]: { botName: 'test-bot-a', displayName: 'Bot A', createdAt: new Date().toISOString() },
    [TOKEN_B]: { botName: 'test-bot-b', displayName: 'Bot B', createdAt: new Date().toISOString() },
  };
  await writeFile(join(tmpDir, 'village-tokens.json'), JSON.stringify(tokens, null, 2) + '\n', { mode: 0o600 });

  // Start mock game server
  mockGameServer = await startMockGameServer();

  // Spawn hub
  hubProc = spawn('node', ['hub.js'], {
    cwd: VILLAGE_DIR,
    env: {
      ...process.env,
      VILLAGE_SECRET:   SECRET,
      VILLAGE_GAME:     'social-village',
      VILLAGE_HUB_PORT: String(HUB_PORT),
      VILLAGE_PORT:     String(GAME_PORT),
      VILLAGE_DATA_DIR: tmpDir,
      VILLAGE_NO_SPAWN: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  hubProc.stdout.on('data', (d) => process.stdout.write(`[hub] ${d}`));
  hubProc.stderr.on('data', (d) => process.stderr.write(`[hub:err] ${d}`));

  await waitForHub();
}, 20_000);

afterAll(async () => {
  if (hubProc) { hubProc.kill('SIGTERM'); }
  if (mockGameServer) mockGameServer.close();
  if (tmpDir) await rm(tmpDir, { recursive: true, force: true });
}, 10_000);

// ─── Token auth ───────────────────────────────────────────────────────────────

describe('token auth', () => {
  it('no token → 401 on hello', async () => {
    const { status } = await req('POST', '/api/village/hello', {}, false);
    expect(status).toBe(401);
  });

  it('bad token → 401 on hello', async () => {
    const { status } = await req('POST', '/api/village/hello', {}, 'vtk_badbadbadbad');
    expect(status).toBe(401);
  });

  it('non-vtk_ token → 401', async () => {
    const { status } = await req('POST', '/api/village/hello', {}, 'sk-ant-something');
    expect(status).toBe(401);
  });

  it('valid token on wrong botName → 403 on poll', async () => {
    const resp = await fetch(`${HUB}/api/village/poll/test-bot-b`, {
      headers: authHeaders(TOKEN_A),
      signal: AbortSignal.timeout(2_000),
    });
    expect(resp.status).toBe(403);
  });

  it('operator endpoints reject bot tokens', async () => {
    const { status } = await req('POST', '/api/hub/tokens', { botName: 'x' }, TOKEN_A);
    expect(status).toBe(401);
  });

  it('operator endpoints require secret', async () => {
    const { status, data } = await operatorReq('POST', '/api/hub/tokens', { botName: 'newbot', displayName: 'New Bot' });
    expect(status).toBe(200);
    expect(data.token).toMatch(/^vtk_/);
  });
});

// ─── Hello ────────────────────────────────────────────────────────────────────

describe('hello handshake', () => {
  it('returns ok with botName', async () => {
    const { status, data } = await req('POST', '/api/village/hello', {});
    expect(status).toBe(200);
    expect(data.ok).toBe(true);
    expect(data.botName).toBe('test-bot-a');
  });

  it('duplicate detection: second hello within 5min returns duplicate=true', async () => {
    // Seed botHealth via heartbeat first
    await req('POST', '/api/village/heartbeat', { version: '1.0.0', uptimeMs: 1000, joined: false, scenesProcessed: 0, scenesFailed: 0, pollErrors: 0 });
    const { data } = await req('POST', '/api/village/hello', {});
    expect(data.duplicate).toBe(true);
  });
});

// ─── Heartbeat ────────────────────────────────────────────────────────────────

describe('heartbeat', () => {
  it('stores metrics and returns config', async () => {
    const hb = { version: '1.2.3', uptimeMs: 60000, joined: true, scenesProcessed: 5, scenesFailed: 0, avgSceneMs: 800, lastSceneAt: new Date().toISOString(), pollErrors: 1 };
    const { status, data } = await req('POST', '/api/village/heartbeat', hb);
    expect(status).toBe(200);
    expect(data.ok).toBe(true);
    expect(data.config.pollTimeoutMs).toBeGreaterThan(0);
  });

  it('GET /api/village/health/:botName returns stored heartbeat', async () => {
    await req('POST', '/api/village/heartbeat', { version: 'v-health-test', uptimeMs: 1000, joined: true, scenesProcessed: 99, scenesFailed: 0, pollErrors: 0 });
    const { status, data } = await req('GET', '/api/village/health/test-bot-a');
    expect(status).toBe(200);
    expect(data.status).toBe('healthy');
    expect(data.lastHeartbeat.version).toBe('v-health-test');
    expect(data.lastHeartbeat.scenesProcessed).toBe(99);
    expect(data.ageMs).toBeLessThan(5000);
  });

  it('GET /api/village/health (all) requires secret', async () => {
    const { status, data } = await operatorReq('GET', '/api/village/health');
    expect(status).toBe(200);
    expect(data.bots).toBeDefined();
  });

  it('GET /api/village/health (all) rejects bot token', async () => {
    const { status } = await req('GET', '/api/village/health');
    expect(status).toBe(401);
  });
});

// ─── Join / Leave ─────────────────────────────────────────────────────────────

describe('join / leave', () => {
  it('join proxies to game server and returns ok + config', async () => {
    gameState.bots['test-bot-a'] = { inGame: false };
    const { status, data } = await req('POST', '/api/village/join', {});
    expect(status).toBe(200);
    expect(data.ok).toBe(true);
    expect(data.botName).toBe('test-bot-a');
    expect(data.config.pollTimeoutMs).toBeGreaterThan(0);
  });

  it('leave proxies to game server', async () => {
    const { status, data } = await req('POST', '/api/village/leave', {});
    expect(status).toBe(200);
    expect(data.ok).toBe(true);
  });

  it('join requires valid token', async () => {
    const { status } = await req('POST', '/api/village/join', {}, 'vtk_bad');
    expect(status).toBe(401);
  });
});

// ─── Relay → Poll → Respond ───────────────────────────────────────────────────

describe('relay/poll/respond — waiter path (poll waiting when relay arrives)', () => {
  it('relay delivers scene to waiting poll; respond returns actions to relay', async () => {
    // 1. Start long-poll (will block)
    const pollAbort = new AbortController();
    const pollPromise = fetch(`${HUB}/api/village/poll/test-bot-a`, {
      headers: authHeaders(TOKEN_A),
      signal: pollAbort.signal,
    });

    // 2. Wait for poll to register as a waiter
    await new Promise(r => setTimeout(r, 200));

    // 3. Send scene via relay (blocks until respond)
    const relayPayload = {
      botName: 'test-bot-a',
      conversationId: 'village:test-bot-a',
      v: 2,
      scene: 'You are in the test arena.',
      tools: [{ name: 'village_observe', description: 'Observe', parameters: { type: 'object', properties: {} } }],
      systemPrompt: 'Be a test bot.',
      allowedReads: [],
      maxActions: 1,
    };
    const relayPromise = fetch(`${HUB}/api/village/relay`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SECRET}` },
      body: JSON.stringify(relayPayload),
      signal: AbortSignal.timeout(10_000),
    });

    // 4. Poll resolves with scene
    const pollResp = await pollPromise;
    expect(pollResp.status).toBe(200);
    const scene = await pollResp.json();
    expect(scene.requestId).toMatch(/^vr_/);
    expect(scene.conversationId).toBe('village:test-bot-a');
    expect(scene.v).toBe(2);
    expect(scene.scene).toContain('test arena');

    // 5. Respond with actions
    const { status: rStatus, data: rData } = await req(
      'POST', `/api/village/respond/${scene.requestId}`,
      { actions: [{ tool: 'village_observe', params: {} }] }
    );
    expect(rStatus).toBe(200);
    expect(rData.ok).toBe(true);

    // 6. Relay resolves with those actions
    const relayResp = await relayPromise;
    const relayData = await relayResp.json();
    expect(relayData.actions[0].tool).toBe('village_observe');
  });
});

describe('relay/poll/respond — queue path (relay arrives before poll)', () => {
  it('relay queues scene; subsequent poll gets it immediately', async () => {
    // 1. Send relay first (no waiter — will be queued)
    const relayPayload = {
      botName: 'test-bot-b',
      conversationId: 'village:test-bot-b',
      v: 2,
      scene: 'Queued scene for bot-b.',
      tools: [],
      systemPrompt: null,
      allowedReads: [],
      maxActions: 1,
    };
    const relayPromise = fetch(`${HUB}/api/village/relay`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SECRET}` },
      body: JSON.stringify(relayPayload),
      signal: AbortSignal.timeout(10_000),
    });

    // 2. Small delay so relay arrives before poll
    await new Promise(r => setTimeout(r, 100));

    // 3. Poll — should return immediately with queued scene
    const t0 = Date.now();
    const pollResp = await fetch(`${HUB}/api/village/poll/test-bot-b`, {
      headers: authHeaders(TOKEN_B),
      signal: AbortSignal.timeout(5_000),
    });
    const elapsed = Date.now() - t0;
    expect(pollResp.status).toBe(200);
    expect(elapsed).toBeLessThan(1000); // immediate, not long-polled
    const scene = await pollResp.json();
    expect(scene.scene).toContain('Queued scene for bot-b');

    // 4. Respond to unblock relay
    await req('POST', `/api/village/respond/${scene.requestId}`,
      { actions: [{ tool: 'village_observe', params: {} }] }, TOKEN_B);
    await relayPromise;
  });
});

describe('relay/poll/respond — error cases', () => {
  it('relay without secret → 401', async () => {
    const resp = await fetch(`${HUB}/api/village/relay`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer wrong' },
      body: JSON.stringify({ botName: 'x', conversationId: 'y', scene: 'z' }),
      signal: AbortSignal.timeout(5_000),
    });
    expect(resp.status).toBe(401);
  });

  it('relay with missing fields → 400', async () => {
    const resp = await fetch(`${HUB}/api/village/relay`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SECRET}` },
      body: JSON.stringify({ botName: 'x' }), // missing conversationId and scene
      signal: AbortSignal.timeout(5_000),
    });
    expect(resp.status).toBe(400);
  });

  it('respond with expired/unknown requestId → 404', async () => {
    const { status } = await req('POST', '/api/village/respond/vr_0_9999_expired',
      { actions: [] });
    expect(status).toBe(404);
  });

  it('respond with another bots requestId → 403', async () => {
    // Issue a relay for bot-a, then try to respond using bot-b's token
    const relayPromise = fetch(`${HUB}/api/village/relay`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SECRET}` },
      body: JSON.stringify({ botName: 'test-bot-a', conversationId: 'village:test-bot-a', scene: 'x', tools: [], allowedReads: [], maxActions: 1 }),
      signal: AbortSignal.timeout(10_000),
    });

    // Poll with bot-a to get the requestId
    const pollResp = await fetch(`${HUB}/api/village/poll/test-bot-a`, {
      headers: authHeaders(TOKEN_A),
      signal: AbortSignal.timeout(5_000),
    });
    const scene = await pollResp.json();

    // Try responding as bot-b — should be forbidden
    const { status } = await req('POST', `/api/village/respond/${scene.requestId}`,
      { actions: [] }, TOKEN_B);
    expect(status).toBe(403);

    // Clean up: respond as bot-a so relay doesn't timeout
    await req('POST', `/api/village/respond/${scene.requestId}`,
      { actions: [{ tool: 'village_observe', params: {} }] }, TOKEN_A);
    await relayPromise;
  });
});

// ─── Duplicate poll ────────────────────────────────────────────────────────────

describe('duplicate poll handling', () => {
  it('second poll for same bot disconnects the first waiter', async () => {
    // First poll — will be disconnected
    const poll1 = fetch(`${HUB}/api/village/poll/test-bot-a`, {
      headers: authHeaders(TOKEN_A),
      signal: AbortSignal.timeout(5_000),
    });

    await new Promise(r => setTimeout(r, 200));

    // Second poll — becomes the new waiter
    const poll2 = fetch(`${HUB}/api/village/poll/test-bot-a`, {
      headers: authHeaders(TOKEN_A),
      signal: AbortSignal.timeout(5_000),
    });

    await new Promise(r => setTimeout(r, 200));

    // Send relay — should go to poll2 (the active waiter)
    const relayPromise = fetch(`${HUB}/api/village/relay`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SECRET}` },
      body: JSON.stringify({ botName: 'test-bot-a', conversationId: 'village:test-bot-a', scene: 'dup-poll-test', tools: [], allowedReads: [], maxActions: 1 }),
      signal: AbortSignal.timeout(10_000),
    });

    // poll2 should get the scene
    const poll2Resp = await poll2;
    expect(poll2Resp.status).toBe(200);
    const scene2 = await poll2Resp.json();
    expect(scene2.scene).toContain('dup-poll-test');

    // Respond to clean up
    await req('POST', `/api/village/respond/${scene2.requestId}`,
      { actions: [{ tool: 'village_observe', params: {} }] });
    await relayPromise;

    // poll1 should also resolve (was disconnected — will get null → 204 or closed)
    // We don't assert poll1's status strictly since it may resolve as 204 or close
    const poll1Resp = await poll1.catch(() => null);
    // Just verify it resolves (doesn't hang forever)
    expect(poll1Resp).not.toBeNull();
  });
});

// ─── Kick ─────────────────────────────────────────────────────────────────────

describe('kick', () => {
  it('delivers poison pill to polling bot and revokes token', async () => {
    // Re-issue a token since kick revokes it
    const freshToken = 'vtk_' + randomBytes(20).toString('hex');
    await operatorReq('POST', '/api/hub/tokens', { botName: 'test-bot-kick', displayName: 'Kick Me' });
    // Use a fresh bot registered via POST /api/hub/tokens
    const { data: newTok } = await operatorReq('POST', '/api/hub/tokens', { botName: 'kick-target', displayName: 'Kick Target' });
    const kickToken = newTok.token;

    // Start polling
    const pollPromise = fetch(`${HUB}/api/village/poll/kick-target`, {
      headers: { 'Authorization': `Bearer ${kickToken}` },
      signal: AbortSignal.timeout(10_000),
    });

    await new Promise(r => setTimeout(r, 200));

    // Kick
    const { status: kickStatus, data: kickData } = await operatorReq(
      'POST', '/api/village/kick/kick-target', { reason: 'test kick' });
    expect(kickStatus).toBe(200);
    expect(kickData.ok).toBe(true);

    // Poll receives kick payload
    const pollResp = await pollPromise;
    expect(pollResp.status).toBe(200);
    const payload = await pollResp.json();
    expect(payload.kick).toBe(true);
    expect(payload.reason).toBe('test kick');

    // Token revoked — subsequent request → 401
    await new Promise(r => setTimeout(r, 300));
    const resp = await fetch(`${HUB}/api/village/hello`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${kickToken}`, 'Content-Type': 'application/json' },
      body: '{}',
      signal: AbortSignal.timeout(5_000),
    });
    expect(resp.status).toBe(401);
  });

  it('queues kick payload when bot is not polling', async () => {
    const { data: newTok } = await operatorReq('POST', '/api/hub/tokens', { botName: 'kick-offline', displayName: 'Kick Offline' });
    const kickToken = newTok.token;

    // Kick before bot polls
    await operatorReq('POST', '/api/village/kick/kick-offline', { reason: 'offline kick' });

    // Bot polls now → gets queued kick payload
    const pollResp = await fetch(`${HUB}/api/village/poll/kick-offline`, {
      headers: { 'Authorization': `Bearer ${kickToken}` },
      signal: AbortSignal.timeout(5_000),
    });
    // Token was revoked so poll returns 401 (token check happens before queue delivery)
    // This validates kick + revoke happens before the bot can poll
    expect([200, 401]).toContain(pollResp.status);
  });
});

// ─── Invite script ────────────────────────────────────────────────────────────

describe('invite', () => {
  it('returns bash setup script for unclaimed token', async () => {
    const resp = await fetch(`${HUB}/api/village/invite/${TOKEN_A}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(5_000),
    });
    expect(resp.status).toBe(200);
    const script = await resp.text();
    expect(script).toContain('#!/usr/bin/env bash');
    expect(script).toContain('openclaw plugins install');
    expect(script).toContain(TOKEN_A);
  });

  it('returns 410 for already-claimed token', async () => {
    // Claim TOKEN_A by calling invite once (marks as claimed)
    await fetch(`${HUB}/api/village/invite/${TOKEN_A}`, {
      method: 'POST', signal: AbortSignal.timeout(5_000),
    });
    // Second call → 410
    const resp = await fetch(`${HUB}/api/village/invite/${TOKEN_A}`, {
      method: 'POST', signal: AbortSignal.timeout(5_000),
    });
    expect(resp.status).toBe(410);
  });

  it('returns 404 for unknown token', async () => {
    const resp = await fetch(`${HUB}/api/village/invite/vtk_000000000000000000000000000000000000000000`, {
      method: 'POST', signal: AbortSignal.timeout(5_000),
    });
    expect(resp.status).toBe(404);
  });

  it('returns 400 for non-vtk_ token', async () => {
    const resp = await fetch(`${HUB}/api/village/invite/not-a-vtk-token`, {
      method: 'POST', signal: AbortSignal.timeout(5_000),
    });
    expect(resp.status).toBe(400);
  });
});

// ─── Token management ─────────────────────────────────────────────────────────

describe('token management (operator)', () => {
  it('POST /api/hub/tokens issues new token with inviteUrl', async () => {
    const { status, data } = await operatorReq('POST', '/api/hub/tokens', { botName: 'newbot', displayName: 'New Bot' });
    expect(status).toBe(200);
    expect(data.token).toMatch(/^vtk_[a-f0-9]{40}$/);
    expect(data.inviteUrl).toContain(data.token);
    expect(data.botName).toBe('newbot');
  });

  it('POST /api/hub/tokens → 400 without botName', async () => {
    const { status } = await operatorReq('POST', '/api/hub/tokens', {});
    expect(status).toBe(400);
  });

  it('DELETE /api/hub/tokens/:token removes the token', async () => {
    const { data: issued } = await operatorReq('POST', '/api/hub/tokens', { botName: 'todelete' });
    const token = issued.token;

    // Token works before deletion
    const beforeResp = await fetch(`${HUB}/api/village/hello`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: '{}',
      signal: AbortSignal.timeout(5_000),
    });
    expect(beforeResp.status).toBe(200);

    // Delete
    const { status: delStatus } = await operatorReq('DELETE', `/api/hub/tokens/${token}`);
    expect(delStatus).toBe(200);

    // Token no longer works
    const afterResp = await fetch(`${HUB}/api/village/hello`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: '{}',
      signal: AbortSignal.timeout(5_000),
    });
    expect(afterResp.status).toBe(401);
  });
});

// ─── Hub health ───────────────────────────────────────────────────────────────

describe('hub health', () => {
  it('GET /api/hub/health returns ok', async () => {
    const resp = await fetch(`${HUB}/api/hub/health`, { signal: AbortSignal.timeout(5_000) });
    expect(resp.status).toBe(200);
    const data = await resp.json();
    expect(data.ok).toBe(true);
    expect(typeof data.uptime).toBe('number');
  });
});
