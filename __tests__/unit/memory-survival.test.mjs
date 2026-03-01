import { describe, it, expect } from 'vitest';
import { buildMemoryEntry } from '../../memory.js';

describe('buildMemoryEntry — survival events', () => {
  const baseOpts = {
    location: 'Grid (5,5)',
    timestamp: '2026-03-01T12:00:00Z',
    botName: 'alice',
  };

  it('formats gather event', () => {
    const entry = buildMemoryEntry({
      ...baseOpts,
      events: [{ bot: 'alice', displayName: 'Alice', action: 'gather', items: [{ item: 'wood', qty: 2 }] }],
    });
    expect(entry).toContain('Alice gathered wood x2');
  });

  it('formats craft event', () => {
    const entry = buildMemoryEntry({
      ...baseOpts,
      events: [{ bot: 'alice', displayName: 'Alice', action: 'craft', item: 'wooden_sword', label: 'Wooden Sword' }],
    });
    expect(entry).toContain('Alice crafted Wooden Sword');
  });

  it('formats eat event', () => {
    const entry = buildMemoryEntry({
      ...baseOpts,
      events: [{ bot: 'alice', displayName: 'Alice', action: 'eat', item: 'berry', label: 'Berry' }],
    });
    expect(entry).toContain('Alice ate Berry');
  });

  it('formats attack event', () => {
    const entry = buildMemoryEntry({
      ...baseOpts,
      events: [{ bot: 'alice', displayName: 'Alice', action: 'attack', target: 'bob', damage: 15 }],
    });
    expect(entry).toContain('Alice** attacked **bob** for 15 damage');
  });

  it('formats death event', () => {
    const entry = buildMemoryEntry({
      ...baseOpts,
      events: [{ bot: 'bob', displayName: 'Bob', action: 'death', x: 10, y: 20 }],
    });
    expect(entry).toContain('Bob** died at (10,20)');
  });

  it('formats killed event', () => {
    const entry = buildMemoryEntry({
      ...baseOpts,
      events: [{ bot: 'bob', displayName: 'Bob', action: 'killed' }],
    });
    expect(entry).toContain('Bob** was killed!');
  });

  it('formats starved event', () => {
    const entry = buildMemoryEntry({
      ...baseOpts,
      events: [{ bot: 'bob', displayName: 'Bob', action: 'starved' }],
    });
    expect(entry).toContain('Bob** starved to death!');
  });

  it('formats respawn event', () => {
    const entry = buildMemoryEntry({
      ...baseOpts,
      events: [{ bot: 'bob', displayName: 'Bob', action: 'respawn', x: 0, y: 3 }],
    });
    expect(entry).toContain('Bob respawned at (0,3)');
  });

  it('formats hunger_drain for own bot', () => {
    const entry = buildMemoryEntry({
      ...baseOpts,
      events: [{ bot: 'alice', action: 'hunger_drain', health: 85, hunger: 90 }],
    });
    expect(entry).toContain('You are starving! HP:85 Hunger:90');
  });

  it('does not show hunger_drain for other bots', () => {
    const entry = buildMemoryEntry({
      ...baseOpts,
      events: [{ bot: 'bob', action: 'hunger_drain', health: 85, hunger: 90 }],
    });
    // Should be empty (only header lines)
    expect(entry).toBe('');
  });

  it('formats scout event', () => {
    const entry = buildMemoryEntry({
      ...baseOpts,
      events: [{ bot: 'alice', displayName: 'Alice', action: 'scout' }],
    });
    expect(entry).toContain('Alice scouted the area');
  });

  it('formats direction-based move (grid game)', () => {
    const entry = buildMemoryEntry({
      ...baseOpts,
      events: [{ bot: 'alice', displayName: 'Alice', action: 'move', direction: 'N', to: { x: 5, y: 4 } }],
    });
    expect(entry).toContain('Alice moved N to (5,4)');
  });

  it('formats location-based move (social game)', () => {
    const entry = buildMemoryEntry({
      ...baseOpts,
      events: [{ bot: 'alice', displayName: 'Alice', action: 'move', to: 'town_square' }],
    });
    expect(entry).toContain('Alice moved to town_square');
  });

  it('returns empty for tick with no visible events', () => {
    const entry = buildMemoryEntry({
      ...baseOpts,
      events: [],
    });
    expect(entry).toBe('');
  });
});
