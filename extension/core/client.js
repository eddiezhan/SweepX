/**
 * SweepX - Core GraphQL Client for X (Twitter)
 * 
 * Interacts directly with X's internal GraphQL endpoints:
 * - DeleteTweet: for original posts, quotes, and replies
 * - DeleteRetweet: for unretweeting / deleting retweets
 */

import { TweetCategory } from './parser.js';

export const DEFAULT_BEARER_TOKEN =
  'Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA';

// Fallback known query IDs (regularly updated or dynamically sniffed from web client)
export const DEFAULT_QUERY_IDS = {
  DeleteTweet: 'VaenaVgh5q5ih7kvyVjgtg',
  DeleteRetweet: 'iQtK4dl5hBmXewYZuEOKVw'
};

export class RateLimitError extends Error {
  constructor(message = 'Rate limit reached (HTTP 429)') {
    super(message);
    this.name = 'RateLimitError';
    this.status = 429;
  }
}

export class AuthError extends Error {
  constructor(message = 'Authentication failed (HTTP 401/403)') {
    super(message);
    this.name = 'AuthError';
    this.status = 403;
  }
}

export class XDeletionClient {
  /**
   * @param {object} options
   * @param {string} options.ct0 - CSRF token from x.com cookies
   * @param {string} [options.authToken] - auth_token cookie (if running in backend/Node)
   * @param {string} [options.bearerToken] - Bearer token
   * @param {object} [options.queryIds] - Map of operationName to queryId
   * @param {Function} [options.fetchFn] - Custom fetch function for mocking/testing
   */
  constructor(options = {}) {
    this.ct0 = options.ct0 || '';
    this.authToken = options.authToken || '';
    this.bearerToken = options.bearerToken || DEFAULT_BEARER_TOKEN;
    this.queryIds = {
      ...DEFAULT_QUERY_IDS,
      ...(options.queryIds || {})
    };
    // fetch is a native method requiring `this` === window; calling it detached
    // throws "Illegal invocation" in Chrome, so bind it
    this.fetchFn = options.fetchFn || globalThis.fetch.bind(globalThis);
  }

  /**
   * Updates current query IDs dynamically (e.g. from network sniffer)
   * @param {object} newQueryIds 
   */
  setQueryIds(newQueryIds) {
    this.queryIds = { ...this.queryIds, ...newQueryIds };
  }

  getHeaders() {
    const headers = {
      'authorization': this.bearerToken,
      'x-csrf-token': this.ct0,
      'x-twitter-active-user': 'yes',
      'x-twitter-auth-type': 'OAuth2Session',
      'content-type': 'application/json'
    };

    // If running in Node.js or non-browser environment with auth_token cookie
    if (this.authToken) {
      headers['cookie'] = `auth_token=${this.authToken}; ct0=${this.ct0}`;
    }

    return headers;
  }

  /**
   * Delete an original post, reply, or quote tweet.
   * @param {string} tweetId 
   * @returns {Promise<{ status: string, id: string, message?: string }>}
   */
  async deleteTweet(tweetId) {
    const queryId = this.queryIds.DeleteTweet;
    const url = `https://x.com/i/api/graphql/${queryId}/DeleteTweet`;
    const payload = {
      variables: {
        tweet_id: String(tweetId),
        dark_request: false
      },
      queryId: queryId
    };

    const res = await this.fetchFn(url, {
      method: 'POST',
      // Browser: attach the real x.com cookies (incl. httpOnly auth_token) via
      // host_permissions. Without this the request goes out unauthenticated.
      // Manual 'cookie' headers are stripped by browsers (forbidden header).
      credentials: 'include',
      headers: this.getHeaders(),
      body: JSON.stringify(payload)
    });

    return this._handleResponse(res, tweetId, 'DeleteTweet');
  }

