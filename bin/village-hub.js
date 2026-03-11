#!/usr/bin/env node

/**
 * CLI entry point for village-hub.
 *
 * Usage:
 *   npx village-hub                     # world dir = cwd
 *   npx village-hub --world-dir ./my-world
 *   VILLAGE_SECRET=test npx village-hub
 */

import { resolve } from 'node:path';

// Parse --world-dir flag (defaults to cwd)
const args = process.argv.slice(2);
let worldDir = process.cwd();

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--world-dir' && args[i + 1]) {
    worldDir = resolve(args[i + 1]);
    i++;
  }
}

// Set VILLAGE_WORLD_DIR so server.js picks it up
process.env.VILLAGE_WORLD_DIR = worldDir;

// Import hub.js to start the full hub (protocol + world server)
await import('../hub.js');
