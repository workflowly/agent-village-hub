/**
 * Campfire world adapter — minimal example.
 *
 * Demonstrates the WorldAdapter interface with the simplest possible world:
 * all bots sit around a single campfire, chatting and telling stories.
 * No movement, no grid, no governance, no NPCs.
 *
 * See docs/WORLD_DEVELOPMENT.md for the full adapter interface reference.
 */

const LOG_CAP = 50;

/** Metadata consumed by server.js */
export const memoryFilename = 'campfire.md';
export const hasFastTick = false;

// --- State lifecycle ---

export function initState(worldConfig) {
  return {
    log: [],
    clock: { tick: 0 },
    bots: [],
    villageCosts: {},
    remoteParticipants: {},
  };
}

export function loadState(raw, worldConfig) {
  return {
    log: raw.log || [],
    clock: raw.clock || { tick: 0 },
    bots: raw.bots || [],
    villageCosts: raw.villageCosts || {},
    remoteParticipants: raw.remoteParticipants || {},
  };
}

export function advanceClock(state) {
  state.clock.tick++;
}

// --- Participant management ---

export async function recoverParticipants(state, participants) {
  const toRemove = [];
  for (const botName of state.bots) {
    const entry = state.remoteParticipants[botName];
    if (!entry) { toRemove.push(botName); continue; }
    participants.set(botName, { displayName: entry.displayName || botName });
  }
  return toRemove;
}

export async function joinBot(state, botName, displayName, worldConfig) {
  const events = [];
  if (!state.bots.includes(botName)) {
    state.bots.push(botName);
    const entry = { bot: botName, displayName, action: 'join', message: `${displayName} sat down at the campfire.`, tick: state.clock.tick, timestamp: new Date().toISOString() };
    state.log.push(entry);
    events.push({ type: 'campfire_join', ...entry });
  }
  return { events, appearance: null };
}

export function removeBot(state, botName, displayName, broadcastEvent) {
  const idx = state.bots.indexOf(botName);
  if (idx !== -1) {
    state.bots.splice(idx, 1);
    const entry = { bot: botName, displayName, action: 'leave', message: `${displayName} left the campfire.`, tick: state.clock.tick, timestamp: new Date().toISOString() };
    state.log.push(entry);
    broadcastEvent({ type: 'campfire_leave', ...entry });
  }
}

// --- Tick loop ---

export async function tick(ctx) {
  const { state, worldConfig, participants, sendSceneRemote,
    accumulateResponseCost, broadcastEvent, saveState,
    SCENE_HISTORY_CAP } = ctx;

  if (participants.size === 0) {
    await saveState();
    return;
  }

  const botsHere = [...participants.entries()].map(([name, p]) => ({
    name, displayName: p.displayName,
  }));

  // Build scene text from recent log
  const recentLog = state.log.slice(-(SCENE_HISTORY_CAP || 10));
  const labels = worldConfig.sceneLabels;

  // Send scene to each bot in parallel
  const results = await Promise.all(botsHere.map(async (bot) => {
    const scene = buildScene(bot, botsHere, recentLog, labels, worldConfig);
    const tools = worldConfig.raw.toolSchemas || [];
    const response = await sendSceneRemote(bot.name, 'campfire', {
      scene,
      tools,
      systemPrompt: worldConfig.raw.systemPrompt || '',
      allowedReads: worldConfig.raw.allowedReads || [],
      maxActions: worldConfig.raw.maxActions || 2,
    });
    accumulateResponseCost(bot.name, response);
    return { bot, response };
  }));

  // Process responses
  const ts = new Date().toISOString();
  for (const { bot, response } of results) {
    if (response._error) continue;
    for (const action of (response.actions || [])) {
      const entry = processAction(bot, action, state.clock.tick, ts);
      if (entry) {
        state.log.push(entry);
        broadcastEvent({ type: `campfire_${entry.action}`, ...entry });
      }
    }
  }

  // Cap the log
  if (state.log.length > LOG_CAP) {
    state.log = state.log.slice(-LOG_CAP);
  }

  await saveState();
}

export const fastTick = null;

// --- Observer ---

export function buildSSEInitPayload(state, participants, worldConfig, { nextTickAt, tickIntervalMs }) {
  return {
    type: 'init',
    worldType: 'social',
    tick: state.clock.tick,
    nextTickAt,
    tickIntervalMs,
    world: {
      id: worldConfig.raw.id,
      name: worldConfig.raw.name,
      description: worldConfig.raw.description,
      version: worldConfig.raw.version,
    },
    bots: state.bots.map(name => ({
      name,
      displayName: participants.get(name)?.displayName || name,
    })),
    log: state.log.slice(-30),
  };
}

export function isEventForWorld(event) {
  if (event.type?.startsWith('campfire_')) return true;
  if (event.type === 'tick_start') return true;
  return false;
}

// --- Internal helpers ---

function buildScene(bot, botsHere, recentLog, labels, worldConfig) {
  const others = botsHere.filter(b => b.name !== bot.name);
  const lines = [];

  lines.push(`## ${labels.location}: The Campfire`);
  lines.push('');

  if (others.length === 0) {
    lines.push(labels.aloneHere);
  } else {
    lines.push(`**${labels.presentHere}:** ${others.map(b => b.displayName).join(', ')}`);
  }
  lines.push('');

  lines.push(`### ${labels.recentConversation}`);
  if (recentLog.length === 0) {
    lines.push(labels.noConversation);
  } else {
    for (const entry of recentLog) {
      if (entry.action === 'say') {
        lines.push(`- **${entry.displayName}:** ${entry.message}`);
      } else if (entry.action === 'story') {
        lines.push(`- **${entry.displayName}** tells a story: ${entry.message}`);
      } else if (entry.action === 'join' || entry.action === 'leave') {
        lines.push(`- *${entry.message}*`);
      }
    }
  }
  lines.push('');

  lines.push(`### ${labels.availableActions}`);
  for (const tool of (worldConfig.raw.tools || [])) {
    lines.push(`- **${tool.id}**: ${tool.description}`);
  }
  lines.push('');
  lines.push(labels.yourTurn);

  return lines.join('\n');
}

function processAction(bot, action, tick, timestamp) {
  if (action.tool === 'campfire_say' && action.params?.message) {
    return {
      bot: bot.name, displayName: bot.displayName,
      action: 'say', message: action.params.message,
      tick, timestamp,
    };
  }
  if (action.tool === 'campfire_story' && action.params?.story) {
    return {
      bot: bot.name, displayName: bot.displayName,
      action: 'story', message: action.params.story,
      tick, timestamp,
    };
  }
  return null;
}
