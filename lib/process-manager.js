/**
 * ProcessManager — supervised child process with exponential-backoff restart.
 *
 * Spawns a Node.js script as a child process and automatically restarts it
 * on crash. Passes SIGTERM through on stop().
 */

import { spawn } from 'node:child_process';

export class ProcessManager {
  #script;
  #cwd;
  #env;
  #child      = null;
  #running    = false;
  #attempts   = 0;
  #stopped    = false;

  /**
   * @param {string} script  — path to the Node.js script to spawn
   * @param {{ cwd?: string, env?: object }} options
   */
  constructor(script, { cwd, env } = {}) {
    this.#script = script;
    this.#cwd    = cwd;
    this.#env    = env;
  }

  /** True while the child process is alive. */
  get running() { return this.#running; }

  /** Spawn the child process. Restarts automatically on crash. */
  start() {
    if (this.#stopped) return;

    console.log('[hub] Starting game server...');
    this.#child = spawn('node', [this.#script], {
      cwd:   this.#cwd,
      env:   this.#env,
      stdio: 'inherit',
    });
    this.#running = true;

    this.#child.on('exit', (code, signal) => {
      this.#running = false;
      this.#child   = null;

      if (this.#stopped || code === 0 || signal === 'SIGTERM') {
        console.log('[hub] Game server exited cleanly');
        return;
      }

      this.#attempts++;
      const delay = Math.min(1000 * Math.pow(2, this.#attempts - 1), 30_000);
      console.error(
        `[hub] Game server crashed (code=${code}, signal=${signal}), ` +
        `restarting in ${delay}ms (attempt ${this.#attempts})`
      );
      setTimeout(() => this.start(), delay);
    });

    this.#child.on('error', (err) => {
      console.error(`[hub] Game server spawn error: ${err.message}`);
    });
  }

  /** Send SIGTERM and suppress restart. */
  stop() {
    this.#stopped = true;
    if (this.#child) this.#child.kill('SIGTERM');
  }
}
