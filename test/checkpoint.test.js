import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  createCheckpoint,
  saveProgress,
  loadCheckpoint,
  clearCheckpoint,
  setStorageAdapter
} from '../src/core/checkpoint.js';

// In-memory chrome.storage.local stand-in
function fakeStorage() {
  const map = new Map();
  return {
    async get(keys) {
      const out = {};
      for (const k of keys) if (map.has(k)) out[k] = map.get(k);
      return out;
    },
    async set(obj) {
      for (const [k, v] of Object.entries(obj)) map.set(k, v);
    },
    async remove(keys) {
      for (const k of keys) map.delete(k);
    }
  };
}

describe('Deletion Checkpoint Persistence', () => {
  beforeEach(() => {
    setStorageAdapter(fakeStorage());
  });

  const sampleItems = [
    { id: '1', category: 'original', text: 'hello world', favoriteCount: 5, retweetCount: 1 },
    { id: '2', category: 'retweet', sourceTweetId: '99', text: 'RT @a: b', favoriteCount: null, retweetCount: null },
    { id: '3', category: 'reply', text: 'x'.repeat(500), favoriteCount: 0, retweetCount: 0 }
  ];

  it('should create a checkpoint with trimmed queue and zeroed progress', async () => {
    await createCheckpoint(sampleItems, { dryRun: true });

    const cp = await loadCheckpoint();
    assert.ok(cp, 'checkpoint should exist for an incomplete run');
    assert.equal(cp.state.currentIndex, 0);
    assert.equal(cp.state.dryRun, true);
    assert.equal(cp.queue.length, 3);

    // Long text is truncated for storage economy
    assert.ok(cp.queue[2].text.length <= 200, 'text should be truncated to 200 chars');
    // Minimal fields preserved for execution
    assert.equal(cp.queue[1].sourceTweetId, '99');
  });

  it('should persist progress updates across loads', async () => {
    await createCheckpoint(sampleItems, { dryRun: false });
    await saveProgress(2, { success: 1, already: 1, failed: 0 });

    const cp = await loadCheckpoint();
    assert.equal(cp.state.currentIndex, 2);
    assert.equal(cp.state.success, 1);
    assert.equal(cp.state.already, 1);
  });

  it('should return null once the run is complete', async () => {
    await createCheckpoint(sampleItems, { dryRun: true });
    await saveProgress(3, { success: 3 });

    const cp = await loadCheckpoint();
    assert.equal(cp, null, 'completed run should not be resumable');
  });

  it('should return null after clearing the checkpoint', async () => {
    await createCheckpoint(sampleItems, { dryRun: true });
    await clearCheckpoint();

    const cp = await loadCheckpoint();
    assert.equal(cp, null);
  });

  it('should return null when no checkpoint was ever created', async () => {
    assert.equal(await loadCheckpoint(), null);
  });
});
