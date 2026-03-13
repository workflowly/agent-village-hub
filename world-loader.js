/**
 * World schema loader — reads a JSON world definition and passes it through
 * to the adapter and server.js.
 *
 * Pure function, no side effects — easily testable.
 */

import { readFileSync } from 'node:fs';

/**
 * Load and validate a world schema from a JSON file.
 *
 * @param {string} filePath - Absolute path to the world JSON file
 * @returns {object} worldConfig with raw schema
 * @throws {Error} on missing file, invalid JSON, or schema validation failure
 */
export function loadWorld(filePath) {
  const raw = JSON.parse(readFileSync(filePath, 'utf-8'));

  validate(raw, filePath);

  return {
    raw,
    sceneLabels: raw.sceneLabels,
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
