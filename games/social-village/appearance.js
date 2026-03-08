/**
 * Appearance generation — derives a unique visual variant for each bot
 * from its name hash.
 *
 * Returns { variant: N } where N is 0–11, indexing a row in characters.png.
 * Deterministic: same bot always gets the same variant.
 *
 * All bots are remote, so local workspace files (personality.txt, SOUL.md)
 * are not accessible. Variant is assigned purely from the bot name hash.
 */

import { mulberry32, hashStr } from './utils.js';

const VARIANT_COUNT = 12;

/**
 * Generate appearance config for a bot.
 *
 * @param {string} botName - System name of the bot
 * @param {string} [occupation] - Kept for API compat (ignored)
 * @returns {Promise<object>} { variant: 0–11 }
 */
export async function generateAppearance(botName, occupation) {
  const rng = mulberry32(hashStr(botName));
  const variant = Math.floor(rng() * VARIANT_COUNT);
  return { variant };
}
