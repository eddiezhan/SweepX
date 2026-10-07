import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  TweetCategory,
  parseArchiveContent,
  normalizeAndClassifyTweet,
  filterTweets
} from '../src/core/parser.js';

describe('Tweet Archive Parser & Classifier', () => {
  const sampleArchiveData = [
    {
      tweet: {
        id_str: '1001',
        full_text: 'Hello world, this is my original post!',
        created_at: 'Wed Oct 01 12:00:00 +0000 2025',
        favorite_count: '12',
        retweet_count: '2'
      }
    },
    {
      tweet: {
        id_str: '1002',
        full_text: 'RT @elonmusk: Starship launch successful today',
        created_at: 'Thu Oct 02 14:00:00 +0000 2025',
        retweeted_status_id_str: '9999999',
        favorite_count: '0',
        retweet_count: '0'
      }
    },
    {
      tweet: {
        id_str: '1003',
        full_text: '@jack Interesting point about decentralized networks',
        created_at: 'Fri Oct 03 16:00:00 +0000 2025',
        in_reply_to_status_id_str: '8888888',
        in_reply_to_user_id_str: '12',
        favorite_count: '5',
        retweet_count: '1'
      }
    },
    {
      tweet: {
        id_str: '1004',
        full_text: 'Check out this amazing article! https://t.co/abc',
        created_at: 'Sat Oct 04 18:00:00 +0000 2025',
        quoted_status_id_str: '7777777',
        favorite_count: '150',
        retweet_count: '45'
      }
    }
  ];

  it('should parse raw JSON array wrapped in window.YTD.tweets.part0', () => {
    const rawJs = `window.YTD.tweets.part0 = ${JSON.stringify(sampleArchiveData)};`;
    const parsed = parseArchiveContent(rawJs);

    assert.equal(parsed.length, 4);
    assert.equal(parsed[0].id, '1001');
    assert.equal(parsed[0].category, TweetCategory.ORIGINAL);

    assert.equal(parsed[1].id, '1002');
    assert.equal(parsed[1].category, TweetCategory.RETWEET);
    assert.equal(parsed[1].sourceTweetId, '9999999');

    assert.equal(parsed[2].id, '1003');
    assert.equal(parsed[2].category, TweetCategory.REPLY);
    assert.equal(parsed[2].inReplyToStatusId, '8888888');

    assert.equal(parsed[3].id, '1004');
    assert.equal(parsed[3].category, TweetCategory.QUOTE);
    assert.equal(parsed[3].quotedStatusId, '7777777');
  });

  it('should extract retweet sourceTweetId from entities url if retweeted_status_id is missing', () => {
    const rtWithoutId = {
      tweet: {
        id_str: '2001',
        full_text: 'RT @someone: Some interesting thoughts https://t.co/xyz',
        created_at: 'Sun Oct 05 10:00:00 +0000 2025',
        entities: {
          urls: [
            {
              expanded_url: 'https://twitter.com/someone/status/654321987',
              url: 'https://t.co/xyz'
            }
          ]
        }
      }
    };
    const classified = normalizeAndClassifyTweet(rtWithoutId);
    assert.equal(classified.category, TweetCategory.RETWEET);
    assert.equal(classified.sourceTweetId, '654321987');
  });

  it('should filter tweets by category', () => {
    const parsed = sampleArchiveData.map(normalizeAndClassifyTweet);
    const onlyRetweets = filterTweets(parsed, {
      categories: [TweetCategory.RETWEET]
    });
    assert.equal(onlyRetweets.length, 1);
    assert.equal(onlyRetweets[0].id, '1002');
  });

  it('should filter tweets preserving high favorites/likes threshold', () => {
    const parsed = sampleArchiveData.map(normalizeAndClassifyTweet);
    // Keep if favoriteCount >= 50 (should exclude id 1004 which has 150 favorites)
    const filtered = filterTweets(parsed, {
      keepIfFavoriteGte: 50
    });
    const ids = filtered.map(t => t.id);
    assert.ok(!ids.includes('1004'), 'High favorite tweet should be preserved from deletion');
    assert.ok(ids.includes('1001'));
  });

  it('should filter tweets by exclude keyword (whitelist protection)', () => {
    const parsed = sampleArchiveData.map(normalizeAndClassifyTweet);
    const filtered = filterTweets(parsed, {
      excludeKeywords: ['decentralized']
    });
    const ids = filtered.map(t => t.id);
    assert.ok(!ids.includes('1003'), 'Tweet containing excluded keyword should be preserved');
    assert.ok(ids.includes('1001'));
  });
});
