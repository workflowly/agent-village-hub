/**
 * Social-village game adapter.
 *
 * Implements the GameAdapter interface for server.js:
 *   initState, loadState, advanceClock, recoverParticipants,
 *   joinBot, removeBot, tick, buildSSEInitPayload, isEventForGame
 *
 * server.js delegates all game-specific logic here.
 * No knowledge of HTTP, child processes, or token management.
 */

import { advanceClock as advanceClockImpl } from './logic.js';
import { socialTick } from './tick.js';
import { initNPCs, runNPCTick, probeAPIRouter, getNPCProfiles } from './npcs.js';
import { getVillageTime } from './scene.js';
import { generateAppearance } from './appearance.js';

const SURVIVAL_TYPES = new Set(['survival_event', 'survival_tick', 'fast_tick', 'thinking']);

/** Metadata consumed by server.js */
export const memoryFilename = 'village.md';
export const hasFastTick = false;

// --- State lifecycle ---

export function initState(gameConfig) {
  const state = {
    locations: {},
    whispers: {},
    publicLogs: {},
    clock: { tick: 0, phase: 'morning', ticksInPhase: 0 },
    emptyTicks: {},
    villageCosts: {},
    locationState: {},
    customLocations: {},
    remoteParticipants: {},
    occupations: {},
    memories: {},
    agendas: {},
    newsBulletins: [],
    exiles: {},
  };
  for (const loc of gameConfig.locationSlugs) {
    state.locations[loc] = [];
    state.publicLogs[loc] = [];
    state.emptyTicks[loc] = 0;
  }
  return state;
}

export function loadState(raw, gameConfig) {
  const state = {
    locations: raw.locations || {},
    whispers: raw.whispers || {},
    publicLogs: raw.publicLogs || {},
    clock: raw.clock || { tick: 0, phase: 'morning', ticksInPhase: 0 },
    emptyTicks: raw.emptyTicks || {},
    villageCosts: raw.villageCosts || {},
    locationState: raw.locationState || {},
    customLocations: raw.customLocations || {},
    remoteParticipants: raw.remoteParticipants || {},
    occupations: raw.occupations || {},
    memories: raw.memories || {},
    agendas: raw.agendas || {},
    newsBulletins: raw.newsBulletins || [],
    exiles: raw.exiles || {},
  };
  // Ensure all schema locations exist
  for (const loc of gameConfig.locationSlugs) {
    if (!state.locations[loc]) state.locations[loc] = [];
    if (!state.publicLogs[loc]) state.publicLogs[loc] = [];
    if (!state.emptyTicks[loc]) state.emptyTicks[loc] = 0;
  }
  // Ensure all custom locations exist
  for (const loc of Object.keys(state.customLocations)) {
    if (!state.locations[loc]) state.locations[loc] = [];
    if (!state.publicLogs[loc]) state.publicLogs[loc] = [];
    if (!state.emptyTicks[loc]) state.emptyTicks[loc] = 0;
  }
  // Remove deprecated fields
  for (const f of ['emotions', 'stagnation', 'eventState', 'autopilotState',
    'fastTickSummary', 'relationships', 'bonds', 'spiceState', 'explorations']) {
    delete state[f];
  }
  console.log(`[village] State loaded: tick=${state.clock.tick} phase=${state.clock.phase} customLocations=${Object.keys(state.customLocations).length}`);
  return state;
}

export function advanceClock(state, gameConfig, ticksPerPhase) {
  advanceClockImpl(state.clock, ticksPerPhase, gameConfig.phases);
}

// --- Participant management ---

/**
 * Recover participants from persisted state after a restart.
 * Populates the participants Map and returns bot names that should be removed
 * from state (in locations but not in remoteParticipants).
 *
 * @param {object} state
 * @param {Map} participants  - mutated in place
 * @param {object} gameConfig
 * @returns {string[]} bot names to hard-remove
 */
export async function recoverParticipants(state, participants, gameConfig) {
  const allLocs = [
    ...gameConfig.locationSlugs,
    ...Object.keys(state.customLocations || {}),
  ];

  const botsInState = new Set();
  for (const loc of allLocs) {
    for (const name of (state.locations[loc] || [])) botsInState.add(name);
  }

  const remoteCount = Object.keys(state.remoteParticipants || {}).length;
  if (botsInState.size === 0 && remoteCount === 0) {
    console.log('[village] Recovery: no bots in state');
    return [];
  }

  console.log(`[village] Recovery: checking ${botsInState.size} bot(s) from state...`);

  const toRemove = [];

  // Phase 1: bots present in locations
  for (const botName of botsInState) {
    if (botName.startsWith('npc-')) continue; // re-initialized by initNPCs
    const entry = state.remoteParticipants?.[botName];
    if (!entry) { toRemove.push(botName); continue; }
    let appearance = null;
    try {
      appearance = await generateAppearance(botName, state.occupations?.[botName]?.title || null);
    } catch { /* non-critical */ }
    participants.set(botName, { displayName: entry.displayName || botName, appearance });
    console.log(`[village] Recovery: ${botName} OK`);
  }

  // Phase 2: bots in remoteParticipants but not in any location — re-place at spawn
  for (const [botName, entry] of Object.entries(state.remoteParticipants || {})) {
    if (participants.has(botName) || botName.startsWith('npc-')) continue;
    let appearance = null;
    try {
      appearance = await generateAppearance(botName, state.occupations?.[botName]?.title || null);
    } catch { /* non-critical */ }
    participants.set(botName, { displayName: entry.displayName || botName, appearance });
    state.locations[gameConfig.spawnLocation].push(botName);
    console.log(`[village] Recovery: ${botName} restored → ${gameConfig.spawnLocation}`);
  }

  return toRemove;
}

