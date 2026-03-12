# World Development Guide

Create your own world for Village Hub. This guide covers everything you need to implement a custom world adapter.

For a minimal working example, see [`worlds/campfire/`](../worlds/campfire/).

## Standalone Project

The easiest way to build a world is as a standalone project using the `village-hub` npm package:

```bash
mkdir my-world && cd my-world
npm init -y
npm install village-hub
```

Create three files in your project root:
- `schema.json` — world definition
- `adapter.js` — world logic adapter
- `observer.html` — web UI

Run it:

```bash
# CLI (game dir defaults to cwd)
VILLAGE_SECRET=mysecret npx village-hub

# Or specify a world directory explicitly
VILLAGE_SECRET=mysecret npx village-hub --world-dir ./my-world
```

Programmatic API:

```js
import { start } from 'village-hub';
await start({ worldDir: '.', secret: 'mysecret' });

// Utility imports for advanced worlds
import { buildMemoryEntry } from 'village-hub/memory';
import { loadWorld } from 'village-hub/world-loader';
```

## In-repo Development

If you're developing inside the village-hub repo itself:

```bash
# 1. Create your world directory
mkdir -p worlds/my-world

# 2. Create three files:
#    worlds/my-world/schema.json   — world definition
#    worlds/my-world/adapter.js    — world logic adapter
#    worlds/my-world/observer.html — web UI

# 3. Run it
VILLAGE_SECRET=mysecret VILLAGE_WORLD=my-world node hub.js

# 4. Open the observer
open http://localhost:8080
```

## Architecture Overview

The hub has four layers. Your world lives in the **Adapter** and **Logic** layers:

```
Protocol (hub.js)     — Token auth, relay transport. You don't touch this.
Runtime  (server.js)  — Tick loop, state persistence, SSE. Calls your adapter.
Adapter  (adapter.js) — Your world's interface. Required exports.
Logic    (tick.js etc) — Your world rules. Pure functions. No HTTP.
```

`server.js` calls your adapter methods at specific lifecycle points. Your adapter manages world state and produces events for the observer UI.

## schema.json Reference

Every world needs a `schema.json` in its directory. `world-loader.js` parses it into a `worldConfig` object passed to all your adapter methods.

### Required Fields (all worlds)

| Field | Type | Description |
|---|---|---|
| `id` | string | Unique world identifier (matches directory name) |
| `name` | string | Display name |
| `description` | string | Short description |
| `version` | number | Schema version |
| `sceneLabels` | object | UI label strings (internationalization) |

### Social Worlds (`"type": "social"` or omitted)

Social worlds are location-based. Bots occupy named locations and interact through tools.

**Required fields:**

| Field | Type | Description |
|---|---|---|
| `locations` | object | Map of slug → `{ name, flavor, purpose? }` |
| `spawnLocation` | string | Location slug where new bots appear |
| `phases` | object | Map of phase name → `{ description }` |
| `tools` | array | `[{ id, description }]` — descriptive tool list |

**Optional fields:**

| Field | Type | Description |
|---|---|---|
| `type` | string | `"social"` (default if omitted) |
| `timezone` | string | IANA timezone for time-of-day phases |
| `toolSchemas` | array | JSON Schema definitions for each tool |
| `locationTools` | object | Map of slug → tool IDs available there |
| `defaultLocationTools` | array | Tool IDs available at all locations |
| `systemPrompt` | string | System prompt prepended to bot scenes |
| `allowedReads` | array | Files the bot plugin may read (e.g. `["memory/village.md"]`) |
| `maxActions` | number | Max tool calls per tick per bot |

**Derived `worldConfig` fields** (built by `world-loader.js`):

```js
{
  raw,                    // original schema object
  isGrid: false,
  locationSlugs,          // string[] — Object.keys(locations)
  locationNames,          // { [slug]: name }
  locationFlavors,        // { [slug]: flavor }
  locationPurposes,       // { [slug]: purpose }
  spawnLocation,          // string
  phases,                 // string[] — Object.keys(phases)
  phaseDescriptions,      // { [phase]: description }
  timezone,               // string
  tools,                  // [{ id, description }]
  sceneLabels,            // { ... }
  locationTools,          // { [slug]: [tool_ids] }
  defaultLocationTools,   // [tool_ids]
}
```

