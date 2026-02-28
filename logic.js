/**
 * Extracted game logic — pure/testable functions from the village orchestrator.
 *
 * These functions operate on state objects passed as arguments rather than
 * module-level closures, making them independently testable.
 */

import { ALL_LOCATIONS } from './scene.js';

const PHASES = ['morning', 'afternoon', 'evening', 'night'];
const MAX_WHISPERS_PER_BOT = 20;

/**
 * Process actions from a bot's response and update state.
 *
 * @param {string} botName - Bot that performed the actions
 * @param {Array} actions - Array of { tool, params }
 * @param {string} location - Bot's current location
 * @param {object} state - Mutable state object (locations, publicLogs, whispers)
 * @param {object} [opts] - Optional: { lastMoveTick: Map, tick: number }
 * @returns {Array} Events generated
 */
export function processActions(botName, actions, location, state, opts = {}) {
  const events = [];
  const { lastMoveTick, tick } = opts;

  // Move cooldown: reject move if bot moved last tick
  const onCooldown = lastMoveTick && tick != null
    && (lastMoveTick.get(botName) || 0) >= tick - 1;

  // Check if bot wants to move — if so, move is exclusive (skip all other actions)
  const hasMove = actions.some(a =>
    a.tool === 'village_move' && a.params?.location
    && ALL_LOCATIONS.includes(a.params.location) && a.params.location !== location
  );
  const moveExclusive = hasMove && !onCooldown;

  for (const action of actions) {
    // If moving this tick, skip non-move actions
    if (moveExclusive && action.tool !== 'village_move') continue;

    switch (action.tool) {
      case 'village_say': {
        const msg = action.params?.message || '';
        if (!msg) break;
        const entry = { bot: botName, action: 'say', message: msg };
        state.publicLogs[location].push(entry);
        events.push(entry);
        break;
      }
      case 'village_whisper': {
        const target = action.params?.bot_id;
        const msg = action.params?.message || '';
        if (!target || !msg) break;
        // Validate: target must be at same location
        if (!state.locations[location]?.includes(target)) {
          break;
        }
        // Queue whisper for next tick (capped to prevent unbounded growth)
        if (!state.whispers[target]) state.whispers[target] = [];
        if (state.whispers[target].length >= MAX_WHISPERS_PER_BOT) {
          break;
        }
        state.whispers[target].push({ from: botName, message: msg });
        events.push({ bot: botName, action: 'whisper', target, message: msg });
        break;
      }
      case 'village_observe': {
        events.push({ bot: botName, action: 'observe' });
        break;
      }
      case 'village_move': {
        if (onCooldown) break; // enforce cooldown
        const dest = action.params?.location;
        if (!dest || !ALL_LOCATIONS.includes(dest) || dest === location) {
          break;
        }
        // Remove from current location
        state.locations[location] = state.locations[location].filter(b => b !== botName);
        // Add to new location
        if (!state.locations[dest]) state.locations[dest] = [];
        state.locations[dest].push(botName);
        events.push({ bot: botName, action: 'move', from: location, to: dest });
        // Record move tick for cooldown
        if (lastMoveTick) lastMoveTick.set(botName, tick);
        break;
      }
    }
  }

  return events;
}

/**
 * Advance the game clock by one tick.
 *
 * @param {object} clock - { tick, phase, ticksInPhase }
 * @param {number} ticksPerPhase - Ticks before phase advances
 * @returns {object} Updated clock
 */
export function advanceClock(clock, ticksPerPhase) {
  clock.tick++;
  clock.ticksInPhase++;

  if (clock.ticksInPhase >= ticksPerPhase) {
    clock.ticksInPhase = 0;
    const idx = PHASES.indexOf(clock.phase);
    clock.phase = PHASES[(idx + 1) % PHASES.length];
  }

  return clock;
}

/**
 * Enforce public log depth limit per location.
 *
 * @param {object} publicLogs - location → entries[]
 * @param {number} maxDepth - Max entries per location
 */
export function enforceLogDepth(publicLogs, maxDepth) {
  for (const loc of Object.keys(publicLogs)) {
    if (publicLogs[loc].length > maxDepth) {
      publicLogs[loc] = publicLogs[loc].slice(-maxDepth);
    }
  }
}

