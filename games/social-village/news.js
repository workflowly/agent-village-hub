/**
 * News bulletin system — fetches real-world news via RSS, condenses
 * headlines into Chinese blurbs using Haiku, and broadcasts them
 * village-wide so bots see breaking news in their scene prompts.
 */

import { request as httpRequest } from 'node:http';

const NEWS_INTERVAL_TICKS = 30;        // ~1 hour at 2min/tick
const BULLETIN_ACTIVE_TICKS = 10;      // show in scene ~20 min
const MAX_BULLETINS = 50;              // kept in state

const RSS_FEEDS = [
  'https://news.google.com/rss?hl=zh-CN&gl=CN&ceid=CN:zh-Hans',
  'https://feeds.bbci.co.uk/news/world/rss.xml',
];

const HAIKU_MODEL = 'claude-haiku-4-5-20251001';
const API_ROUTER_URL = 'http://127.0.0.1:9090';
const NPC_API_TOKEN = process.env.NPC_API_TOKEN || '';

/**
 * Fetch RSS feed and extract <item><title> entries via regex.
 * @param {string} url
 * @returns {Promise<string[]>}
 */
async function fetchRSS(url) {
  try {
    const resp = await fetch(url, {
      signal: AbortSignal.timeout(10000),
      headers: { 'User-Agent': 'VillageNewsBot/1.0' },
    });
    if (!resp.ok) return [];
    const text = await resp.text();
    const titles = [];
    // Match <item>...<title>...</title>...</item> blocks
    const itemRegex = /<item[^>]*>([\s\S]*?)<\/item>/gi;
    let match;
    while ((match = itemRegex.exec(text)) !== null) {
      const titleMatch = match[1].match(/<title[^>]*>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>/i);
      if (titleMatch && titleMatch[1].trim()) {
        titles.push(titleMatch[1].trim());
      }
    }
    return titles;
  } catch (err) {
    console.error(`[news] RSS fetch failed for ${url}: ${err.message}`);
    return [];
  }
}

/**
 * Try each RSS feed, filter out headlines already used, return one random unused headline.
 * @param {object} state
 * @returns {Promise<string|null>}
 */
async function fetchBreakingNews(state) {
  const usedHeadlines = new Set((state.newsBulletins || []).map(b => b.headline));

  for (const url of RSS_FEEDS) {
    const titles = await fetchRSS(url);
    const unused = titles.filter(t => !usedHeadlines.has(t));
    if (unused.length > 0) {
      return unused[Math.floor(Math.random() * unused.length)];
    }
  }
  return null;
}

/**
 * Call Haiku via API router to produce a ~100-char Chinese village news blurb.
 * Falls back to using the headline as-is on error.
 * @param {string} headline
 * @returns {Promise<string>}
 */
function formatBulletin(headline) {
  const prompt = `你是一个村庄的新闻播报员。把下面这条新闻标题改写成一条简短的中文村庄广播（不超过100字），用自然口语化的方式播报，像村里广播站的风格。不要加引号或前缀。

新闻标题：${headline}`;

  const body = JSON.stringify({
    model: HAIKU_MODEL,
    max_tokens: 200,
    messages: [{ role: 'user', content: prompt }],
  });

  return new Promise((resolve) => {
    const url = new URL(`${API_ROUTER_URL}/v1/messages`);
    const req = httpRequest(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': NPC_API_TOKEN,
          'anthropic-version': '2023-06-01',
          'Content-Length': Buffer.byteLength(body),
        },
        timeout: 15000,
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            if (json.error) {
              console.error(`[news] Haiku API error: ${json.error.message || JSON.stringify(json.error)}`);
              resolve(headline);
              return;
            }
            const textBlock = (json.content || []).find(b => b.type === 'text');
            if (textBlock?.text) {
              resolve(textBlock.text.trim().slice(0, 200));
            } else {
              resolve(headline);
            }
          } catch (err) {
            console.error(`[news] Haiku parse error: ${err.message}`);
            resolve(headline);
          }
        });
      },
    );
    req.on('error', (err) => {
      console.error(`[news] Haiku request error: ${err.message}`);
      resolve(headline);
    });
    req.on('timeout', () => {
      console.error('[news] Haiku request timeout');
      req.destroy();
      resolve(headline);
    });
    req.write(body);
    req.end();
  });
}

/**
 * Main entry point — called from socialTick().
 * Fetches news, formats it, stores in state, and broadcasts.
 */
export async function rollNewsBulletin(tick, state, broadcastEvent) {
  if (tick % NEWS_INTERVAL_TICKS !== 0) return;

  const headline = await fetchBreakingNews(state);
  if (!headline) {
    console.log('[news] No new headlines available');
    return;
  }

  const bulletin = await formatBulletin(headline);
  const timestamp = new Date().toISOString();

  if (!state.newsBulletins) state.newsBulletins = [];
  state.newsBulletins.push({ headline, bulletin, tick, timestamp });

  // Cap at MAX_BULLETINS
  if (state.newsBulletins.length > MAX_BULLETINS) {
    state.newsBulletins = state.newsBulletins.slice(-MAX_BULLETINS);
  }

  console.log(`[news] Bulletin at tick ${tick}: ${bulletin}`);
  broadcastEvent({ type: 'news_bulletin', tick, headline, bulletin, timestamp });
}

export { BULLETIN_ACTIVE_TICKS };
