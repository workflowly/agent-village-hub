/**
 * World schema loader — reads a JSON world definition and builds derived
 * lookup maps consumed by the adapter and server.js.
 *
 * Pure function, no side effects — easily testable.
 */

import { readFileSync } from 'node:fs';

/**
 * Load and validate a world schema from a JSON file.
 *
 * @param {string} filePath - Absolute path to the world JSON file
 * @returns {object} worldConfig with raw schema + derived lookup maps
 * @throws {Error} on missing file, invalid JSON, or schema validation failure
 */
export function loadWorld(filePath) {
  const raw = JSON.parse(readFileSync(filePath, 'utf-8'));

  validate(raw, filePath);

  const locationSlugs = Object.keys(raw.locations || {});
  const locationNames = {};
  const locationFlavors = {};
  const locationPurposes = {};
  for (const [slug, loc] of Object.entries(raw.locations || {})) {
    locationNames[slug] = loc.name;
    locationFlavors[slug] = loc.flavor;
    if (loc.purpose) locationPurposes[slug] = loc.purpose;
  }

  return {
    raw,
    locationSlugs,
    locationNames,
    locationFlavors,
    locationPurposes,
    spawnLocation: raw.spawnLocation,
    timezone: raw.timezone,
    tools: raw.tools,
    sceneLabels: raw.sceneLabels,
    locationTools: raw.locationTools || {},
    defaultLocationTools: raw.defaultLocationTools || (raw.tools || []).map(t => t.id),
  };
}

/**
 * Validate required fields in the world schema.
 */
function validate(raw, filePath) {
  const required = ['id', 'sceneLabels'];

  for (const field of required) {
    if (raw[field] === undefined || raw[field] === null) {
      throw new Error(`World schema ${filePath}: missing required field "${field}"`);
    }
  }
}
