/**
 * Village Hub — standalone entry point.
 *
 * Provides the village protocol gateway (relay, poll, respond, hello,
 * heartbeat, join, leave, kick, invite, agenda) and spawns the game
 * server (village/server.js) as a managed child process.
 *
 * Listens on 0.0.0.0:8080. Game server runs on 127.0.0.1:7001 internally.
 *
 * Required env vars:
 *   VILLAGE_SECRET   — shared secret between hub and game server
 *   VILLAGE_GAME     — game id (default: social-village)
 *
 * Optional env vars:
 *   VILLAGE_HUB_PORT       — hub listen port (default: 8080)
 *   VILLAGE_PORT           — game server port (default: 7001)
 *   VILLAGE_HUB_URL        — public URL for invite scripts (default: http://localhost:8080)
 *   VILLAGE_DATA_DIR       — data directory for tokens/state/logs (default: ./data)
 *   VILLAGE_API_ROUTER_URL — NPC LLM backend (default: unset, NPCs disabled)
 */

import express from 'express';
import rateLimit from 'express-rate-limit';
import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';

import * as tokenManager from './lib/token-manager.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// --- Config ---
const HUB_PORT = parseInt(process.env.VILLAGE_HUB_PORT || '8080', 10);
const GAME_PORT = parseInt(process.env.VILLAGE_PORT || '7001', 10);
const VILLAGE_URL = `http://127.0.0.1:${GAME_PORT}`;
const VILLAGE_SECRET = process.env.VILLAGE_SECRET || '';
const VILLAGE_HUB_URL = process.env.VILLAGE_HUB_URL || `http://localhost:${HUB_PORT}`;
const DATA_DIR = process.env.VILLAGE_DATA_DIR || join(__dirname, 'data');

const RELAY_TIMEOUT_MS = 120_000;
const POLL_TIMEOUT_MS = 120_000;

// Transport config pushed to plugins via hello/heartbeat/join responses
const remoteConfig = {
  pollTimeoutMs: POLL_TIMEOUT_MS + 5_000,
  backoffMs: 5_000,
};

// --- Rate limiter ---
const villageLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  keyGenerator: (req) => req.ip,
  message: { error: 'Too many requests. Try again later.' },
});

// --- Helpers ---
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

// --- In-memory state ---
const pendingScenes = new Map();  // requestId → { resolve, timer, botName }
const sceneQueue = new Map();     // botName → scene payload
const pollWaiters = new Map();    // botName → { resolve, timer }
const botHealth = new Map();      // botName → { ...heartbeat, receivedAt }
let requestCounter = 0;

// --- Token validation ---
async function validateToken(req) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token || !token.startsWith('vtk_')) return null;
  try {
    const tokens = await tokenManager.read();
    const entry = tokens[token];
    if (!entry || !entry.botName) return null;
    return { botName: entry.botName, displayName: entry.displayName || entry.botName };
  } catch {
    return null;
  }
}

// --- Express app ---
const app = express();
app.use(express.json());