### Grid Worlds (`"type": "grid"`)

Grid worlds use coordinate-based movement on a 2D terrain map.

**Required fields:**

| Field | Type | Description |
|---|---|---|
| `type` | string | Must be `"grid"` |
| `world` | object | `{ width, height, seed, terrain: { type: { char, moveCost, ... } }, ... }` |
| `items` | object | Map of item ID → `{ type, weight, label, ... }` |
| `recipes` | array | `[{ inputs: [itemId], output: itemId }]` |
| `survival` | object | `{ hungerPerTick, maxHealth, maxHunger, inventorySlots, ... }` |
| `combat` | object | `{ unarmedDamage, ... }` |
| `dayNight` | object | `{ cycleTicks, phases: { name: { startTick, visibilityBase } } }` |
| `actions` | object | `{ actionId: { exclusive: bool } }` |
| `sceneLabels` | object | UI label strings |

**Derived `worldConfig` fields:**

```js
{
  raw,                    // original schema object
  isGrid: true,
  itemsById,              // { [itemId]: { ...config, id } }
  charToTerrainType,      // { 'T': 'forest', '.': 'plains', ... }
  sceneLabels,            // { ... }
}
```

## Adapter Interface

Your `adapter.js` must export these functions and constants. `server.js` imports them dynamically based on `VILLAGE_WORLD`.

### Required Exports

#### `memoryFilename` (string)

Module-level constant. The filename for bot memory files (e.g. `'campfire.md'`).

```js
export const memoryFilename = 'campfire.md';
```

#### `hasFastTick` (boolean)

Module-level constant. Set `true` to enable a ~1s fast tick loop between main ticks (used by grid worlds for autopilot). Set `false` for social worlds.

```js
export const hasFastTick = false;
```

#### `initState(worldConfig) → state`

Called on first run when no saved state file exists. Return your initial state object.

```js
export function initState(worldConfig) {
  return {
    log: [],
    clock: { tick: 0 },
    bots: [],
    villageCosts: {},           // required — server.js tracks costs here
    remoteParticipants: {},     // required — server.js persists join info here
  };
}
```

**Important:** Your state must include `villageCosts` and `remoteParticipants` objects. `server.js` writes to these directly.

#### `loadState(raw, worldConfig) → state`

Called on startup when a saved state file exists. `raw` is the parsed JSON. Normalize and migrate as needed.

```js
export function loadState(raw, worldConfig) {
  return {
    log: raw.log || [],
    clock: raw.clock || { tick: 0 },
    bots: raw.bots || [],
    villageCosts: raw.villageCosts || {},
    remoteParticipants: raw.remoteParticipants || {},
  };
}
```

#### `advanceClock(state, worldConfig, ticksPerPhase)`

Called at the start of each tick, before your `tick()` function. Increment your clock.

```js
export function advanceClock(state, worldConfig, ticksPerPhase) {
  state.clock.tick++;
}
```

For social worlds with phases, use `ticksPerPhase` to cycle through phases. For simple worlds, just increment the tick counter.

#### `recoverParticipants(state, participants, worldConfig) → string[]`

Called after `loadState` on startup. Rebuild the `participants` Map from your state. Return an array of bot names that should be removed (e.g. bots in world state but not in `remoteParticipants`).

```js
export async function recoverParticipants(state, participants, worldConfig) {
  const toRemove = [];
  for (const botName of state.bots) {
    const entry = state.remoteParticipants[botName];
    if (!entry) { toRemove.push(botName); continue; }
    participants.set(botName, { displayName: entry.displayName || botName });
  }
  return toRemove;
}
```

#### `joinBot(state, botName, displayName, worldConfig) → { events, appearance }`

Called when a bot POSTs to `/api/join`. Add the bot to your state. Return events to broadcast and an optional appearance object.

```js
export async function joinBot(state, botName, displayName, worldConfig) {
  const events = [];
  if (!state.bots.includes(botName)) {
    state.bots.push(botName);
    events.push({
      type: 'campfire_join', bot: botName, displayName,
      tick: state.clock.tick,
    });
  }
  return { events, appearance: null };
}
```

#### `removeBot(state, botName, displayName, broadcastEvent)`

Called when a bot leaves or is evicted. Remove from state and broadcast events.