/**
 * Compute conversation quality metrics for a location's public log.
 *
 * @param {Array} log - Public log entries
 * @returns {{ messages: number, wordEntropy: number, topicDiversity: number } | null}
 */
export function computeQualityMetrics(log) {
  if (!log || log.length === 0) return null;

  const messages = log.filter(e => e.action === 'say').map(e => e.message || '');
  if (messages.length === 0) return null;

  // Word-level entropy: unique word ratio
  const allWords = messages.join(' ').toLowerCase().split(/\s+/).filter(Boolean);
  const uniqueWords = new Set(allWords);
  const wordEntropy = allWords.length > 0 ? uniqueWords.size / allWords.length : 0;

  // Topic diversity: unique first-words as rough topic proxy
  const topicWords = messages.map(m => m.split(/\s+/)[0]?.toLowerCase()).filter(Boolean);
  const topicDiversity = new Set(topicWords).size;

  return { messages: messages.length, wordEntropy, topicDiversity };
}

/**
 * Check if a bot should be skipped due to cost cap.
 *
 * @param {number} botCost - Bot's current daily cost
 * @param {number} dailyCostCap - Cap (0 = disabled)
 * @returns {boolean} True if bot should be skipped
 */
export function shouldSkipForCost(botCost, dailyCostCap) {
  if (dailyCostCap <= 0) return false;
  return botCost >= dailyCostCap;
}

/**
 * Handle new bots joining: place at central-square.
 *
 * @param {Set<string>} participantNames - Currently active bot names
 * @param {object} state - State with locations
 * @returns {string[]} Names of newly joined bots
 */
export function findNewBots(participantNames, state) {
  const allInLocations = new Set();
  for (const bots of Object.values(state.locations)) {
    for (const b of bots) allInLocations.add(b);
  }

  const newBots = [];
  for (const name of participantNames) {
    if (!allInLocations.has(name)) {
      newBots.push(name);
    }
  }
  return newBots;
}

/**
 * Find bots that left (no longer in participants).
 *
 * @param {Set<string>} participantNames - Currently active bot names
 * @param {object} state - State with locations
 * @returns {Array<{ name: string, location: string }>} Departed bots
 */
export function findDepartedBots(participantNames, state) {
  const departed = [];
  for (const loc of ALL_LOCATIONS) {
    for (const name of (state.locations[loc] || [])) {
      if (!participantNames.has(name)) {
        departed.push({ name, location: loc });
      }
    }
  }
  return departed;
}

/**
 * Read a bot's daily cost from usage.json.
 *
 * @param {string} botName
 * @param {string} usageFilePath - Path to usage.json
 * @param {function} readFileFn - Async file reader (for testability)
 * @returns {Promise<number>} Daily cost in dollars
 */
export async function readBotDailyCost(botName, usageFilePath, readFileFn) {
  try {
    const raw = await readFileFn(usageFilePath, 'utf-8');
    const usage = JSON.parse(raw);
    const botUsage = usage[botName];
    if (!botUsage) return 0;

    const today = new Date().toISOString().slice(0, 10);
    const lastUpdated = botUsage.lastUpdated || '';
    if (!lastUpdated.startsWith(today)) return 0;

    return botUsage.dailyCost || 0;
  } catch {
    return 0;
  }
}

/**
 * Validate observer auth from request cookies against admin tokens.
 *
 * @param {string} cookieHeader - Raw Cookie header string
 * @param {object} tokens - Parsed admin-tokens.json
 * @returns {string|null} Authenticated bot name, or null
 */
export function validateObserverAuth(cookieHeader, tokens) {
  if (!cookieHeader || !tokens) return null;

  const cookies = Object.fromEntries(
    cookieHeader.split(';').map(c => c.trim().split('=')).filter(p => p.length === 2)
  );

  for (const [key, value] of Object.entries(cookies)) {
    if (!key.startsWith('as_')) continue;
    const botName = key.slice(3);
    const botTokens = tokens[botName];
    if (!botTokens) continue;

    if (botTokens.session === value && botTokens.sessionExpiresAt > Date.now()) {
      return botName;
    }
  }

  return null;
}

// --- Relationship tracking ---

/**
 * Create a canonical pair key from two bot names (sorted, "::" delimited).
 */
export function pairKey(a, b) {
  return a < b ? `${a}::${b}` : `${b}::${a}`;
}