// --- POST /api/village/relay — Game server sends scene here ---
app.post('/api/village/relay', async (req, res) => {
  const auth = req.headers.authorization || '';
  if (!VILLAGE_SECRET || !safeEqual(auth, `Bearer ${VILLAGE_SECRET}`)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { botName, conversationId, scene } = req.body || {};
  if (!botName || !conversationId || !scene) {
    return res.status(400).json({ error: 'Missing botName, conversationId, or scene' });
  }

  const { botName: _botName, ...sceneData } = req.body;
  const requestId = `vr_${++requestCounter}_${Date.now()}`;
  const scenePayload = { requestId, ...sceneData };

  const relayPromise = new Promise((resolve) => {
    const timer = setTimeout(() => {
      pendingScenes.delete(requestId);
      resolve(null);
    }, RELAY_TIMEOUT_MS);
    pendingScenes.set(requestId, { resolve, timer, botName });
  });

  const waiter = pollWaiters.get(botName);
  if (waiter) {
    clearTimeout(waiter.timer);
    pollWaiters.delete(botName);
    waiter.resolve(scenePayload);
  } else {
    sceneQueue.set(botName, scenePayload);
  }

  relayPromise.then((result) => {
    if (result) {
      res.json(result);
    } else {
      res.status(504).json({ error: 'Remote bot timeout' });
    }
  });
});

// --- GET /api/village/poll/:botName — Remote bot polls for scenes ---
app.get('/api/village/poll/:botName', villageLimiter, async (req, res) => {
  const auth = await validateToken(req);
  if (!auth) return res.status(401).json({ error: 'Unauthorized' });

  const { botName } = req.params;
  if (auth.botName !== botName) return res.status(403).json({ error: 'Token does not match bot name' });

  const queued = sceneQueue.get(botName);
  if (queued) {
    sceneQueue.delete(botName);
    return res.json(queued);
  }

  const existingWaiter = pollWaiters.get(botName);
  if (existingWaiter) {
    console.warn(`[hub] duplicate poll for ${botName} — disconnecting previous connection`);
    clearTimeout(existingWaiter.timer);
    pollWaiters.delete(botName);
    existingWaiter.resolve(null);
  }

  const pollPromise = new Promise((resolve) => {
    const timer = setTimeout(() => {
      pollWaiters.delete(botName);
      resolve(null);
    }, POLL_TIMEOUT_MS);
    pollWaiters.set(botName, { resolve, timer });
  });

  req.on('close', () => {
    const waiter = pollWaiters.get(botName);
    if (waiter) {
      clearTimeout(waiter.timer);
      pollWaiters.delete(botName);
      waiter.resolve(null);
    }
  });

  const result = await pollPromise;
  if (res.headersSent) return;

  if (result) {
    res.json(result);
  } else {
    try {
      const statusResp = await fetch(`${VILLAGE_URL}/api/bot/${botName}/status`, {
        headers: VILLAGE_SECRET ? { 'Authorization': `Bearer ${VILLAGE_SECRET}` } : {},
        signal: AbortSignal.timeout(3_000),
      });
      const statusData = await statusResp.json();
      if (!statusData.inGame) {
        return res.status(410).json({ error: 'removed', message: 'Bot is no longer in the game' });
      }
    } catch { /* game server unreachable */ }
    res.status(204).end();
  }
});

// --- POST /api/village/respond/:requestId — Remote bot sends actions ---
app.post('/api/village/respond/:requestId', villageLimiter, async (req, res) => {
  const auth = await validateToken(req);
  if (!auth) return res.status(401).json({ error: 'Unauthorized' });

  const { requestId } = req.params;
  const pending = pendingScenes.get(requestId);
  if (!pending) return res.status(404).json({ error: 'Request not found or expired' });
  if (pending.botName !== auth.botName) return res.status(403).json({ error: 'Request does not belong to this bot' });

  clearTimeout(pending.timer);
  pendingScenes.delete(requestId);

  const { actions, usage } = req.body || {};
  const response = { actions: actions || [{ tool: 'village_observe', params: {} }] };
  if (usage) response.usage = usage;
  pending.resolve(response);

  res.json({ ok: true });
});

// --- POST /api/village/hello — Startup handshake ---
app.post('/api/village/hello', villageLimiter, async (req, res) => {
  const auth = await validateToken(req);
  if (!auth) return res.status(401).json({ error: 'Invalid or missing VILLAGE_TOKEN' });

  const existingHealth = botHealth.get(auth.botName);
  if (existingHealth && (Date.now() - existingHealth.receivedAt) < 5 * 60_000) {
    const agoS = Math.round((Date.now() - existingHealth.receivedAt) / 1000);
    console.warn(`[hub] duplicate hello from ${auth.botName} (existing instance heartbeat ${agoS}s ago) — standing down new instance`);
    return res.json({ ok: true, botName: auth.botName, game: null, inGame: false, duplicate: true });
  }

  try {
    const resp = await fetch(`${VILLAGE_URL}/api/bot/${auth.botName}/status`, {
      headers: VILLAGE_SECRET ? { 'Authorization': `Bearer ${VILLAGE_SECRET}` } : {},
      signal: AbortSignal.timeout(5_000),
    });
    const data = await resp.json();
    console.log(`[hub] hello from ${auth.botName}`);
    res.json({ ok: true, botName: auth.botName, game: data.game?.name || null, inGame: data.inGame || false });
  } catch {
    console.log(`[hub] hello from ${auth.botName} (game server unreachable)`);
    res.json({ ok: true, botName: auth.botName, game: null, inGame: false });
  }
});

// --- POST /api/village/heartbeat — Bot health metrics ---
app.post('/api/village/heartbeat', villageLimiter, async (req, res) => {
  const auth = await validateToken(req);
  if (!auth) return res.status(401).json({ error: 'Unauthorized' });

  const raw = req.body || {};
  const data = {
    version: raw.version,
    uptimeMs: raw.uptimeMs,
    joined: raw.joined,
    scenesProcessed: raw.scenesProcessed,
    scenesFailed: raw.scenesFailed,
    avgSceneMs: raw.avgSceneMs,
    lastSceneAt: raw.lastSceneAt,
    pollErrors: raw.pollErrors,
  };
  botHealth.set(auth.botName, { ...data, botName: auth.botName, displayName: auth.displayName, receivedAt: Date.now() });
  console.log(`[hub] heartbeat from ${auth.botName} (v${data.version || '?'}, scenes=${data.scenesProcessed || 0}, joined=${data.joined}, uptime=${Math.round((data.uptimeMs || 0) / 1000)}s)`);

  let inGame = null;
  try {
    const statusResp = await fetch(`${VILLAGE_URL}/api/bot/${auth.botName}/status`, {
      headers: VILLAGE_SECRET ? { 'Authorization': `Bearer ${VILLAGE_SECRET}` } : {},
      signal: AbortSignal.timeout(3_000),
    });
    const statusData = await statusResp.json();
    inGame = statusData.inGame || false;
  } catch { /* game server unreachable */ }

  res.json({ ok: true, config: remoteConfig, ...(inGame !== null ? { inGame, botName: auth.botName } : {}) });
});

// --- GET /api/village/health/:botName — Check bot health ---
app.get('/api/village/health/:botName', async (req, res) => {
  const auth = await validateToken(req);
  const bearerToken = (req.headers.authorization || '').slice(7);
  const isOperator = VILLAGE_SECRET && safeEqual(bearerToken, VILLAGE_SECRET);

  if (!auth && !isOperator) return res.status(401).json({ error: 'Unauthorized' });
  if (auth && auth.botName !== req.params.botName && !isOperator) return res.status(403).json({ error: 'Token does not match bot name' });

  const health = botHealth.get(req.params.botName);
  if (!health) return res.json({ ok: true, status: 'no_data', message: 'No heartbeat received yet' });

  const ageMs = Date.now() - health.receivedAt;
  res.json({ ok: true, status: ageMs > 10 * 60_000 ? 'stale' : 'healthy', lastHeartbeat: health, ageMs });
});

// --- GET /api/village/health — All bots summary (operator only) ---
app.get('/api/village/health', async (req, res) => {
  const bearerToken = (req.headers.authorization || '').slice(7);
  if (!VILLAGE_SECRET || !safeEqual(bearerToken, VILLAGE_SECRET)) return res.status(401).json({ error: 'Unauthorized' });

  const summary = {};
  for (const [botName, health] of botHealth) {
    const ageMs = Date.now() - health.receivedAt;
    const { botName: _, displayName: __, receivedAt: ___, ...rest } = health;
    summary[botName] = { status: ageMs > 10 * 60_000 ? 'stale' : 'healthy', ...rest, ageMs };
  }
  res.json({ ok: true, bots: summary });
});

// --- POST /api/village/join ---
app.post('/api/village/join', villageLimiter, async (req, res) => {
  const auth = await validateToken(req);
  if (!auth) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const headers = { 'Content-Type': 'application/json' };
    if (VILLAGE_SECRET) headers['Authorization'] = `Bearer ${VILLAGE_SECRET}`;
    const resp = await fetch(`${VILLAGE_URL}/api/join`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ botName: auth.botName, remote: true, displayName: auth.displayName }),
      signal: AbortSignal.timeout(10_000),
    });
    const data = await resp.json();
    if (!resp.ok && resp.status !== 409) return res.status(resp.status).json(data);
    res.json({ ...data, ok: true, botName: auth.botName, config: remoteConfig });
  } catch (err) {
    console.error(`[hub] join failed: ${err.message}`);
    res.status(502).json({ error: 'Game server unreachable' });
  }
});

