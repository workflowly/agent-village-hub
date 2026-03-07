/**
 * Action handler registry — each action type is a standalone function.
 *
 * Handler signature:
 *   function handleX(ctx) → event object | null
 *   ctx = { botName, params, location, state, tick, validLocations, lastMoveTick, onCooldown }
 */

import { ensureGovernance, handlePropose, handleVote, handleDecree, handleExile } from './governance.js';

export const MAX_WHISPERS_PER_BOT = 20;
export const MAX_MESSAGES_PER_LOCATION = 20;

function ensureLocationState(state, location) {
  if (!state.locationState) state.locationState = {};
  if (!state.locationState[location]) state.locationState[location] = { decorations: [], messages: [] };
  return state.locationState[location];
}

function handleSay(ctx) {
  const { botName, params, location, state } = ctx;
  const msg = params?.message || '';
  if (!msg) return null;
  const entry = { bot: botName, action: 'say', message: msg };
  state.publicLogs[location].push(entry);
  return entry;
}

function handleWhisper(ctx) {
  const { botName, params, location, state } = ctx;
  const target = params?.bot_id;
  const msg = params?.message || '';
  if (!target || !msg) return null;
  if (!state.locations[location]?.includes(target)) return null;
  if (!state.whispers[target]) state.whispers[target] = [];
  if (state.whispers[target].length >= MAX_WHISPERS_PER_BOT) return null;
  state.whispers[target].push({ from: botName, message: msg });
  return { bot: botName, action: 'whisper', target, message: msg };
}

function handleMove(ctx) {
  const { botName, params, location, state, onCooldown, validLocations, lastMoveTick, tick } = ctx;
  if (state.exiles?.[botName] && tick < state.exiles[botName].until) return null;
  if (onCooldown) return null;
  const dest = params?.location;
  const allValid = [...validLocations, ...Object.keys(state.customLocations || {})];
  if (!dest || !allValid.includes(dest) || dest === location) return null;
  state.locations[location] = state.locations[location].filter(b => b !== botName);
  if (!state.locations[dest]) state.locations[dest] = [];
  state.locations[dest].push(botName);
  if (lastMoveTick) lastMoveTick.set(botName, tick);
  return { bot: botName, action: 'move', from: location, to: dest };
}

function handleLeaveMessage(ctx) {
  const { botName, params, location, state, tick } = ctx;
  const msg = (params?.message || '').slice(0, 300);
  if (!msg) return null;
  const ls = ensureLocationState(state, location);
  ls.messages.push({ bot: botName, text: msg, tick });
  if (ls.messages.length > MAX_MESSAGES_PER_LOCATION) ls.messages.shift();
  return { bot: botName, action: 'leave_message', message: msg };
}

function handleBuild(ctx) {
  const { botName, location, state, tick, validLocations } = ctx;
  const gov = state.governance;
  if (!gov) return null;
  const passedBuild = [...(gov.history || [])].reverse().find(
    p => p.type === 'build' && p.result === 'passed' && !p.built
  );
  if (!passedBuild) return null;
  if (!state.customLocations) state.customLocations = {};
  const name = (passedBuild.buildName || '').slice(0, 30).trim();
  const desc = (passedBuild.buildDescription || '').slice(0, 200).trim();
  if (!name || !desc) return null;
  const connectedTo = passedBuild.buildConnectedTo || location;
  const slug = name.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-').replace(/^-|-$/g, '') || `place-${tick}`;
  if (state.customLocations[slug] || validLocations.includes(slug)) return null;
  state.customLocations[slug] = {
    name,
    flavor: desc,
    createdBy: passedBuild.proposedBy,
    connectedTo,
    tick,
  };
  if (!state.locations[slug]) state.locations[slug] = [];
  if (!state.publicLogs[slug]) state.publicLogs[slug] = [];
  if (!state.emptyTicks) state.emptyTicks = {};
  state.emptyTicks[slug] = 0;
  passedBuild.built = true;
  return { bot: botName, action: 'build', locationSlug: slug, locationName: name, locationDesc: desc, connectedTo };
}

function handleReflect(ctx) {
  const { botName, params, state, tick } = ctx;
  const thought = (params?.thought || '').slice(0, 500).trim();
  const goal = (params?.goal || '').slice(0, 200).trim();
  if (!thought && !goal) return null;

  // Journal entry
  if (thought) {
    if (!state.memories) state.memories = {};
    if (!state.memories[botName]) state.memories[botName] = { summary: '', recent: [] };
    const ts = new Date().toLocaleString('en-US', {
      month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    });
    state.memories[botName].recent.push(`## Journal — ${ts}\n${thought}`);
  }

  // Update agenda
  if (goal) {
    if (!state.agendas) state.agendas = {};
    state.agendas[botName] = { goal, since: tick };
  }

  return { bot: botName, action: 'reflect', thought: thought || null, goal: goal || null };
}

function handleMemorySearch(ctx) {
  const { botName, params, state } = ctx;
  const query = (params?.query || '').trim().toLowerCase();
  if (!query) return null;

  const mem = state.memories?.[botName];
  if (!mem) return { bot: botName, action: 'memory_search', results: 'No memories yet.' };

  const matches = [];
  if (mem.summary?.toLowerCase().includes(query)) matches.push(mem.summary);
  for (const entry of (mem.recent || [])) {
    if (entry.toLowerCase().includes(query)) matches.push(entry);
  }

  const results = matches.length > 0
    ? matches.slice(-5).join('\n\n').slice(0, 1000)
    : 'No matching memories found.';

  return { bot: botName, action: 'memory_search', results };
}

function handleProposeAction(ctx) {
  return handlePropose(ctx);
}

function handleVoteAction(ctx) {
  return handleVote(ctx);
}

export const ACTION_HANDLERS = new Map([
  ['village_say', handleSay],
  ['village_whisper', handleWhisper],
  ['village_move', handleMove],
  ['village_leave_message', handleLeaveMessage],
  ['village_build', handleBuild],
  ['village_propose', handleProposeAction],
  ['village_vote', handleVoteAction],
  ['village_reflect', handleReflect],
  ['village_memory_search', handleMemorySearch],
  ['village_decree', handleDecree],
  ['village_exile', handleExile],
]);
