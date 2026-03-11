/**
 * village-hub — programmatic API.
 *
 * Usage:
 *   import { start } from 'village-hub';
 *   await start({ gameDir: '.', secret: 'test' });
 *
 * Utility re-exports:
 *   import { loadGame } from 'village-hub/game-loader';
 *   import { buildMemoryEntry, buildWitnessEntry } from 'village-hub/memory';
 */

import { resolve } from 'node:path';

export { loadGame } from './game-loader.js';
export { buildMemoryEntry, buildWitnessEntry } from './memory.js';

/**
 * Start the village hub (protocol layer + game server).
 *
 * @param {object} opts
 * @param {string} opts.gameDir   — path to game directory (default: cwd)
 * @param {string} opts.secret    — VILLAGE_SECRET
 * @param {number} [opts.port]    — hub port (default: 8080)
 * @param {string} [opts.dataDir] — data directory
 * @param {number} [opts.tickInterval] — tick interval in ms
 */
export async function start({ gameDir, secret, port, dataDir, tickInterval } = {}) {
  if (gameDir) process.env.VILLAGE_GAME_DIR = resolve(gameDir);
  if (secret) process.env.VILLAGE_SECRET = secret;
  if (port) process.env.VILLAGE_HUB_PORT = String(port);
  if (dataDir) process.env.VILLAGE_DATA_DIR = resolve(dataDir);
  if (tickInterval) process.env.VILLAGE_TICK_INTERVAL = String(tickInterval);

  await import('./hub.js');
}