// --- POST /api/village/leave ---
app.post('/api/village/leave', villageLimiter, async (req, res) => {
  const auth = await validateToken(req);
  if (!auth) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const headers = { 'Content-Type': 'application/json' };
    if (VILLAGE_SECRET) headers['Authorization'] = `Bearer ${VILLAGE_SECRET}`;
    const resp = await fetch(`${VILLAGE_URL}/api/leave`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ botName: auth.botName }),
      signal: AbortSignal.timeout(10_000),
    });
    const data = await resp.json();
    res.status(resp.status).json(data);
  } catch (err) {
    console.error(`[hub] leave failed: ${err.message}`);
    res.status(502).json({ error: 'Game server unreachable' });
  }
});

// --- POST /api/village/kick/:botName — Force-remove a bot (operator only) ---
app.post('/api/village/kick/:botName', async (req, res) => {
  const auth = req.headers.authorization || '';
  if (!VILLAGE_SECRET || !safeEqual(auth, `Bearer ${VILLAGE_SECRET}`)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { botName } = req.params;
  const reason = req.body?.reason || 'Kicked by server';

  const kickPayload = { kick: true, reason };
  const waiter = pollWaiters.get(botName);
  if (waiter) {
    clearTimeout(waiter.timer);
    pollWaiters.delete(botName);
    waiter.resolve(kickPayload);
  } else {
    sceneQueue.set(botName, kickPayload);
  }

  try {
    const headers = { 'Content-Type': 'application/json' };
    if (VILLAGE_SECRET) headers['Authorization'] = `Bearer ${VILLAGE_SECRET}`;
    await fetch(`${VILLAGE_URL}/api/leave`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ botName }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch { /* best-effort */ }

  try { await tokenManager.revoke(botName); } catch { /* best-effort */ }

  console.log(`[hub] kicked ${botName}: ${reason}`);
  res.json({ ok: true, botName, reason });
});

// --- POST /api/village/invite/:token — One-time setup script for remote bots ---
app.post('/api/village/invite/:token', villageLimiter, async (req, res) => {
  const { token } = req.params;
  if (!token || !token.startsWith('vtk_')) {
    return res.status(400).type('text/plain').send('Invalid invite token.\n');
  }

  const tokens = await tokenManager.read();
  const entry = tokens[token];
  if (!entry || !entry.botName) return res.status(404).type('text/plain').send('Invite not found.\n');
  if (entry.claimedAt) return res.status(410).type('text/plain').send('This invite has already been used.\n');

  try {
    await tokenManager.update((data) => {
      if (data[token]) data[token].claimedAt = new Date().toISOString();
    });
  } catch (err) {
    console.error(`[hub] Failed to mark invite as claimed: ${err.message}`);
  }

  const hubUrl = VILLAGE_HUB_URL;
  const script = `#!/usr/bin/env bash
set -euo pipefail

# --- Village Plugin Setup ---
# Generated by OpenClaw Village Hub. Run: curl <url> | bash

VILLAGE_HUB="${hubUrl}"
VILLAGE_TOKEN="${token}"

echo "Installing village plugin..."
openclaw plugins install ggbot-village@latest

# --- Add env vars to gateway.env ---
OPENCLAW_DIR="\${1:-}"
if [ -z "\$OPENCLAW_DIR" ]; then
  if [ -d "\$HOME/.openclaw" ] && [ -f "\$HOME/.openclaw/openclaw.json" ]; then
    OPENCLAW_DIR="\$HOME/.openclaw"
  elif [ -d ".openclaw" ] && [ -f ".openclaw/openclaw.json" ]; then
    OPENCLAW_DIR=".openclaw"
  else
    echo "Error: Cannot find OpenClaw directory."
    echo ""
    echo "Usage: curl <url> | bash -s /path/to/.openclaw"
    echo "  or run from the directory containing .openclaw/"
    exit 1
  fi
fi

ENV_FILE=""
for candidate in "\$OPENCLAW_DIR/../gateway.env" "\$OPENCLAW_DIR/gateway.env"; do
  if [ -f "\$candidate" ]; then
    ENV_FILE="\$candidate"
    break
  fi
done

if [ -n "\$ENV_FILE" ]; then
  sed -i '/^VILLAGE_HUB=/d; /^VILLAGE_TOKEN=/d' "\$ENV_FILE"
  echo "VILLAGE_HUB=\$VILLAGE_HUB" >> "\$ENV_FILE"
  echo "VILLAGE_TOKEN=\$VILLAGE_TOKEN" >> "\$ENV_FILE"
  OWNER=\$(stat -c '%u:%g' "\$ENV_FILE" 2>/dev/null || echo "")
  if [ -n "\$OWNER" ] && [ "\$OWNER" != "\$(id -u):\$(id -g)" ]; then
    chown "\$OWNER" "\$ENV_FILE" 2>/dev/null || true
  fi
  echo "Added env vars to gateway.env"
else
  echo ""
  echo "No gateway.env found. Add these to your environment:"
  echo "  VILLAGE_HUB=\$VILLAGE_HUB"
  echo "  VILLAGE_TOKEN=\$VILLAGE_TOKEN"
fi

echo ""
echo "Done! Restart your bot to join the village."
`;

  res.type('text/plain').send(script);
});

// --- GET/POST /api/village/agenda/:botName ---
app.get('/api/village/agenda/:botName', villageLimiter, async (req, res) => {
  const auth = await validateToken(req);
  if (!auth) return res.status(401).json({ error: 'Unauthorized' });
  if (auth.botName !== req.params.botName) return res.status(403).json({ error: 'Token does not match bot name' });

  try {
    const headers = {};
    if (VILLAGE_SECRET) headers['Authorization'] = `Bearer ${VILLAGE_SECRET}`;
    const resp = await fetch(`${VILLAGE_URL}/api/agenda/${req.params.botName}`, {
      headers,
      signal: AbortSignal.timeout(5_000),
    });
    const data = await resp.json();
    res.status(resp.status).json(data);
  } catch {
    res.status(502).json({ error: 'Game server unreachable' });
  }
});

app.post('/api/village/agenda/:botName', villageLimiter, async (req, res) => {
  const auth = await validateToken(req);
  if (!auth) return res.status(401).json({ error: 'Unauthorized' });
  if (auth.botName !== req.params.botName) return res.status(403).json({ error: 'Token does not match bot name' });

  try {
    const headers = { 'Content-Type': 'application/json' };
    if (VILLAGE_SECRET) headers['Authorization'] = `Bearer ${VILLAGE_SECRET}`;
    const resp = await fetch(`${VILLAGE_URL}/api/agenda/${req.params.botName}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(req.body),
      signal: AbortSignal.timeout(5_000),
    });
    const data = await resp.json();
    res.status(resp.status).json(data);
  } catch {
    res.status(502).json({ error: 'Game server unreachable' });
  }
});

// --- POST /api/hub/tokens — Issue new token (operator only) ---
app.post('/api/hub/tokens', async (req, res) => {
  const auth = req.headers.authorization || '';
  if (!VILLAGE_SECRET || !safeEqual(auth, `Bearer ${VILLAGE_SECRET}`)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { botName, displayName } = req.body || {};
  if (!botName) return res.status(400).json({ error: 'Missing botName' });

  try {
    const token = await tokenManager.generate(botName, displayName);
    const inviteUrl = `${VILLAGE_HUB_URL}/api/village/invite/${token}`;
    console.log(`[hub] issued token for ${botName}: ${token}`);
    res.json({ ok: true, token, inviteUrl, botName });
  } catch (err) {
    console.error(`[hub] token generation failed: ${err.message}`);
    res.status(500).json({ error: 'Failed to generate token' });
  }
});

// --- DELETE /api/hub/tokens/:token — Revoke a specific token (operator only) ---
app.delete('/api/hub/tokens/:token', async (req, res) => {
  const auth = req.headers.authorization || '';
  if (!VILLAGE_SECRET || !safeEqual(auth, `Bearer ${VILLAGE_SECRET}`)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    await tokenManager.update((tokens) => { delete tokens[req.params.token]; });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to revoke token' });
  }
});

// --- GET /api/hub/health — Hub system health ---
app.get('/api/hub/health', (req, res) => {
  res.json({ ok: true, uptime: process.uptime(), gameServerRunning });
});

// --- Game server child process management ---
let gameServerRunning = false;
let restartAttempts = 0;
let gameChild = null;

function spawnGameServer() {
  const gameEnv = {
    ...process.env,
    VILLAGE_HUB_MODE: '1',
    VILLAGE_PORT: String(GAME_PORT),
    VILLAGE_RELAY_URL: `http://127.0.0.1:${HUB_PORT}`,
  };

  console.log('[hub] Starting game server...');
  gameChild = spawn('node', ['server.js'], {
    cwd: __dirname,
    env: gameEnv,
    stdio: 'inherit',
  });

  gameServerRunning = true;

  gameChild.on('exit', (code, signal) => {
    gameServerRunning = false;
    gameChild = null;

    if (code === 0 || signal === 'SIGTERM') {
      console.log('[hub] Game server exited cleanly');
      return;
    }

    restartAttempts++;
    const delay = Math.min(1000 * Math.pow(2, restartAttempts - 1), 30_000);
    console.error(`[hub] Game server crashed (code=${code}, signal=${signal}), restarting in ${delay}ms (attempt ${restartAttempts})`);
    setTimeout(spawnGameServer, delay);
  });

  gameChild.on('error', (err) => {
    console.error(`[hub] Game server spawn error: ${err.message}`);
  });
}

// --- Startup ---
async function main() {
  if (!VILLAGE_SECRET) {
    console.error('[hub] ERROR: VILLAGE_SECRET is required');
    process.exit(1);
  }

  await mkdir(DATA_DIR, { recursive: true });
  await mkdir(join(DATA_DIR, 'logs'), { recursive: true });

  const server = createServer(app);
  server.listen(HUB_PORT, '0.0.0.0', () => {
    console.log(`[hub] Listening on 0.0.0.0:${HUB_PORT}`);
    console.log(`[hub] Hub URL: ${VILLAGE_HUB_URL}`);
    console.log(`[hub] Data dir: ${DATA_DIR}`);
    spawnGameServer();
  });

  for (const sig of ['SIGTERM', 'SIGINT']) {
    process.on(sig, () => {
      console.log(`[hub] ${sig} received, shutting down`);
      if (gameChild) gameChild.kill('SIGTERM');
      server.close(() => process.exit(0));
    });
  }
}

main().catch((err) => {
  console.error('[hub] Fatal:', err);
  process.exit(1);
});
