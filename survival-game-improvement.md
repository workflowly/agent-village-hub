# Survival Game Improvement Suggestions

Based on a comprehensive read of the codebase (`survival.json`, `survival-logic.js`, `survival-scene.js`, `visibility.js`, `survival.html`, and all unit tests).

---

## 1. Add a Win Condition (End State)

**Problem:** The game runs forever with no climax. Bots grind indefinitely — no tension arc, no payoff for observers.

**Suggestion:** First bot to craft `iron_armor` triggers a global "King" event, broadcasts a win message to all bots, then the game resets after a short delay. This gives each session a clear beginning, peak, and end.

**Implementation:** In `survival-logic.js` `doCraft()`, after crafting `iron_armor`, emit a special `crowned` event. The village manager catches it, announces the winner, schedules reset.

---

## 2. Trade System

**Problem:** `survival_say` exists but triggers no game mechanics. Bots talk into the void. There is no economic interaction between bots.

**Suggestion:** Add two non-exclusive actions:
- `survival_offer { target, give: ["wood","wood"], want: ["iron_ore"] }` — queues a trade offer on the target bot's next scene
- `survival_accept { from: "<botName>" }` — executes the swap atomically

**Why it works:** Creates trust/betrayal dynamics naturally. A bot can accept a trade, then immediately attack. Observers can watch alliances form and break.

---

## 3. Alliance System (Short-Term Truce)

**Problem:** Combat is purely random aggression. No strategic social layer.

**Suggestion:** Add `survival_ally { target, duration: 10 }`. For `duration` ticks, neither bot can attack the other (enforced in `doAttack` — return `attack_blocked` if alliance active). Alliances expire automatically.

**Why it works:** Forces bots to reason about when to ally vs betray. Creates dramatic moments — two allied bots fighting a third, then turning on each other when resources get scarce.

---

## 4. Shrink the Map for Early Sessions

**Problem:** 64x64 is large. Bots rarely encounter each other organically. The game feels sparse.

**Suggestion:** Add a `mapSize` parameter to `survival.json` (default `32` for new games, `64` for large sessions). Smaller map = more collisions = more drama per minute.

---

## 5. Food Scarcity Tuning

**Problem:** Berry spawn chance on plains is 0.1 — currently survivable but not tense enough for interesting decisions.

**Suggestion:** Drop `berry` chance on plains to `0.05`. Add a `cooked_berry` recipe (`berry + wood -> cooked_berry`, restores 25 hunger vs raw berry's 10). This creates a meaningful choice: eat raw for survival, or invest a turn crafting for efficiency.

---

## 6. Death Marker on Map

**Problem:** Deaths happen but leave no visible trace. The map has no "history."

**Suggestion:** On `death` event, write `{ type: "grave", tick: currentTick }` to `tileData[key]`. Render graves as a cross symbol on `survival.html` canvas. Fade them out after 20 ticks. Graves also have a 10% chance to contain 1 `scrap_metal` — loot the fallen.

---

## 7. Bot Status Visibility in Combat

**Problem:** Bots cannot see enemy equipment before deciding to attack. `doAttack` just checks adjacency. Bots have no way to evaluate risk.

**Suggestion:** The NEARBY section in `buildSurvivalScene` already shows `Weapon` and `Armor` for visible bots. Improve the guidance prompt to explicitly say: "Check nearby bot weapon/armor before attacking. If they have iron_sword and you have wooden_sword, retreating is smarter."

This is a zero-code change — prompt improvement only in `survival-scene.js`.

---

## 8. Scout Action Enhancement

**Problem:** `survival_scout` is exclusive (costs a whole turn) but only extends visibility radius by +3. The payoff is weak.

**Suggestion:** Make scout also reveal all resource tiles within extended radius as explicit text in the scene: "Scouted resources: Wood x2 at (14,22), Berry x1 at (16,19)." This makes scouting strategically worth sacrificing a full turn.

---

## 9. Human Participation — God Mode Events

**Problem:** Humans have no way to participate without directly controlling a bot (which breaks the AI experiment).

**Suggestion:** Add an admin endpoint `POST /village/event` accepting payloads like:
- `{ "type": "resource_drop", "x": 20, "y": 20, "items": {"berry": 5, "iron_ore": 2} }`
- `{ "type": "storm", "damage": 10, "radius": 5, "x": 30, "y": 30 }`
- `{ "type": "bounty", "target": "botName", "reward": "iron_sword" }`

Human triggers events from the observer UI. Bots respond autonomously. This is the Populous / Black & White model — human stays above the game, bots remain self-directed.

---

## 10. Combat Animation in survival.html

**Problem:** The canvas is static. Combat events appear only in the text log — invisible on the map.

**Suggestion:** When an `attack` event fires, flash the attacker's tile red for 300ms and the target's tile orange. When a `death` fires, render the bot dot grey for 2 seconds before removing. These are ~10-line canvas changes but dramatically improve readability for observers.

---

## 11. Hunger Bar Color in Bot List

**Problem:** The bot list panel shows HP with color coding (hp-high/mid/low CSS already defined) but hunger is just a plain number.

**Suggestion:** Apply the same color class logic to hunger: green under 50, orange 50-79, red 80+ (actively draining health). The CSS is already there — just needs the class applied in the JS rendering logic.

---

## 12. Personality Differentiation via System Prompt

**Problem:** All bots get identical `behaviorGuidance`. They make near-identical decisions. No personality emerges.

**Suggestion:** Assign each bot a personality tag at spawn (randomly or from config): `aggressive`, `hoarder`, `diplomat`, `explorer`. Prepend a one-line hint to the guidance section in `buildSurvivalScene`:

- **Aggressive:** "You prioritize combat. Attack weakened bots. Craft weapons first."
- **Hoarder:** "You stockpile resources. Never trade. Craft armor before engaging."
- **Diplomat:** "You prefer alliances. Offer trades before attacking. Warn before striking."
- **Explorer:** "You map the world. Scout frequently. Share resource locations via say."

Prompt-only change — no logic needed — but produces meaningfully different bot behavior and makes the game watchable.

---

*Authored by jinbot. Based on full codebase review of survival-logic.js, survival-scene.js, survival.json, survival.html, and all unit tests.*
