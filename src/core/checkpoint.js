/**
 * SweepX - Checkpoint persistence for deletion runs
 *
 * Persists the deletion queue and progress to chrome.storage.local so an
 * interrupted run (closed tab, browser restart, crash) can resume from the
 * last processed item instead of starting over.
 *
 * The queue is stored once (large, written at start); progress is stored
 * separately (small, written per item) to keep writes cheap.
 */

const QUEUE_KEY = 'sweepx_checkpoint_queue';
const STATE_KEY = 'sweepx_checkpoint_state';

// Injectable for tests; defaults to chrome.storage.local in the extension
let storageAdapter = null;
export function setStorageAdapter(adapter) {
  storageAdapter = adapter;
}

function getStorage() {
  if (storageAdapter) return storageAdapter;
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    return chrome.storage.local;
  }
  return null;
}

/**
 * Creates a checkpoint for a new run. Stores a trimmed copy of the queue
 * (only fields needed for execution and preview) plus initial metadata.
 * @param {Array<object>} items - normalized tweet items
 * @param {{ dryRun: boolean }} meta
 */
export async function createCheckpoint(items, { dryRun }) {
  const storage = getStorage();
  if (!storage) return false;

  const queue = items.map(t => ({
    id: t.id,
    category: t.category,
    sourceTweetId: t.sourceTweetId ?? null,
    text: (t.text || '').slice(0, 200),
    favoriteCount: t.favoriteCount ?? null,
    retweetCount: t.retweetCount ?? null
  }));

  await storage.set({
    [QUEUE_KEY]: queue,
    [STATE_KEY]: {
      version: 1,
      dryRun: !!dryRun,
      currentIndex: 0,
      success: 0,
      already: 0,
      failed: 0,
      createdAt: Date.now(),
      updatedAt: Date.now()
    }
  });
  return true;
}

/**
 * Updates progress for the current run. No-op if no checkpoint exists.
 * @param {number} currentIndex
 * @param {{ success?: number, already?: number, failed?: number }} counts
 */
export async function saveProgress(currentIndex, counts = {}) {
  const storage = getStorage();
  if (!storage) return false;

  const res = await storage.get([STATE_KEY]);
  const state = res[STATE_KEY];
  if (!state) return false;

  await storage.set({
    [STATE_KEY]: {
      ...state,
      currentIndex,
      success: counts.success ?? state.success,
      already: counts.already ?? state.already,
      failed: counts.failed ?? state.failed,
      updatedAt: Date.now()
    }
  });
  return true;
}

/**
 * Loads an unfinished checkpoint, if any.
 * @returns {Promise<{ queue: Array, state: object } | null>}
 *   null when no checkpoint exists or the run is already complete
 */
export async function loadCheckpoint() {
  const storage = getStorage();
  if (!storage) return null;

  const res = await storage.get([QUEUE_KEY, STATE_KEY]);
  const queue = res[QUEUE_KEY];
  const state = res[STATE_KEY];
  if (!Array.isArray(queue) || !state || typeof state.currentIndex !== 'number') {
    return null;
  }
  if (state.currentIndex >= queue.length) {
    return null; // run complete — nothing to resume
  }
  return { queue, state };
}

/** Removes the checkpoint entirely (run finished or discarded). */
export async function clearCheckpoint() {
  const storage = getStorage();
  if (!storage) return;
  await storage.remove([QUEUE_KEY, STATE_KEY]);
}
