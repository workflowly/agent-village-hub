/**
 * World proxy routes — authenticated pass-throughs to the world server.
 *
 * join, leave, and agenda are forwarded to the internal world server after
 * verifying the bot's vtk_ token. Hub adds botName from the token, not the
 * request body.
 *
 * Mount at /api/village.
 *
 * Dependencies injected by hub.js:
 *   tokenManager — lib/token-manager.js
 *   config       — { VILLAGE_SECRET, SERVER_URL, remoteConfig }
 *   limiter      — express-rate-limit instance
 */

import { Router } from 'express';
import { validateToken } from '../lib/auth.js';

export function createWorldProxyRouter({ tokenManager, config, limiter }) {
  const { VILLAGE_SECRET, SERVER_URL, remoteConfig } = config;
  const router = Router();

  function serverHeaders() {
    const h = { 'Content-Type': 'application/json' };
    if (VILLAGE_SECRET) h['Authorization'] = `Bearer ${VILLAGE_SECRET}`;
    return h;
  }

  // --- POST /join ---
  router.post('/join', limiter, async (req, res) => {
    const auth = await validateToken(req, tokenManager);
    if (!auth) return res.status(401).json({ error: 'Unauthorized' });

    try {
      const resp = await fetch(`${SERVER_URL}/api/join`, {
        method: 'POST',
        headers: serverHeaders(),
        body: JSON.stringify({ botName: auth.botName, remote: true, displayName: auth.displayName }),
        signal: AbortSignal.timeout(10_000),
      });
      const data = await resp.json();
      if (!resp.ok && resp.status !== 409) return res.status(resp.status).json(data);
      res.json({ ...data, ok: true, botName: auth.botName, config: remoteConfig });
    } catch (err) {
      console.error(`[hub] join failed: ${err.message}`);
      res.status(502).json({ error: 'World server unreachable' });
    }
  });

  // --- POST /leave ---
  router.post('/leave', limiter, async (req, res) => {
    const auth = await validateToken(req, tokenManager);
    if (!auth) return res.status(401).json({ error: 'Unauthorized' });

    try {
      const resp = await fetch(`${SERVER_URL}/api/leave`, {
        method: 'POST',
        headers: serverHeaders(),
        body: JSON.stringify({ botName: auth.botName }),
        signal: AbortSignal.timeout(10_000),
      });
      const data = await resp.json();
      res.status(resp.status).json(data);
    } catch (err) {
      console.error(`[hub] leave failed: ${err.message}`);
      res.status(502).json({ error: 'World server unreachable' });
    }
  });

  // --- GET /agenda/:botName ---
  router.get('/agenda/:botName', limiter, async (req, res) => {
    const auth = await validateToken(req, tokenManager);
    if (!auth) return res.status(401).json({ error: 'Unauthorized' });
    if (auth.botName !== req.params.botName) return res.status(403).json({ error: 'Token does not match bot name' });

    try {
      const resp = await fetch(`${SERVER_URL}/api/agenda/${req.params.botName}`, {
        headers: VILLAGE_SECRET ? { 'Authorization': `Bearer ${VILLAGE_SECRET}` } : {},
        signal: AbortSignal.timeout(5_000),
      });
      res.status(resp.status).json(await resp.json());
    } catch {
      res.status(502).json({ error: 'World server unreachable' });
    }
  });

  // --- POST /agenda/:botName ---
  router.post('/agenda/:botName', limiter, async (req, res) => {
    const auth = await validateToken(req, tokenManager);
    if (!auth) return res.status(401).json({ error: 'Unauthorized' });
    if (auth.botName !== req.params.botName) return res.status(403).json({ error: 'Token does not match bot name' });

    try {
      const resp = await fetch(`${SERVER_URL}/api/agenda/${req.params.botName}`, {
        method: 'POST',
        headers: serverHeaders(),
        body: JSON.stringify(req.body),
        signal: AbortSignal.timeout(5_000),
      });
      res.status(resp.status).json(await resp.json());
    } catch {
      res.status(502).json({ error: 'World server unreachable' });
    }
  });

  return router;
}
