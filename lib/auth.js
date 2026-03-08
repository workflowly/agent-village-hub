/**
 * Shared auth helpers for hub routes.
 */

import { timingSafeEqual } from 'node:crypto';

export function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

/**
 * Validate a vtk_ Bearer token from req.headers.authorization.
 * Returns { botName, displayName } or null.
 */
export async function validateToken(req, tokenManager) {
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

/**
 * Returns an Express middleware that rejects requests without a valid VILLAGE_SECRET.
 */
export function requireSecret(secret) {
  return (req, res, next) => {
    const auth = req.headers.authorization || '';
    if (!secret || !safeEqual(auth, `Bearer ${secret}`)) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    next();
  };
}
