/**
 * Village memory builder — formats memory entries for each bot's village.md.
 *
 * Each bot's village.md reflects their view of village interactions:
 * public messages, their own whispers, whispers to them, movements.
 * No leaked whispers between other bots.
 *
 * All bots are remote — memory entries are queued server-side and delivered
 * to the plugin via the scene payload (pendingRemoteMemory). The plugin writes
 * them to disk locally.
 */

/**
 * Build a witness memory entry — always produces an entry capturing what the bot
 * observed this tick: who was present, any visible events, and active proposal.
 * Use this for non-NPC bots so silent ticks are recorded too.
 *
 * @param {object} opts
 * @param {string} opts.location - Location display name
 * @param {string} opts.timestamp - ISO timestamp
 * @param {string} opts.botName - The bot we're writing for
 * @param {string[]} opts.botsPresent - Display names of other bots at this location
 * @param {Array}  opts.events - Visible events this tick (same format as buildMemoryEntry)
 * @param {object|null} opts.activeProposal - Current governance proposal (or null)
 * @returns {string} Formatted markdown entry (never empty)
 */
export function buildWitnessEntry({ location, timestamp, botName, botsPresent = [], events = [], activeProposal = null }) {
  const lines = [];
  const time = new Date(timestamp).toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  });

  lines.push(`## ${location} — ${time}`);
  lines.push('');

  // Who was present
  if (botsPresent.length > 0) {
    lines.push(`*在场: ${botsPresent.join(', ')}*`);
  } else {
    lines.push(`*(独处)*`);
  }

  // Visible events
  const eventLines = [];
  for (const ev of events) {
    const name = ev.displayName || ev.bot;
    switch (ev.action) {
      case 'say':
        eventLines.push(`**${name}**: "${ev.message}"`);
        break;
      case 'whisper':
        if (ev.bot === botName) {
          const t = ev.targetDisplayName || ev.target;
          eventLines.push(`**${name}** (悄悄对 ${t}): "${ev.message}"`);
        } else if (ev.target === botName) {
          eventLines.push(`**${name}** (悄悄对你): "${ev.message}"`);
        }
        break;
      case 'move':
        eventLines.push(`*${name} 离开前往 ${ev.to}*`);
        break;
      case 'arrive':
        eventLines.push(`*${name} 从 ${ev.from || '他处'} 到来*`);
        break;
      case 'vote':
        eventLines.push(`*${name} 投票 ${ev.vote === 'yes' ? '赞成' : '反对'}*`);
        break;
      case 'propose':
        eventLines.push(`*${name} 发起了提案: "${(ev.description || '').slice(0, 60)}"*`);
        break;
      case 'build':
        eventLines.push(`*${name} 建造了 ${ev.buildName || ev.item}*`);
        break;
      case 'join':
        eventLines.push(`*${name} 加入了村庄*`);
        break;
      case 'leave':
        eventLines.push(`*${name} 离开了村庄*`);
        break;
      case 'leave_message':
        eventLines.push(`*${name} 留下了消息*`);
        break;
      case 'meditate':
        eventLines.push(`*${name} 在冥想*`);
        break;
      case 'set_agenda':
        eventLines.push(`*${name} 设定了目标: ${ev.agenda}*`);
        break;
    }
  }

  if (eventLines.length > 0) {
    lines.push('');
    lines.push(...eventLines);
  }

  // Active proposal summary
  if (activeProposal) {
    const p = activeProposal;
    const votes = Object.values(p.votes || {});
    const yes = votes.filter(v => v === 'yes').length;
    const no  = votes.filter(v => v === 'no').length;
    const name = p.buildName || (p.description || '').slice(0, 30);
    lines.push('');
    lines.push(`*提案 #${p.id} "${name}" — ${yes}赞/${no}反*`);
  }

  return lines.join('\n');
}

/**
 * Build a memory entry for a tick at a location.
 *
 * @param {object} opts
 * @param {string} opts.location - Location name
 * @param {string} opts.timestamp - ISO timestamp
 * @param {Array} opts.events - Array of { bot, displayName, action, message?, target?, from?, to? }
 * @param {string} opts.botName - The bot we're writing for (to scope whispers)
 * @returns {string} Formatted markdown entry
 */
export function buildMemoryEntry({ location, timestamp, events, botName }) {
  const lines = [];
  const time = new Date(timestamp).toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  });

  lines.push(`## ${location} — ${time}`);
  lines.push('');

  for (const ev of events) {
    const name = ev.displayName || ev.bot;

    switch (ev.action) {
      case 'say':
        lines.push(`**${name}** (say): "${ev.message}"`);
        break;
      case 'set_agenda':
        lines.push(`*${name} 设定了目标：${ev.agenda}*`);
        break;
      case 'whisper':
        // Only show whispers sent by or to this bot
        if (ev.bot === botName) {
          const targetName = ev.targetDisplayName || ev.target;
          lines.push(`**${name}** (whisper to ${targetName}): "${ev.message}"`);
        } else if (ev.target === botName) {
          lines.push(`**${name}** (whisper to you): "${ev.message}"`);
        }
        // Other bots' whispers are not shown
        break;
      case 'move':
        if (ev.direction) {
          // Grid game move (direction-based)
          lines.push(`*${name} moved ${ev.direction} to (${ev.to?.x},${ev.to?.y})*`);
        } else {
          // Social game move (location-based)
          lines.push(`*${name} moved to ${ev.to}*`);
        }
        break;
      case 'arrive':
        lines.push(`*${name} arrived from ${ev.from || 'elsewhere'}*`);
        break;
      case 'join':
        lines.push(`*${name} has joined the village!*`);
        break;
      case 'leave':
        lines.push(`*${name} has left the village.*`);
        break;
      // --- Survival game events ---
      case 'gather':
        if (ev.items) {
          const itemStr = ev.items.map(i => `${i.item} x${i.qty}`).join(', ');
          lines.push(`*${name} gathered ${itemStr}*`);
        }
        break;
      case 'craft':
        lines.push(`*${name} crafted ${ev.label || ev.item}*`);
        break;
      case 'eat':
        lines.push(`*${name} ate ${ev.label || ev.item}*`);
        break;
      case 'attack':
        lines.push(`**${name}** attacked **${ev.target}** for ${ev.damage} damage`);
        break;
      case 'death':
        lines.push(`**${name}** died at (${ev.x},${ev.y})!`);
        break;
      case 'killed':
        lines.push(`**${name}** was killed!`);
        break;
      case 'starved':
        lines.push(`**${name}** starved to death!`);
        break;
      case 'respawn':
        lines.push(`*${name} respawned at (${ev.x},${ev.y})*`);
        break;
      case 'hunger_drain':
        if (ev.bot === botName) {
          lines.push(`*You are starving! HP:${ev.health} Hunger:${ev.hunger}*`);
        }
        break;
      case 'scout':
        lines.push(`*${name} scouted the area*`);
        break;
    }
  }

  // Skip empty entries (tick where bot only observed — no visible events)
  if (lines.length <= 2) return '';

  return lines.join('\n');
}
