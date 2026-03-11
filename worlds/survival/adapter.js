/**
 * Survival game adapter.
 *
 * Implements the GameAdapter interface for server.js:
 *   initState, loadState, advanceClock, recoverParticipants,
 *   joinBot, removeBot, tick, fastTick, buildSSEInitPayload, isEventForWorld
 */

import { survivalTick, fastTick as survivalFastTick } from './tick.js';
import { getDayPhase } from './scene.js';
import { generateWorld, placeInitialResources, mulberry32, randomEdgeTile } from './world.js';

const SOCIAL_TYPES = new Set(['action', 'ambient', 'idle', 'autopilot_move']);

/** Metadata consumed by server.js */
export const memoryFilename = 'survival.md';
export const hasFastTick = true;

// --- State lifecycle ---

export async function initState(worldConfig) {
  console.log('[village] Generating world...');
  const worldConfig = worldConfig.raw.world;
  const rng = mulberry32(worldConfig.seed);
  const { terrain } = generateWorld(worldConfig);
  const tileData = placeInitialResources(terrain, worldConfig, rng);
  console.log(`[village] World generated: ${worldConfig.width}x${worldConfig.height}, ${Object.keys(tileData).length} resource tiles`);
  return {
    terrain,
    tileData,
    bots: {},
    recentEvents: [],
    clock: { tick: 0, dayTick: 0 },
    worldSeed: worldConfig.seed,
    villageCosts: {},
    remoteParticipants: {},
    round: {
      number: 1,
      ticksRemaining: worldConfig.raw.scoring?.roundLength || 50,
      scores: {},
      roundHistory: [],
    },
    diplomacy: { alliances: {}, proposals: {}, betrayals: [] },
  };
}

export function loadState(raw, worldConfig) {
  const state = {
    terrain: raw.terrain || '',
    tileData: raw.tileData || {},
    bots: raw.bots || {},
    recentEvents: raw.recentEvents || [],
    clock: raw.clock || { tick: 0, dayTick: 0 },
    worldSeed: raw.worldSeed || worldConfig.raw.world.seed,
    villageCosts: raw.villageCosts || {},
    remoteParticipants: raw.remoteParticipants || {},
    round: raw.round || {
      number: 1,
      ticksRemaining: worldConfig.raw.scoring?.roundLength || 50,
      scores: {},
      roundHistory: [],
    },
    diplomacy: raw.diplomacy || { alliances: {}, proposals: {}, betrayals: [] },
  };
  console.log(`[village] Grid state loaded: tick=${state.clock.tick} bots=${Object.keys(state.bots).length}`);
  return state;
}

export function advanceClock(state, worldConfig) {
  state.clock.tick++;
  state.clock.dayTick = state.clock.tick % worldConfig.raw.dayNight.cycleTicks;
}

// --- Participant management ---

export async function recoverParticipants(state, participants) {
  const botsInState = Object.keys(state.bots || {});
  if (botsInState.length === 0) {
    console.log('[village] Recovery: no bots in state');
    return [];
  }

  console.log(`[village] Recovery: checking ${botsInState.length} bot(s) from state...`);
  const toRemove = [];
  for (const botName of botsInState) {
    const entry = state.remoteParticipants?.[botName];
    if (!entry) { toRemove.push(botName); continue; }
    participants.set(botName, { displayName: entry.displayName || botName });
    console.log(`[village] Recovery: ${botName} OK`);
  }
  return toRemove;
}

export async function joinBot(state, botName, displayName, worldConfig) {
  const events = [];
  if (!state.bots[botName]) {
    const rng = mulberry32(state.worldSeed + Date.now());
    const pos = randomEdgeTile(
      state.terrain,
      worldConfig.raw.world.width,
      worldConfig.raw.world.height,
      worldConfig.raw.world.terrain,
      rng
    );
    state.bots[botName] = {
      x: pos.x, y: pos.y,
      health: worldConfig.raw.survival.maxHealth,
      hunger: 0,
      inventory: {},
      equipment: { weapon: null, armor: null, tool: null },
      alive: true,
      directive: { intent: 'idle', target: null, fallback: null, x: null, y: null, setAt: 0 },
      path: null,
      pathIdx: 0,
      fastTickStats: { tilesMoved: 0, itemsGathered: [], damageDealt: 0, damageTaken: 0 },
    };
    events.push({
      type: 'survival_event', bot: botName, displayName,
      action: 'join', x: pos.x, y: pos.y, tick: state.clock.tick,
    });
    console.log(`[village] ${botName} spawned at (${pos.x},${pos.y})`);
  }
  if (worldConfig.raw.scoring && state.round) {
    if (state.round.scores[botName] === undefined) state.round.scores[botName] = 0;
  }
  return { events, appearance: null };
}

export function removeBot(state, botName, displayName, broadcastEvent) {
  if (state.bots[botName]) {
    broadcastEvent({ type: 'survival_event', bot: botName, displayName, action: 'leave', tick: state.clock.tick });
    delete state.bots[botName];
  }
}

// --- Game loop ---

export async function tick(ctx) {
  await survivalTick(ctx);
}

export function fastTick(ctx) {
  if (!ctx.state.terrain) return;
  survivalFastTick(ctx);
}

// --- Observer ---

export function buildSSEInitPayload(state, participants, worldConfig, { nextTickAt, tickIntervalMs }) {
  const dayPhase = getDayPhase(state.clock.tick, worldConfig.raw.dayNight);
  return {
    type: 'init',
    worldType: 'grid',
    tick: state.clock.tick,
    dayPhase: dayPhase.name,
    paused: false,
    nextTickAt,
    tickIntervalMs,
    game: {
      id: worldConfig.raw.id,
      name: worldConfig.raw.name,
      version: worldConfig.raw.version,
    },
    world: { width: worldConfig.raw.world.width, height: worldConfig.raw.world.height },
    terrain: state.terrain,
    bots: Object.fromEntries(
      Object.entries(state.bots).map(([name, bs]) => [name, {
        x: bs.x, y: bs.y, health: bs.health, hunger: bs.hunger, alive: bs.alive,
        equipment: bs.equipment, inventory: bs.inventory,
        displayName: participants.get(name)?.displayName || name,
        seenTiles: bs.seenTiles ? Object.keys(bs.seenTiles) : [],
      }])
    ),
    resources: Object.keys(state.tileData)
      .filter(k => state.tileData[k].resources?.length > 0)
      .map(k => { const [x, y] = k.split(',').map(Number); return { x, y }; }),
    recentEvents: (state.recentEvents || []).slice(-20),
    round: state.round ? {
      number: state.round.number,
      ticksRemaining: state.round.ticksRemaining,
      scores: state.round.scores,
      roundHistory: state.round.roundHistory,
    } : null,
    diplomacy: state.diplomacy || null,
  };
}

export function isEventForWorld(event) {
  if (SOCIAL_TYPES.has(event.type)) return false;
  if (event.type === 'tick' && event.actions && !event.botStates) return false;
  return true;
}