/**
 * Compute a relationship label from interaction counts.
 *
 * @param {{ says: number, whispers: number, coTicks: number }} rel
 * @returns {string} Label string, or '' if score too low
 */
export function computeLabel(rel) {
  const score = rel.says * 2 + rel.whispers * 5 + rel.coTicks * 0.2;
  let label = '';
  if (score >= 60) label = 'best friend';
  else if (score >= 35) label = 'good friend';
  else if (score >= 15) label = 'friend';
  else if (score >= 5) label = 'acquaintance';

  if (label && rel.whispers > rel.says) {
    label += ' & confidant';
  }
  return label;
}

/**
 * Track interactions from processed events. Call after processActions.
 *
 * For each 'say' event, increment `says` for every other bot at that location.
 * For each 'whisper' event, increment `whispers` for the pair.
 *
 * @param {Map<string, Array>} allEvents - location → events[]
 * @param {object} state - State with locations, relationships
 * @param {object} displayNames - botName → displayName map
 */
export function trackInteractions(allEvents, state, displayNames) {
  if (!state.relationships) state.relationships = {};

  for (const [loc, events] of allEvents) {
    const botsAtLoc = state.locations[loc] || [];

    for (const ev of events) {
      if (ev.action === 'say') {
        for (const other of botsAtLoc) {
          if (other === ev.bot) continue;
          const key = pairKey(ev.bot, other);
          if (!state.relationships[key]) {
            state.relationships[key] = { says: 0, whispers: 0, coTicks: 0, label: '', prevLabel: '', since: state.clock.tick };
          }
          state.relationships[key].says++;
        }
      } else if (ev.action === 'whisper' && ev.target) {
        const key = pairKey(ev.bot, ev.target);
        if (!state.relationships[key]) {
          state.relationships[key] = { says: 0, whispers: 0, coTicks: 0, label: '', prevLabel: '', since: state.clock.tick };
        }
        state.relationships[key].whispers++;
      }
    }
  }
}

/**
 * Increment coTicks for all pairs of bots at the same location.
 *
 * @param {object} state - State with locations, relationships
 */
export function updateCoLocation(state) {
  if (!state.relationships) state.relationships = {};

  for (const loc of Object.keys(state.locations)) {
    const bots = state.locations[loc];
    if (bots.length < 2) continue;

    for (let i = 0; i < bots.length; i++) {
      for (let j = i + 1; j < bots.length; j++) {
        const key = pairKey(bots[i], bots[j]);
        if (!state.relationships[key]) {
          state.relationships[key] = { says: 0, whispers: 0, coTicks: 0, label: '', prevLabel: '', since: state.clock.tick };
        }
        state.relationships[key].coTicks++;
      }
    }
  }
}

/**
 * Recompute labels for all relationships and detect changes.
 *
 * @param {object} state - State with relationships
 * @param {object} displayNames - botName → displayName map
 * @returns {Array<{ from: string, to: string, fromDisplay: string, toDisplay: string, label: string, prevLabel: string }>}
 */
export function updateRelationships(state, displayNames) {
  if (!state.relationships) state.relationships = {};
  const changes = [];

  for (const [key, rel] of Object.entries(state.relationships)) {
    const newLabel = computeLabel(rel);
    if (newLabel !== rel.label) {
      rel.prevLabel = rel.label;
      rel.label = newLabel;
      const [a, b] = key.split('::');
      changes.push({
        from: a,
        to: b,
        fromDisplay: displayNames[a] || a,
        toDisplay: displayNames[b] || b,
        label: newLabel,
        prevLabel: rel.prevLabel,
      });
    }
  }

  return changes;
}

// --- Emotion tracking ---

const EMOTIONS = ['neutral', 'happy', 'content', 'excited', 'lonely', 'bored'];
const EMOTION_DECAY = 0.85;
const EMOTION_THRESHOLD = 0.1;

/**
 * Update emotions for all bots based on tick events.
 *
 * @param {object} state - State with locations, emotions, clock
 * @param {Map<string, Array>} allEvents - location → events[]
 * @param {Array<{ botName: string, response: object|null, loc: string }>} allResults - scene results
 * @param {object} displayNames - botName → displayName map
 * @returns {Array<{ bot: string, displayName: string, emotion: string, prevEmotion: string }>} change events
 */