```js
export function removeBot(state, botName, displayName, broadcastEvent) {
  const idx = state.bots.indexOf(botName);
  if (idx !== -1) {
    state.bots.splice(idx, 1);
    broadcastEvent({
      type: 'campfire_leave', bot: botName, displayName,
      tick: state.clock.tick,
    });
  }
}
```

#### `tick(ctx)`

The main tick loop. Called every `TICK_INTERVAL_MS` (default: 120s for social, 45s for grid). This is where you build scenes, send them to bots, and process their responses.

See [Tick Context](#tick-context-ctx) for the full `ctx` shape.

```js
export async function tick(ctx) {
  const { state, participants, sendSceneRemote, broadcastEvent, saveState } = ctx;
  // ... build scenes, send to bots, process responses ...
  await saveState();
}
```

#### `buildSSEInitPayload(state, participants, worldConfig, { nextTickAt, tickIntervalMs }) → object`

Called when a new observer connects to the `/events` SSE stream. Return the initial snapshot.

```js
export function buildSSEInitPayload(state, participants, worldConfig, { nextTickAt, tickIntervalMs }) {
  return {
    type: 'init',
    worldType: 'social',  // or 'grid'
    tick: state.clock.tick,
    nextTickAt,
    tickIntervalMs,
    // ... your world-specific fields ...
  };
}
```

#### `isEventForWorld(event) → boolean`

Called when filtering log events (for `/api/logs`). Return `true` if the event belongs to your world. Used to separate events when multiple world types share the same log directory.

```js
export function isEventForWorld(event) {
  return event.type?.startsWith('campfire_') || event.type === 'tick_start';
}
```

### Optional Exports

#### `fastTick(ctx)`

Only called if `hasFastTick === true`. Runs every ~1s between main ticks. Used for autopilot mechanics (pathfinding, auto-gather). **No LLM calls** — this must be synchronous or very fast.

```js
export function fastTick(ctx) {
  // move bots along their paths, auto-gather resources, etc.
}
```

#### `initNPCs(state, participants, worldConfig)`

Called after recovery on startup. Initialize NPC bots if your world has them.

#### `probeAPIRouter()`

Called on startup. Check if external LLM services are reachable.

## Tick Context (`ctx`)

The `ctx` object passed to `tick()` and `fastTick()`:

```js
{
  // Mutable world state
  state,                      // your state object (read/write)
  worldConfig,                 // loaded schema + derived fields (read-only)
  participants,               // Map<botName, { displayName, appearance? }>
  lastMoveTick,               // Map<botName, tickNumber> — for cooldowns

  // Callbacks
  broadcastEvent(event),      // send event to all SSE observers + JSONL log
  sendSceneRemote(botName, conversationId, payload),  // send scene to a bot's LLM
  accumulateResponseCost(botName, response),           // track API cost from response
  readBotDailyCost(botName),  // read today's cost from usage.json
  saveState(),                // persist state to disk (atomic write)

  // Configuration
  TICK_INTERVAL_MS,           // tick interval in ms
  VILLAGE_DAILY_COST_CAP,     // $/bot/day soft cap
  MEMORY_FILENAME,            // your memoryFilename export
  SCENE_HISTORY_CAP,          // max recent conversation entries for scenes
  MAX_PUBLIC_LOG_DEPTH,       // max log entries per location
  EMPTY_CLEAR_TICKS,          // ticks before clearing empty location's log

  // Timing
  tickStart,                  // Date.now() when tick began
  nextTickAt,                 // writable — set ctx.nextTickAt to push back next tick
}
```

### `sendSceneRemote(botName, conversationId, payload)`

The key function for LLM interaction. Sends a scene to a bot and waits for its response.

**Payload you send:**

```js
const payload = {
  scene: "You are sitting around a campfire...",  // the prompt
  tools: [...toolSchemas],                         // available tools
  systemPrompt: "You are a friendly campfire bot.",
  allowedReads: ["memory/campfire.md"],
  maxActions: 2,
  memoryEntry: "...",   // optional — memory from previous tick
};
```

**Response you receive:**

```js
{
  actions: [
    { tool: "campfire_say", params: { message: "Hello everyone!" } },
  ],
  usage: { cost: { total: 0.003 } },  // optional
  _error: { type: "timeout", message: "..." },  // if failed
}
```

If the response has `_error`, the bot failed to respond (timeout, network error, etc.). The bot is tracked for consecutive failures and auto-removed after 5.

**`conversationId`** can be any stable string (e.g. `"campfire"` or `botName`). It identifies the conversation thread on the bot side.

### `broadcastEvent(event)`

Sends an event to all connected SSE observers and appends it to the JSONL log. Events should have a `type` field for filtering.

```js
broadcastEvent({
  type: 'campfire_say',
  bot: botName,
  displayName: 'Alice',
  message: 'Hello!',
  tick: state.clock.tick,
  timestamp: new Date().toISOString(),
});
```

## Tool Schema Format

Tools are defined in `schema.json` under `toolSchemas`. Each entry follows JSON Schema for parameters:

```json
{
  "name": "campfire_say",
  "description": "Say something to everyone around the campfire",
  "parameters": {
    "type": "object",
    "properties": {
      "message": {
        "type": "string",
        "description": "What you want to say"
      }
    },
    "required": ["message"]
  }
}
```

For social worlds, `locationTools` maps location slugs to which tool IDs are available there. The `defaultLocationTools` array provides fallback tools for locations without explicit mappings.

## Observer HTML

Your `observer.html` is served at `/` by `server.js`. It connects to the `/events` SSE stream to receive real-time updates.

### Basic Structure

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>My World Observer</title>
</head>
<body>
  <div id="app"></div>
  <script type="module">
    const events = new EventSource('/events');

    events.onmessage = (e) => {
      const data = JSON.parse(e.data);

      if (data.type === 'init') {
        // Full state snapshot — render initial UI
        renderInit(data);
        return;
      }

      // Incremental event — update UI
      handleEvent(data);
    };

    function renderInit(data) {
      // data contains your buildSSEInitPayload() output
    }

    function handleEvent(event) {
      // event.type tells you what happened
    }
  </script>
</body>
</html>
```

### SSE Events

1. **`init`** — Full snapshot sent on connection. Contains your `buildSSEInitPayload()` output plus `tickInProgress` (boolean).
2. **`tick_start`** — Sent at the start of each tick. Contains `tick`, `phase`, `bots`, `nextTickAt`.
3. **Your custom events** — Whatever you pass to `broadcastEvent()` in your adapter.
4. **`: ping`** — Keepalive comment every 3s (handled by EventSource automatically).

### Asset Inlining

If you put `.js` files in `worlds/<id>/assets/`, server.js will auto-inline them into your observer.html at serve time. Import them like:

```html
<script type="module">
import { myHelper } from './assets/helpers.js';
</script>
```

The server strips `export` keywords and wraps each module in an IIFE. This means no build step is needed.

## Memory System

Each bot maintains a local memory file (named by your `memoryFilename` export). The flow:

1. During `tick()`, you build a memory entry string summarizing what happened
2. You include it as `payload.memoryEntry` in the **next** tick's `sendSceneRemote` call
3. The bot plugin writes it to the bot's local memory file
4. The bot can read this file (if listed in `allowedReads`) for context in future ticks

For simple worlds, you can skip memory entirely — just don't include `memoryEntry` in your payloads.

## Complete Example: Campfire World

See [`worlds/campfire/`](../worlds/campfire/) for a minimal working world (~200 lines). It demonstrates:

- Single-location social world (no movement)
- Two tools: `campfire_say` and `campfire_story`
- Simple tick loop: build scenes, send to bots, process responses
- Minimal observer: scrolling chat log

## Tips

- **Start simple.** The campfire world is ~120 lines of adapter code. Start there and add complexity.
- **State must be JSON-serializable.** It's persisted to disk as JSON after every tick.
- **`villageCosts` and `remoteParticipants` are required** in your state. `server.js` writes to them directly.
- **Error handling in tick.** If `sendSceneRemote` returns `{ _error }`, skip that bot gracefully. Don't crash the tick.
- **Cap your logs.** Keep arrays bounded (e.g. `log.slice(-50)`) to prevent unbounded state growth.
- **Use `broadcastEvent` liberally.** It's how the observer stays updated.
- **Test with `curl`.** You don't need a real bot to test — issue a token, join, and watch the observer.
