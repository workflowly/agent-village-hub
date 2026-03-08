/**
 * RelayTransport — the core in-memory relay broker for the village protocol.
 *
 * Bridges the push model (game server relays scenes) with the pull model
 * (bots long-poll for scenes). Owns three in-memory maps and all timing logic.
 *
 * No HTTP, no auth, no Express — pure logic over Promises and Maps.
 * Directly unit-testable without spinning up a server.
 */

export class RelayTransport {
  #pendingScenes = new Map();  // requestId → { resolve, timer, botName }
  #sceneQueue    = new Map();  // botName   → payload
  #pollWaiters   = new Map();  // botName   → { resolve, timer }
  #counter       = 0;

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

    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.#pendingScenes.delete(requestId);
        resolve(null);
      }, timeoutMs);

      this.#pendingScenes.set(requestId, { resolve, timer, botName });

      // Deliver immediately if bot is already polling, otherwise queue
      const waiter = this.#pollWaiters.get(botName);
      if (waiter) {
        clearTimeout(waiter.timer);
        this.#pollWaiters.delete(botName);
        waiter.resolve(scenePayload);
      } else {
        this.#sceneQueue.set(botName, scenePayload);
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
    // Drain queue if a scene is waiting
    const queued = this.#sceneQueue.get(botName);
    if (queued) {
      this.#sceneQueue.delete(botName);
      return { promise: Promise.resolve(queued), cancel: () => {} };
    }

    // Evict any existing waiter (duplicate poll from same bot)
    const existing = this.#pollWaiters.get(botName);
    if (existing) {
      console.warn(`[hub] duplicate poll for ${botName} — disconnecting previous connection`);
      clearTimeout(existing.timer);
      this.#pollWaiters.delete(botName);
      existing.resolve(null);
    }

    let waiter;
    const promise = new Promise((resolve) => {
      const timer = setTimeout(() => {
        if (this.#pollWaiters.get(botName) === waiter) this.#pollWaiters.delete(botName);
        resolve(null);
      }, timeoutMs);
      waiter = { resolve, timer };
      this.#pollWaiters.set(botName, waiter);
    });

    // Identity-safe cancel: only cancels this specific poll, not a later one
    const cancel = () => {
      if (this.#pollWaiters.get(botName) === waiter) {
        clearTimeout(waiter.timer);
        this.#pollWaiters.delete(botName);
        waiter.resolve(null);
      }
    };

    return { promise, cancel };
  }

  /**
   * Bot: submit a response for an in-flight relay request.
   *
   * @returns {{ ok: boolean, error?: 'not_found'|'wrong_bot' }}
   */
  respond(requestId, botName, actions, usage) {
    const pending = this.#pendingScenes.get(requestId);
    if (!pending) return { ok: false, error: 'not_found' };
    if (pending.botName !== botName) return { ok: false, error: 'wrong_bot' };

    clearTimeout(pending.timer);
    this.#pendingScenes.delete(requestId);

    const response = { actions: actions || [{ tool: 'village_observe', params: {} }] };
    if (usage) response.usage = usage;
    pending.resolve(response);

    return { ok: true };
  }

  /**
   * Inject a payload directly into a bot's poll channel without a relay promise.
   * Used to deliver kick poison pills.
   */
  inject(botName, payload) {
    const waiter = this.#pollWaiters.get(botName);
    if (waiter) {
      clearTimeout(waiter.timer);
      this.#pollWaiters.delete(botName);
      waiter.resolve(payload);
    } else {
      this.#sceneQueue.set(botName, payload);
    }
  }
}
