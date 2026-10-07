import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DeletionEngine, EngineState } from '../src/core/engine.js';
import { RateLimitError } from '../src/core/client.js';
import { TweetCategory } from '../src/core/parser.js';

describe('Deletion Execution Engine', () => {
  it('should process queue in dryRun mode with progress updates', async () => {
    const sleepLogs = [];
    const mockSleep = async (ms) => {
      sleepLogs.push(ms);
    };

    const progressReports = [];
    const engine = new DeletionEngine({
      minDelayMs: 10,
      maxDelayMs: 20,
      dryRun: true,
      sleepFn: mockSleep,
      onProgress: (p) => progressReports.push(p)
    });

    const items = [
      { id: '1', category: TweetCategory.ORIGINAL },
      { id: '2', category: TweetCategory.RETWEET, sourceTweetId: 'src_2' },
      { id: '3', category: TweetCategory.REPLY }
    ];

    engine.setQueue(items);
    await engine.start();

    assert.equal(progressReports.length, 3);
    assert.equal(progressReports[0].current, 1);
    assert.equal(progressReports[2].percent, '100.0');
    assert.equal(engine.state, EngineState.IDLE);
    // Two delays between 3 items
    assert.equal(sleepLogs.length, 2);
  });

  it('should trigger batch cooling when batchSize is reached', async () => {
    let coolingTriggered = false;
    let coolingDuration = 0;

    const mockSleep = async (ms) => {
      if (ms === 500) {
        coolingTriggered = true;
        coolingDuration = ms;
      }
    };

    const engine = new DeletionEngine({
      minDelayMs: 1,
      maxDelayMs: 2,
      batchSize: 2,
      batchCoolingMs: 500,
      dryRun: true,
      sleepFn: mockSleep
    });

    const items = [
      { id: '1', category: TweetCategory.ORIGINAL },
      { id: '2', category: TweetCategory.ORIGINAL },
      { id: '3', category: TweetCategory.ORIGINAL }
    ];

    engine.setQueue(items);
    await engine.start();

    assert.ok(coolingTriggered, 'Batch cooling should have been triggered');
    assert.equal(coolingDuration, 500);
    assert.equal(engine.currentIndex, 3);
  });

  it('should handle RateLimitError with backoff and retry', async () => {
    let callCount = 0;
    const mockClient = {
      executeDelete: async (item) => {
        callCount++;
        if (callCount === 1) {
          throw new RateLimitError();
        }
        return { status: 'success', id: item.id };
      }
    };

    const sleepLogs = [];
    const mockSleep = async (ms) => {
      sleepLogs.push(ms);
    };

    const engine = new DeletionEngine({
      client: mockClient,
      minDelayMs: 1,
      maxDelayMs: 2,
      sleepFn: mockSleep
    });

    const items = [{ id: '1', category: TweetCategory.ORIGINAL }];
    engine.setQueue(items);
    await engine.start();

    // Call count should be 2 (first 429 failed, second succeeded)
    assert.equal(callCount, 2);
    // Backoff sleep was recorded (15 minutes in ms = 900000)
    assert.ok(sleepLogs.includes(15 * 60 * 1000));
    assert.equal(engine.currentIndex, 1);
  });
});