export function updateEmotions(state, allEvents, allResults, displayNames) {
  if (!state.emotions) state.emotions = {};
  const changes = [];

  // Build sets for quick lookup
  const botsWithActions = new Set();
  const botsWhispered = new Set();
  const botsSaid = new Map(); // bot → count of others present when they spoke
  const botsMoved = new Set();

  for (const [loc, events] of allEvents) {
    for (const ev of events) {
      if (ev.action === 'say') {
        botsWithActions.add(ev.bot);
        const othersCount = (state.locations[loc] || []).filter(b => b !== ev.bot).length;
        // Track max others present across all say events for this bot
        const prev = botsSaid.get(ev.bot) || 0;
        if (othersCount > prev) botsSaid.set(ev.bot, othersCount);
      } else if (ev.action === 'whisper' && ev.target) {
        botsWithActions.add(ev.bot);
        botsWhispered.add(ev.target);
      } else if (ev.action === 'move') {
        botsWithActions.add(ev.bot);
        botsMoved.add(ev.bot);
      } else if (ev.action === 'observe') {
        botsWithActions.add(ev.bot);
      }
    }
  }

  // Build set of bots that were sent a scene this tick
  const botsSent = new Set(allResults.map(r => r.botName));

  // Process each bot in any location
  const allBots = new Set();
  for (const loc of Object.keys(state.locations)) {
    for (const bot of state.locations[loc]) allBots.add(bot);
  }

  for (const bot of allBots) {
    if (!botsSent.has(bot)) continue; // skip bots that weren't active this tick

    if (!state.emotions[bot]) {
      state.emotions[bot] = { emotion: 'neutral', intensity: 0, prevEmotion: 'neutral', since: state.clock.tick };
    }

    const emo = state.emotions[bot];

    // 1. Decay current intensity
    emo.intensity *= EMOTION_DECAY;

    // 2. Compute impulses
    const impulses = [];

    if (botsWhispered.has(bot)) {
      impulses.push({ emotion: 'happy', intensity: 0.8 });
    }

    if (botsSaid.has(bot)) {
      const othersCount = botsSaid.get(bot);
      if (othersCount >= 2) {
        impulses.push({ emotion: 'content', intensity: 0.6 });
      } else if (othersCount >= 1) {
        impulses.push({ emotion: 'content', intensity: 0.4 });
      }
    }

    if (botsMoved.has(bot)) {
      impulses.push({ emotion: 'excited', intensity: 0.5 });
    }

    // Find bot's current location
    let botLoc = null;
    for (const loc of Object.keys(state.locations)) {
      if (state.locations[loc].includes(bot)) { botLoc = loc; break; }
    }

    if (botLoc) {
      const othersHere = (state.locations[botLoc] || []).filter(b => b !== bot);
      if (othersHere.length === 0) {
        // Alone — additive lonely
        if (emo.emotion === 'lonely') {
          impulses.push({ emotion: 'lonely', intensity: emo.intensity + 0.15 });
        } else {
          impulses.push({ emotion: 'lonely', intensity: 0.15 });
        }
      } else if (!botsWithActions.has(bot)) {
        // Others present but no actions
        impulses.push({ emotion: 'bored', intensity: 0.4 });
      }
    }

    // 3. Pick strongest impulse
    let best = null;
    for (const imp of impulses) {
      if (!best || imp.intensity > best.intensity) best = imp;
    }

    if (best && best.intensity > emo.intensity) {
      const prevEmotion = emo.emotion;
      emo.emotion = best.emotion;
      emo.intensity = Math.min(best.intensity, 1.0);
      emo.since = state.clock.tick;

      if (prevEmotion !== emo.emotion) {
        emo.prevEmotion = prevEmotion;
        changes.push({
          bot,
          displayName: displayNames[bot] || bot,
          emotion: emo.emotion,
          prevEmotion,
        });
      }
    }

    // 4. Reset to neutral if below threshold
    if (emo.intensity < EMOTION_THRESHOLD) {
      if (emo.emotion !== 'neutral') {
        const prevEmotion = emo.emotion;
        emo.prevEmotion = prevEmotion;
        emo.emotion = 'neutral';
        emo.intensity = 0;
        emo.since = state.clock.tick;
        changes.push({
          bot,
          displayName: displayNames[bot] || bot,
          emotion: 'neutral',
          prevEmotion,
        });
      }
    }
  }

  return changes;
}

export { PHASES, EMOTIONS };
