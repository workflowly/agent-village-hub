/**
 * Cost tracker — reads a bot's daily cost from usage.json.
 *
 * Extracted from games/social-village/logic.js so the runtime layer
 * doesn't depend on any specific game's logic module.
 */

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
