import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  XDeletionClient,
  RateLimitError,
  AuthError,
  DEFAULT_BEARER_TOKEN
} from '../src/core/client.js';
import { TweetCategory } from '../src/core/parser.js';

describe('X GraphQL Deletion Client', () => {
  it('should call DeleteTweet for original post and return success', async () => {
    let capturedUrl = '';
    let capturedOptions = {};

    const mockFetch = async (url, options) => {
      capturedUrl = url;
      capturedOptions = options;
      return {
        status: 200,
        json: async () => ({
          data: {
            delete_tweet: { tweet_results: {} }
          }
        })
      };
    };

    const client = new XDeletionClient({
      ct0: 'test_csrf_token',
      fetchFn: mockFetch
    });

    const result = await client.executeDelete({
      id: '123456',
      category: TweetCategory.ORIGINAL
    });

    assert.equal(result.status, 'success');
    assert.equal(result.id, '123456');
    assert.ok(capturedUrl.includes('/DeleteTweet'));

    const body = JSON.parse(capturedOptions.body);
    assert.equal(body.variables.tweet_id, '123456');
    assert.equal(capturedOptions.headers['x-csrf-token'], 'test_csrf_token');
    assert.equal(capturedOptions.headers['authorization'], DEFAULT_BEARER_TOKEN);
  });

  it('should call DeleteRetweet with sourceTweetId for retweet', async () => {
    let capturedUrl = '';
    let capturedOptions = {};

    const mockFetch = async (url, options) => {
      capturedUrl = url;
      capturedOptions = options;
      return {
        status: 200,
        json: async () => ({
          data: {
            unretweet: { source_tweet_results: {} }
          }
        })
      };
    };

    const client = new XDeletionClient({
      ct0: 'test_csrf_token',
      fetchFn: mockFetch
    });

    const result = await client.executeDelete({
      id: 'self_rt_id_999',
      category: TweetCategory.RETWEET,
      sourceTweetId: 'orig_tweet_888'
    });

    assert.equal(result.status, 'success');
    assert.equal(result.id, 'orig_tweet_888');
    assert.ok(capturedUrl.includes('/DeleteRetweet'));

    const body = JSON.parse(capturedOptions.body);
    assert.equal(body.variables.source_tweet_id, 'orig_tweet_888');
  });

  it('should recognize already deleted tweets without erroring out', async () => {
    const mockFetch = async () => ({
      status: 200,
      json: async () => ({
        errors: [{ message: 'No status found with that ID.', code: 144 }]
      })
    });

    const client = new XDeletionClient({
      ct0: 'token',
      fetchFn: mockFetch
    });

    const result = await client.deleteTweet('404040');
    assert.equal(result.status, 'already_deleted');
    assert.equal(result.id, '404040');
  });

  it('should throw RateLimitError when HTTP 429 is encountered', async () => {
    const mockFetch = async () => ({
      status: 429,
      json: async () => ({})
    });

    const client = new XDeletionClient({
      ct0: 'token',
      fetchFn: mockFetch
    });

    await assert.rejects(
      async () => {
        await client.deleteTweet('111');
      },
      err => err instanceof RateLimitError
    );
  });

  it('should throw AuthError when HTTP 403 is encountered', async () => {
    const mockFetch = async () => ({
      status: 403,
      json: async () => ({})
    });

    const client = new XDeletionClient({
      ct0: 'token',
      fetchFn: mockFetch
    });

    await assert.rejects(
      async () => {
        await client.deleteTweet('222');
      },
      err => err instanceof AuthError
    );
  });
});
