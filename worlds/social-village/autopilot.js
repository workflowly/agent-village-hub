/**
 * Social Village Autopilot — non-LLM fast tick simulation layer.
 *
 * Pure functions, no module-level state, no I/O.
 * Generates ambient atmosphere, idle behaviors, and autonomous movement
 * between LLM ticks to make the village feel alive.
 *
 * Single export: runSocialFastTick(state, worldConfig, participants)
 * Returns { events: Array } for server to broadcast.
 */

import { getVillageTime } from './scene.js';

// --- Helpers ---

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * Find which location a bot is in.
 */
function findBotLocation(botName, state) {
  for (const [loc, bots] of Object.entries(state.locations)) {
    if (bots.includes(botName)) return loc;
  }
  return null;
}

// --- Ambient Events ---

/**
 * Roll ambient atmosphere event for a location.
 * ~ambientChance per occupied location per fast tick.
 * Respects cooldown to avoid back-to-back at same location.
 */
function rollAmbient(location, autopilotState, worldConfig) {
  const cfg = worldConfig.raw.autopilot;
  const ambientPool = worldConfig.raw.ambientEvents?.[location];
  if (!ambientPool || ambientPool.length === 0) return null;

  // Cooldown check
  const locState = autopilotState.ambientCooldowns || {};
  if ((locState[location] || 0) > 0) return null;

  if (Math.random() > cfg.ambientChance) return null;

  const text = pick(ambientPool);

  // Set cooldown
  if (!autopilotState.ambientCooldowns) autopilotState.ambientCooldowns = {};
  autopilotState.ambientCooldowns[location] = cfg.cooldownFastTicks;

  return { type: 'ambient', location, text };
}

// --- Idle Behaviors ---

/**
 * Roll idle behavior for a bot.
 * ~idleChance per bot per fast tick.
 * Pool selection: 50% location → 50% universal.
 */
function rollIdle(botName, displayName, location, worldConfig) {
  const cfg = worldConfig.raw.autopilot;
  const behaviors = worldConfig.raw.idleBehaviors;
  if (!behaviors) return null;

  if (Math.random() > cfg.idleChance) return null;

  let pool = null;
  const roll = Math.random();

  // 50% chance: location-specific pool
  if (roll < 0.5) {
    const locationPool = behaviors.location?.[location];
    if (locationPool && locationPool.length > 0) pool = locationPool;
  }

  // 30% chance (or fallback): universal pool
  if (!pool) {
    pool = behaviors.universal;
  }

  if (!pool || pool.length === 0) return null;

  const template = pick(pool);
  const text = template.text.replace(/\{name\}/g, displayName);

  return { type: 'idle', bot: botName, displayName, location, text };
}

// --- Autonomous Movement ---

/**
 * Get time-of-day phase for routine selection.
 */
function getPhase(worldConfig) {
  const vt = getVillageTime(worldConfig.timezone);
  return vt.phase;
}

/**
 * Score a location for a bot based on routine affinity and social gravity.
 */
function scoreLocation(loc, botName, phase, state, worldConfig) {
  const cfg = worldConfig.raw.autopilot;
  let score = 0;

  // Routine affinity: check if location is in default routine for this phase
  const routines = cfg.routines?.[phase];
  if (routines?.default?.includes(loc)) {
    score += 3;
  }

  // Occupation keyword matching
  const occupation = state.occupations?.[botName]?.title?.toLowerCase() || '';
  if (occupation) {
    const keywords = cfg.occupationKeywords?.[loc];
    if (keywords) {
      for (const kw of keywords) {
        if (occupation.includes(kw)) {
          score += 5;
          break;
        }
      }
    }
  }

  // Small random factor to prevent deterministic herding
  score += Math.random() * 2;

  return score;
}

/**
 * Roll autonomous movement for a bot.
 * ~moveChance per bot per fast tick.
 * Respects move cooldown (moveCooldownFastTicks).
 */
