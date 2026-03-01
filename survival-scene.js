/**
 * Scene prompt builder for grid-based survival games.
 *
 * Builds a structured text prompt for each bot with:
 * STATUS, MAP, INVENTORY, NEARBY, RECENT EVENTS, ACTIONS, GUIDANCE.
 */

import { computeVisibility, buildAsciiMap } from './visibility.js';

/**
 * Determine the current day/night phase from tick.
 *
 * @param {number} tick - Current game tick
 * @param {object} dayNightConfig - { cycleTicks, phases: { phaseName: { startTick, visibilityBase } } }
 * @returns {{ name: string, visibilityBase: number }}
 */
export function getDayPhase(tick, dayNightConfig) {
  const dayTick = tick % dayNightConfig.cycleTicks;

  // Sort phases by startTick descending to find current phase
  const sorted = Object.entries(dayNightConfig.phases)
    .sort(([, a], [, b]) => b.startTick - a.startTick);

  for (const [name, cfg] of sorted) {
    if (dayTick >= cfg.startTick) {
      return { name, visibilityBase: cfg.visibilityBase };
    }
  }

  // Fallback to first phase
  const [name, cfg] = Object.entries(dayNightConfig.phases)[0];
  return { name, visibilityBase: cfg.visibilityBase };
}

/**
 * Format inventory for display.
 *
 * @param {object} inventory - { item: count }
 * @param {object} equipment - { weapon, armor, tool }
 * @param {object} gameConfig
 * @returns {string}
 */
export function formatInventory(inventory, equipment, gameConfig) {
  const items = gameConfig.raw.items;
  const maxSlots = gameConfig.raw.survival.inventorySlots;

  const parts = [];
  let usedSlots = 0;

  for (const [item, qty] of Object.entries(inventory)) {
    const label = items[item]?.label || item;
    parts.push(`${label} x${qty}`);
    usedSlots += qty;
  }

  // Equipment
  const equipped = [];
  if (equipment.weapon) equipped.push(`[${items[equipment.weapon]?.label || equipment.weapon} equipped]`);
  if (equipment.armor) equipped.push(`[${items[equipment.armor]?.label || equipment.armor} equipped]`);
  if (equipment.tool) equipped.push(`[${items[equipment.tool]?.label || equipment.tool} equipped]`);

  const invStr = parts.length > 0 ? parts.join(', ') : 'empty';
  const equipStr = equipped.length > 0 ? ' | ' + equipped.join(', ') : '';

  return `${invStr}${equipStr} | ${usedSlots}/${maxSlots} slots`;
}

/**
 * Format bot stats line.
 */
export function formatStats(botState, dayPhase, tick) {
  return `HP: ${botState.health}/${100} | Hunger: ${botState.hunger}/${100} | Pos: (${botState.x},${botState.y}) | Time: ${dayPhase.name} (tick ${tick})`;
}

/**
 * Build the full scene prompt for a survival bot.
 *
 * @param {object} opts
 * @param {string} opts.botName
 * @param {object} opts.botState - { x, y, health, hunger, inventory, equipment, alive }
 * @param {object} opts.worldState - { terrain, tileData, bots, clock }
 * @param {object} opts.gameConfig
 * @param {number} opts.currentTick
 * @param {Array} opts.recentEvents - Events this bot witnessed
 * @param {string} opts.villageSummary - Memory summary
 * @param {boolean} opts.isScout - Whether bot scouted this tick
 * @returns {string} Scene prompt
 */
