/**
 * SweepX - Core Deletion Execution & Throttling Engine
 * 
 * Implements anti-ban jitter delays, sliding window batch cooling,
 * and HTTP 429 exponential backoff.
 */

import { RateLimitError, AuthError } from './client.js';

export const EngineState = {
  IDLE: 'idle',
  RUNNING: 'running',
  PAUSED: 'paused',
  STOPPED: 'stopped',
  COOLING_OFF: 'cooling_off'
};

export class DeletionEngine {
  /**
   * @param {object} options
   * @param {object} options.client - Instance of XDeletionClient
   * @param {number} [options.minDelayMs=2000] - Min delay between calls
   * @param {number} [options.maxDelayMs=4500] - Max delay between calls
   * @param {number} [options.batchSize=60] - Number of items before sliding batch cooling
   * @param {number} [options.batchCoolingMs=900000] - Cooling duration (default 15 minutes)
   * @param {boolean} [options.dryRun=false] - Simulation mode without actual API calls
   * @param {Function} [options.sleepFn] - Custom sleep function for mocking/testing
   */
  constructor(options = {}) {
    this.client = options.client;
    this.minDelayMs = options.minDelayMs ?? 2000;
    this.maxDelayMs = options.maxDelayMs ?? 4500;
    this.batchSize = options.batchSize ?? 60;
    this.batchCoolingMs = options.batchCoolingMs ?? 15 * 60 * 1000; // 15 mins
    this.dryRun = options.dryRun ?? false;
    this.sleepFn = options.sleepFn || (ms => new Promise(resolve => setTimeout(resolve, ms)));

    this.queue = [];
    this.currentIndex = 0;
    this.state = EngineState.IDLE;
    this.processedInCurrentBatch = 0;
    this.consecutive429Count = 0;

    // Callbacks
    this.onProgress = options.onProgress || (() => {});
    this.onStateChange = options.onStateChange || (() => {});
    this.onError = options.onError || (() => {});
    this.onBatchCooling = options.onBatchCooling || (() => {});
  }

  /**
   * Loads items into the deletion queue
   * @param {Array<object>} items 
   */
  setQueue(items) {
    this.queue = [...items];
    this.currentIndex = 0;
    this.processedInCurrentBatch = 0;
    this.consecutive429Count = 0;
  }

  setState(newState, message = '') {
    this.state = newState;
    this.onStateChange({ state: newState, message, currentIndex: this.currentIndex, total: this.queue.length });
  }

  /**
   * Computes human-like randomized jitter delay
   */
  getRandomDelay() {
    const min = Math.min(this.minDelayMs, this.maxDelayMs);
    const max = Math.max(this.minDelayMs, this.maxDelayMs);
    return Math.floor(min + Math.random() * (max - min));
  }

  /**
   * Starts processing the queue
   */
  async start() {
    if (this.state === EngineState.RUNNING) return;
    if (this.queue.length === 0) {
      this.setState(EngineState.IDLE, 'Queue is empty');
      return;
    }

    this.setState(EngineState.RUNNING, 'Starting deletion process');
    await this._runLoop();
  }

  pause() {
    if (this.state === EngineState.RUNNING || this.state === EngineState.COOLING_OFF) {
      this.setState(EngineState.PAUSED, 'Process paused by user');
    }
  }

  resume() {
    if (this.state === EngineState.PAUSED) {
      this.setState(EngineState.RUNNING, 'Resuming deletion process');
      this._runLoop();
    }
  }

  stop() {
    this.setState(EngineState.STOPPED, 'Process stopped by user');
  }

  async _runLoop() {
    while (this.currentIndex < this.queue.length) {
      if (this.state !== EngineState.RUNNING) {
        break; // paused or stopped
      }

      const item = this.queue[this.currentIndex];

      try {
        let result;
        if (this.dryRun) {
          // Dry run mode simulates execution
          result = {
            status: 'success_dry_run',
            id: item.id,
            category: item.category
          };
        } else {
          result = await this.client.executeDelete(item);
        }

        this.consecutive429Count = 0;
        this.processedInCurrentBatch++;
        this.currentIndex++;

        this.onProgress({
          current: this.currentIndex,
          total: this.queue.length,
          item,
          result,
          percent: ((this.currentIndex / this.queue.length) * 100).toFixed(1)
        });

        // Check if finished
        if (this.currentIndex >= this.queue.length) {
          this.setState(EngineState.IDLE, 'All items successfully processed');
          break;
        }

        // Check sliding batch limit
        if (this.processedInCurrentBatch >= this.batchSize) {
          this.processedInCurrentBatch = 0;
          this.setState(
            EngineState.COOLING_OFF,
            `Completed batch of ${this.batchSize} items. Cooling down for ${Math.round(this.batchCoolingMs / 60000)} minutes.`
          );
          this.onBatchCooling({ durationMs: this.batchCoolingMs });

          await this.sleepFn(this.batchCoolingMs);

          if (this.state === EngineState.COOLING_OFF) {
            this.setState(EngineState.RUNNING, 'Cooling period finished, resuming');
          } else {
            break;
          }
        } else {
          // Normal jitter sleep between requests
          const delay = this.getRandomDelay();
          await this.sleepFn(delay);
        }

      } catch (err) {
        if (err instanceof RateLimitError) {
          this.consecutive429Count++;
          const backoffMinutes = 15 * this.consecutive429Count;
          const backoffMs = backoffMinutes * 60 * 1000;

          if (this.consecutive429Count > 3) {
            this.onError({
              error: new Error('Rate limit exceeded repeatedly (>3 times). Process halted for safety.'),
              item
            });
            this.setState(EngineState.STOPPED, 'Terminated due to persistent 429 rate limit');
            break;
          }

          this.setState(
            EngineState.COOLING_OFF,
            `429 Rate Limit encountered. Backing off for ${backoffMinutes} minutes (attempt ${this.consecutive429Count}).`
          );
          this.onBatchCooling({ durationMs: backoffMs, isRateLimit: true });

          await this.sleepFn(backoffMs);

          if (this.state === EngineState.COOLING_OFF) {
            this.setState(EngineState.RUNNING, 'Backoff finished, retrying item');
            // Do not advance currentIndex so we retry the current item
          } else {
            break;
          }
        } else if (err instanceof AuthError) {
          this.onError({ error: err, item });
          this.setState(EngineState.STOPPED, 'Authentication failed. Please refresh login session.');
          break;
        } else {
          // Other unexpected error: report and skip to prevent deadlock.
          // Still sleep the jitter delay — never hammer the API on repeated failures.
          this.onError({ error: err, item });
          this.currentIndex++;
          await this.sleepFn(this.getRandomDelay());
        }
      }
    }
  }
}