function rollAutoMove(botName, displayName, currentLoc, state, worldConfig, autopilotState) {
  const cfg = worldConfig.raw.autopilot;

  // Move cooldown check
  const moveCooldowns = autopilotState.moveCooldowns || {};
  if ((moveCooldowns[botName] || 0) > 0) return null;

  if (Math.random() > cfg.moveChance) return null;

  const phase = getPhase(worldConfig);

  // Score all other locations
  const allLocs = [
    ...worldConfig.locationSlugs,
    ...Object.keys(state.customLocations || {}),
  ].filter(l => l !== currentLoc);

  if (allLocs.length === 0) return null;

  // Pick best scored location
  let bestLoc = null;
  let bestScore = -Infinity;
  for (const loc of allLocs) {
    const s = scoreLocation(loc, botName, phase, state, worldConfig);
    if (s > bestScore) { bestScore = s; bestLoc = loc; }
  }

  if (!bestLoc) return null;

  // Set move cooldown
  if (!autopilotState.moveCooldowns) autopilotState.moveCooldowns = {};
  autopilotState.moveCooldowns[botName] = cfg.moveCooldownFastTicks;

  return {
    type: 'autopilot_move',
    bot: botName,
    displayName,
    from: currentLoc,
    to: bestLoc,
    fromName: worldConfig.locationNames[currentLoc] || state.customLocations?.[currentLoc]?.name || currentLoc,
    toName: worldConfig.locationNames[bestLoc] || state.customLocations?.[bestLoc]?.name || bestLoc,
  };
}

// --- Main Fast Tick ---

/**
 * Run one social fast tick cycle.
 *
 * @param {object} state - World state (mutable — moves update state.locations)
 * @param {object} worldConfig - Loaded world configuration
 * @param {Map} participants - botName → { port, displayName }
 * @returns {{ events: Array }}
 */
export function runSocialFastTick(state, worldConfig, participants) {
  if (!worldConfig.raw.autopilot) return { events: [] };

  // Initialize autopilot state if needed
  if (!state.autopilotState) {
    state.autopilotState = {
      ambientCooldowns: {},
      moveCooldowns: {},
    };
  }
  const apState = state.autopilotState;

  // Decrement cooldowns
  for (const loc of Object.keys(apState.ambientCooldowns || {})) {
    if (apState.ambientCooldowns[loc] > 0) apState.ambientCooldowns[loc]--;
  }
  for (const bot of Object.keys(apState.moveCooldowns || {})) {
    if (apState.moveCooldowns[bot] > 0) apState.moveCooldowns[bot]--;
  }

  const events = [];

  // All locations (schema + custom)
  const allLocs = [
    ...worldConfig.locationSlugs,
    ...Object.keys(state.customLocations || {}),
  ];

  // 1. Ambient events for occupied locations
  for (const loc of allLocs) {
    const botsAtLoc = state.locations[loc] || [];
    if (botsAtLoc.length === 0) continue;

    const ambient = rollAmbient(loc, apState, worldConfig);
    if (ambient) {
      ambient.locationName = worldConfig.locationNames[loc] || state.customLocations?.[loc]?.name || loc;
      events.push(ambient);
    }
  }

  // 2. Idle behaviors + 3. Autonomous movement for each bot
  for (const [botName, info] of participants) {
    const loc = findBotLocation(botName, state);
    if (!loc) continue;

    const displayName = info.displayName || botName;

    // Idle behavior
    const idle = rollIdle(botName, displayName, loc, worldConfig);
    if (idle) events.push(idle);

    // Autonomous movement
    const move = rollAutoMove(botName, displayName, loc, state, worldConfig, apState);
    if (move) {
      // Apply the move to state
      const fromBots = state.locations[move.from];
      if (fromBots) {
        const idx = fromBots.indexOf(botName);
        if (idx !== -1) fromBots.splice(idx, 1);
      }
      if (!state.locations[move.to]) state.locations[move.to] = [];
      state.locations[move.to].push(botName);

      events.push(move);
    }
  }

  // Buffer events into fastTickSummary for next LLM scene
  if (!state.fastTickSummary) state.fastTickSummary = {};
  for (const ev of events) {
    const loc = ev.location || ev.to; // ambient/idle use .location, moves use .to
    if (!loc) continue;
    if (!state.fastTickSummary[loc]) state.fastTickSummary[loc] = [];

    let summary;
    if (ev.type === 'ambient') {
      summary = ev.text;
    } else if (ev.type === 'idle') {
      summary = ev.text;
    } else if (ev.type === 'autopilot_move') {
      summary = `${ev.displayName} arrived from ${ev.fromName}.`;
      // Also note departure at source location
      if (!state.fastTickSummary[ev.from]) state.fastTickSummary[ev.from] = [];
      state.fastTickSummary[ev.from].push(`${ev.displayName} left for ${ev.toName}.`);
    }

    if (summary) state.fastTickSummary[loc].push(summary);
  }

  // Cap summary per location to prevent unbounded growth
  for (const loc of Object.keys(state.fastTickSummary)) {
    if (state.fastTickSummary[loc].length > 30) {
      state.fastTickSummary[loc] = state.fastTickSummary[loc].slice(-30);
    }
  }

  return { events };
}