  /**
   * Unretweet / Delete a retweet using source_tweet_id.
   * @param {string} sourceTweetId 
   * @returns {Promise<{ status: string, id: string, message?: string }>}
   */
  async deleteRetweet(sourceTweetId) {
    if (!sourceTweetId) {
      throw new Error('sourceTweetId is required to unretweet');
    }

    const queryId = this.queryIds.DeleteRetweet;
    const url = `https://x.com/i/api/graphql/${queryId}/DeleteRetweet`;
    const payload = {
      variables: {
        source_tweet_id: String(sourceTweetId)
      },
      queryId: queryId
    };

    const res = await this.fetchFn(url, {
      method: 'POST',
      // See deleteTweet: cookies must come from the browser cookie jar
      credentials: 'include',
      headers: this.getHeaders(),
      body: JSON.stringify(payload)
    });

    return this._handleResponse(res, sourceTweetId, 'DeleteRetweet');
  }

  /**
   * Automatically dispatches deletion based on normalized tweet category.
   * @param {object} tweet - Normalized tweet object from parser
   * @returns {Promise<{ status: string, id: string, message?: string }>}
   */
  async executeDelete(tweet) {
    if (!tweet || !tweet.id) {
      throw new Error('Invalid tweet item provided to executeDelete');
    }

    if (tweet.category === TweetCategory.RETWEET) {
      return this.deleteRetweet(tweet.sourceTweetId || tweet.id);
    } else {
      return this.deleteTweet(tweet.id);
    }
  }

  async _handleResponse(res, targetId, operationName) {
    // Read body defensively: prefer .text() (works for non-JSON error bodies),
    // fall back to .json() for test mocks / legacy response-like objects
    let data = null;
    let bodyText = '';
    try {
      if (typeof res.text === 'function') {
        bodyText = (await res.text()) || '';
        data = bodyText ? JSON.parse(bodyText) : null;
      } else if (typeof res.json === 'function') {
        data = await res.json();
      }
    } catch (e) { /* non-JSON body */ }

    if (res.status === 200) {
      if (data && data.errors && data.errors.length > 0) {
        const errorMessages = data.errors.map(e => e.message || '').join('; ');
        // Check if tweet was already deleted or not found
        const isAlreadyDeleted = data.errors.some(
          e => (e.message && e.message.toLowerCase().includes('not found')) || e.code === 144
        );
        if (isAlreadyDeleted) {
          return {
            status: 'already_deleted',
            id: targetId,
            operation: operationName,
            message: 'Tweet was already deleted or not found'
          };
        }
        return {
          status: 'failed',
          id: targetId,
          operation: operationName,
          message: errorMessages
        };
      }
      // A 200 without errors must still contain the operation-specific result
      // key (delete_tweet / unretweet) to count as a real success — this
      // catches silent no-ops (e.g. a stale queryId resolving elsewhere)
      const opKey = operationName === 'DeleteRetweet' ? 'unretweet' : 'delete_tweet';
      if (!data || data.data === undefined || !data.data[opKey]) {
        return {
          status: 'failed',
          id: targetId,
          operation: operationName,
          message: `Unexpected response payload (queryId may be stale): ${bodyText ? bodyText.slice(0, 250) : '(empty body)'}`
        };
      }
      return {
        status: 'success',
        id: targetId,
        operation: operationName
      };
    }

    // Surface X's actual error payload in logs so failures are diagnosable
    const detail = bodyText ? ` Response: ${bodyText.slice(0, 300)}` : '';

    if (res.status === 429) {
      throw new RateLimitError('Rate limit exceeded (HTTP 429). Please slow down or cool off.');
    }
    if (res.status === 401 || res.status === 403) {
      throw new AuthError(`Authentication error (HTTP ${res.status}).${detail || ' Verify your ct0/cookie session.'}`);
    }
    if (res.status === 404) {
      throw new Error(`GraphQL ${operationName} queryId appears outdated (HTTP 404). The query ID needs updating.${detail}`);
    }
    throw new Error(`Unexpected HTTP status ${res.status} during ${operationName}.${detail}`);
  }
}