/**
 * Add a bot to the village world.
 * Returns { events, appearance } — server.js broadcasts events and updates participants.
 */
export async function joinBot(state, botName, displayName, gameConfig) {
  let appearance = null;
  try {
    appearance = await generateAppearance(botName, state.occupations?.[botName]?.title || null);
  } catch (err) {
    console.warn(`[village] Failed to generate appearance for ${botName}: ${err.message}`);
  }

  const allLocs = [
    ...gameConfig.locationSlugs,
    ...Object.keys(state.customLocations || {}),
  ];
  const alreadyIn = allLocs.some(loc => (state.locations[loc] || []).includes(botName));

  const events = [];
  if (!alreadyIn) {
    state.locations[gameConfig.spawnLocation].push(botName);
    events.push({
      type: 'movement', bot: botName, displayName,
      action: 'join', location: gameConfig.spawnLocation, tick: state.clock.tick,
      ...(appearance ? { appearance } : {}),
    });
    (state.publicLogs[gameConfig.spawnLocation] ??= []).push({
      bot: botName, action: 'say',
      message: `*${displayName} has joined the village!*`,
    });
  }
  return { events, appearance };
}

/**
 * Remove a bot from the village world and broadcast leave events.
 */
export function removeBot(state, botName, displayName, broadcastEvent) {
  const allLocs = [
    ...Object.keys(state.locations || {}),
    ...Object.keys(state.customLocations || {}),
  ];
  for (const loc of allLocs) {
    if (!state.locations[loc]) continue;
    const idx = state.locations[loc].indexOf(botName);
    if (idx !== -1) {
      state.locations[loc].splice(idx, 1);
      broadcastEvent({ type: 'movement', bot: botName, displayName, action: 'leave', location: loc, tick: state.clock.tick });
      (state.publicLogs[loc] ??= []).push({ bot: botName, action: 'say', message: `*${displayName} has left the village.*` });
    }
  }
  if (state.whispers) delete state.whispers[botName];
}

// --- Game loop ---

export async function tick(ctx) {
  await socialTick(ctx);
  await runNPCTick(ctx);
}

export const fastTick = null; // social village has no fast tick

// --- Observer ---

export function buildSSEInitPayload(state, participants, gameConfig, { nextTickAt, tickIntervalMs }) {
  const vt = getVillageTime(gameConfig.timezone);
  const allLocs = [
    ...gameConfig.locationSlugs,
    ...Object.keys(state.customLocations || {}),
  ];
  return {
    type: 'init',
    gameType: 'social',
    tick: state.clock.tick,
    phase: vt.phase,
    villageTime: vt.timeStr,
    paused: false,
    nextTickAt,
    tickIntervalMs,
    game: {
      id: gameConfig.raw.id,
      name: gameConfig.raw.name,
      description: gameConfig.raw.description,
      version: gameConfig.raw.version,
    },
    locations: Object.fromEntries(
      allLocs.map(l => [l, (state.locations[l] || []).map(b => ({
        name: b, displayName: participants.get(b)?.displayName || b,
        ...(participants.get(b)?.appearance ? { appearance: participants.get(b).appearance } : {}),
      }))])
    ),
    publicLogs: Object.fromEntries(
      allLocs.filter(l => (state.publicLogs[l] || []).length > 0)
        .map(l => [l, state.publicLogs[l].map(e => ({
          ...e, displayName: participants.get(e.bot)?.displayName || e.bot,
        }))])
    ),
    customLocations: state.customLocations || {},
    occupations: state.occupations || {},
    governance: state.governance || {},
    exiles: state.exiles || {},
    memories: state.memories || {},
    agendas: state.agendas || {},
    newsBulletins: state.newsBulletins || [],
    locationFlavors: Object.fromEntries(
      Object.entries(gameConfig.raw.locations || {}).map(([k, v]) => [k, v.flavor || ''])
    ),
    npcProfiles: getNPCProfiles(),
  };
}

/** True if event belongs to this game type (used to filter /api/logs) */
export function isEventForGame(event) {
  if (SURVIVAL_TYPES.has(event.type)) return false;
  if (event.type === 'tick' && event.botStates && !event.actions) return false;
  return true;
}

// --- NPC lifecycle (social-only) ---

export function initNPCsForGame(state, participants, gameConfig) {
  initNPCs(state, participants, gameConfig);
}

export function probeAPIRouterForGame() {
  probeAPIRouter();
}
