/**
 * RelayTransport — the core in-memory relay broker for the village protocol.
 *
 * Bridges the push model (game server relays scenes) with the pull model
 * (bots long-poll for scenes). Owns a single per-bot state map.
 *
 * No HTTP, no auth, no Express — pure logic over Promises and Maps.
 * Directly unit-testable without spinning up a server.
 */

export class RelayTransport {
  // botName → { relay: {resolve, timer, requestId}|null, poll: {resolve, timer}|null, queue: payload|null }
  #bots    = new Map();
  #counter = 0;

  #getBot(botName) {
    let state = this.#bots.get(botName);
    if (!state) {
      state = { relay: null, poll: null, queue: null };
      this.#bots.set(botName, state);
    }
    return state;
  }

  /**
   * Game server: deliver a scene payload to a bot, await bot's response.
   *
   * Registers the in-flight request, then immediately delivers to a waiting
   * poll or queues for the bot's next poll. Returns the bot's response object,
   * or null on timeout.
   *
   * @param {string} botName
   * @param {object} payload   — scene body (conversationId, scene, ...)
   * @param {number} timeoutMs — relay timeout before returning null
   * @returns {Promise<object|null>}
   */
  async relay(botName, payload, timeoutMs = 120_000) {
    const requestId = `vr_${++this.#counter}_${Date.now()}`;
    const scenePayload = { requestId, ...payload };
    const bot = this.#getBot(botName);

    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        if (bot.relay?.requestId === requestId) bot.relay = null;
        resolve(null);
      }, timeoutMs);

      bot.relay = { resolve, timer, requestId };

      // Deliver immediately if bot is already polling, otherwise queue
      if (bot.poll) {
        clearTimeout(bot.poll.timer);
        const waiter = bot.poll;
        bot.poll = null;
        waiter.resolve(scenePayload);
      } else {
        bot.queue = scenePayload;
      }
    });
  }

  /**
   * Bot: long-poll for the next scene payload.
   *
   * Returns { promise, cancel } so the route handler can attach a close-listener
   * that cancels only this specific poll (not a subsequent one for the same bot).
   *
   * promise resolves to a scene payload or null (timeout / cancelled).
   *
   * @param {string} botName
   * @param {number} timeoutMs
   * @returns {{ promise: Promise<object|null>, cancel: () => void }}
   */
  poll(botName, timeoutMs = 120_000) {
    const bot = this.#getBot(botName);

    // Drain queue if a scene is waiting
    if (bot.queue) {
      const payload = bot.queue;
      bot.queue = null;
      return { promise: Promise.resolve(payload), cancel: () => {} };
    }

    // Evict any existing waiter (duplicate poll from same bot)
    if (bot.poll) {
      console.warn(`[hub] duplicate poll for ${botName} — disconnecting previous connection`);
      clearTimeout(bot.poll.timer);
      bot.poll.resolve(null);
      bot.poll = null;
    }

    let pollState;
    const promise = new Promise((resolve) => {
      const timer = setTimeout(() => {
        if (bot.poll === pollState) bot.poll = null;
        resolve(null);
      }, timeoutMs);
      pollState = { resolve, timer };
      bot.poll = pollState;
    });

    // Identity-safe cancel: only cancels this specific poll, not a later one
    const cancel = () => {
      if (bot.poll === pollState) {
        clearTimeout(pollState.timer);
        bot.poll = null;
        pollState.resolve(null);
      }
    };

    return { promise, cancel };
  }

  /**
   * Bot: submit a response for an in-flight relay request.
   *
   * Keyed by botName (from token auth). requestId is an optional sanity check —
   * if provided and it doesn't match the current pending request, returns stale_request.
   *
   * @param {string} botName
   * @param {string|undefined} requestId — optional; checked if provided
   * @param {Array|null} actions
   * @param {object|null} usage
   * @returns {{ ok: boolean, error?: 'not_found'|'stale_request' }}
   */
  respond(botName, requestId, actions, usage) {
    const bot = this.#bots.get(botName);
    if (!bot?.relay) return { ok: false, error: 'not_found' };
    if (requestId && bot.relay.requestId !== requestId) return { ok: false, error: 'stale_request' };

    clearTimeout(bot.relay.timer);
    const { resolve } = bot.relay;
    bot.relay = null;

    const response = { actions: actions || [{ tool: 'village_observe', params: {} }] };
    if (usage) response.usage = usage;
    resolve(response);

    return { ok: true };
  }

  /**
   * Inject a payload directly into a bot's poll channel without a relay promise.
   * Used to deliver kick poison pills.
   */
  inject(botName, payload) {
    const bot = this.#getBot(botName);
    if (bot.poll) {
      clearTimeout(bot.poll.timer);
      const waiter = bot.poll;
      bot.poll = null;
      waiter.resolve(payload);
    } else {
      bot.queue = payload;
    }
  }
}
