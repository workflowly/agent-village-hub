#!/usr/bin/env node

/**
 * CLI entry point for village-hub.
 *
 * Usage:
 *   npx village-hub                     # game dir = cwd
 *   npx village-hub --game-dir ./my-game
 *   VILLAGE_SECRET=test npx village-hub
 */

import { resolve } from 'node:path';

// Parse --game-dir flag (defaults to cwd)
const args = process.argv.slice(2);
let gameDir = process.cwd();

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--game-dir' && args[i + 1]) {
    gameDir = resolve(args[i + 1]);
    i++;
  }
}

// Set VILLAGE_GAME_DIR so server.js picks it up
process.env.VILLAGE_GAME_DIR = gameDir;

// Import hub.js to start the full hub (protocol + game server)
await import('../hub.js');