export function buildSurvivalScene({ botName, botState, worldState, gameConfig, currentTick,
                                      recentEvents, villageSummary, isScout }) {
  const labels = gameConfig.raw.sceneLabels;
  const dayNight = gameConfig.raw.dayNight;
  const dayPhase = getDayPhase(currentTick, dayNight);

  const lines = [];

  // == STATUS ==
  lines.push(labels.statusHeader);
  lines.push(formatStats(botState, dayPhase, currentTick));
  lines.push('');

  // == MAP ==
  let radius = computeVisibility(botState, worldState.terrain, dayPhase, gameConfig);
  if (isScout) radius = Math.min(radius + 3, 15);

  const asciiMap = buildAsciiMap({
    botX: botState.x,
    botY: botState.y,
    radius,
    terrain: worldState.terrain,
    tileData: worldState.tileData,
    allBots: worldState.bots,
    botName,
    width: gameConfig.raw.world.width,
    height: gameConfig.raw.world.height,
  });

  lines.push(labels.mapHeader);
  lines.push(asciiMap);
  lines.push(labels.mapLegend);
  lines.push('');

  // == INVENTORY ==
  lines.push(labels.inventoryHeader);
  if (Object.keys(botState.inventory).length === 0 && !botState.equipment.weapon && !botState.equipment.armor && !botState.equipment.tool) {
    lines.push(labels.emptyInventory);
  } else {
    lines.push(formatInventory(botState.inventory, botState.equipment, gameConfig));
  }
  lines.push('');

  // == NEARBY ==
  lines.push(labels.nearbyHeader);
  const nearbyBots = [];
  for (const [name, bs] of Object.entries(worldState.bots)) {
    if (name === botName) continue;
    if (!bs.alive) continue;
    const dist = Math.sqrt(Math.pow(botState.x - bs.x, 2) + Math.pow(botState.y - bs.y, 2));
    if (dist <= radius) {
      const weapon = bs.equipment.weapon
        ? (gameConfig.raw.items[bs.equipment.weapon]?.label || bs.equipment.weapon)
        : 'unarmed';
      const armor = bs.equipment.armor
        ? (gameConfig.raw.items[bs.equipment.armor]?.label || bs.equipment.armor)
        : 'none';
      nearbyBots.push(`  ${name} — HP:${bs.health} Pos:(${bs.x},${bs.y}) Weapon:${weapon} Armor:${armor} (dist:${dist.toFixed(1)})`);
    }
  }
  if (nearbyBots.length > 0) {
    lines.push(...nearbyBots);
  } else {
    lines.push(labels.noNearby);
  }
  lines.push('');

  // == RECENT EVENTS ==
  lines.push(labels.recentHeader);
  if (recentEvents && recentEvents.length > 0) {
    for (const ev of recentEvents.slice(-15)) {
      lines.push(`  ${formatEvent(ev, gameConfig)}`);
    }
  } else {
    lines.push(labels.noRecent);
  }
  lines.push('');

  // == ACTIONS ==
  lines.push(labels.actionsHeader);
  lines.push('Available actions (choose one or more, exclusive actions use your whole turn):');
  lines.push('');
  lines.push('  survival_move { direction: "N|S|E|W|NE|NW|SE|SW" } — Move one tile (exclusive)');
  lines.push('  survival_gather {} — Gather resources from current tile');
  lines.push('  survival_eat { item: "berry" } — Eat food to reduce hunger');

  // Show craftable recipes
  const craftable = getCraftableRecipes(botState.inventory, gameConfig);
  if (craftable.length > 0) {
    lines.push('  survival_craft { item: "<output>" } — Craft an item. Available recipes:');
    for (const r of craftable) {
      const label = gameConfig.raw.items[r.output]?.label || r.output;
      lines.push(`    ${r.output} (${label}): ${r.inputs.join(' + ')}`);
    }
  } else {
    lines.push('  survival_craft { item: "<output>" } — Craft an item (no recipes available with current materials)');
  }

  if (nearbyBots.length > 0) {
    lines.push('  survival_attack { target: "<bot_name>" } — Attack adjacent bot (exclusive, within 1 tile)');
  }

  lines.push('  survival_say { message: "..." } — Say something to nearby survivors');
  lines.push('  survival_scout {} — Scout the area for extended visibility (exclusive)');
  lines.push('');

  // == GUIDANCE ==
  lines.push(labels.guidanceHeader);
  lines.push(labels.behaviorGuidance);

  if (villageSummary) {
    lines.push('');
    lines.push('Your memories:');
    lines.push(villageSummary);
  }

  return lines.join('\n');
}

/**
 * Get recipes that the bot can currently craft.
 */
function getCraftableRecipes(inventory, gameConfig) {
  const craftable = [];
  for (const recipe of gameConfig.raw.recipes) {
    const inputCounts = {};
    for (const input of recipe.inputs) {
      inputCounts[input] = (inputCounts[input] || 0) + 1;
    }
    let canCraft = true;
    for (const [item, needed] of Object.entries(inputCounts)) {
      if ((inventory[item] || 0) < needed) {
        canCraft = false;
        break;
      }
    }
    if (canCraft) craftable.push(recipe);
  }
  return craftable;
}

/**
 * Format an event for display in the recent events section.
 */
function formatEvent(ev, gameConfig) {
  const items = gameConfig.raw.items;
  switch (ev.action) {
    case 'move':
      return `${ev.bot} moved ${ev.direction} to (${ev.to.x},${ev.to.y})`;
    case 'gather':
      return `${ev.bot} gathered ${ev.items.map(i => `${items[i.item]?.label || i.item} x${i.qty}`).join(', ')}`;
    case 'craft':
      return `${ev.bot} crafted ${ev.label || ev.item}`;
    case 'eat':
      return `${ev.bot} ate ${ev.label || ev.item}`;
    case 'attack':
      return `${ev.bot} attacked ${ev.target} for ${ev.damage} damage with ${ev.weapon}`;
    case 'attack_attempt':
      return `${ev.bot} is attacking ${ev.target}!`;
    case 'death':
      return `${ev.bot} died at (${ev.x},${ev.y})!`;
    case 'killed':
      return `${ev.bot} was killed!`;
    case 'starved':
      return `${ev.bot} starved to death!`;
    case 'respawn':
      return `${ev.bot} respawned at (${ev.x},${ev.y})`;
    case 'hunger_drain':
      return `${ev.bot} is starving! HP:${ev.health} Hunger:${ev.hunger}`;
    case 'hunger_warning':
      return `${ev.bot} is getting very hungry (${ev.hunger}/100)`;
    case 'say':
      return `${ev.bot} says: "${ev.message}"`;
    case 'scout':
      return `${ev.bot} scouted the area`;
    case 'gather_fail':
    case 'move_fail':
    case 'craft_fail':
    case 'eat_fail':
    case 'attack_fail':
      return `${ev.bot}: ${ev.reason}`;
    default:
      return `${ev.bot}: ${ev.action}`;
  }
}
