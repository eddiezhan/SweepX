/**
 * deleteX - Core Tweet Archive Parser & Classifier
 * 
 * Accurately classifies X (Twitter) archive items into:
 * 1. original (原创发帖)
 * 2. retweet (转发/转推)
 * 3. quote (引用发帖)
 * 4. reply (回复)
 */

export const TweetCategory = {
  ORIGINAL: 'original',
  RETWEET: 'retweet',
  QUOTE: 'quote',
  REPLY: 'reply'
};

/**
 * Strips JS variable wrapper (e.g., `window.YTD.tweets.part0 = `) and parses JSON.
 * @param {string} rawText 
 * @returns {Array<object>}
 */
export function parseArchiveContent(rawText) {
  if (!rawText || typeof rawText !== 'string') {
    throw new Error('Invalid archive content: input must be a non-empty string');
  }

  let cleaned = rawText.trim();
  // Strip window.YTD.tweets.partX = prefix if present
  const prefixMatch = cleaned.match(/^window\.YTD\.tweets\.part\d+\s*=\s*/);
  if (prefixMatch) {
    cleaned = cleaned.slice(prefixMatch[0].length);
  }

  // Strip trailing semicolon if present
  if (cleaned.endsWith(';')) {
    cleaned = cleaned.slice(0, -1).trim();
  }

  let rawList;
  try {
    rawList = JSON.parse(cleaned);
  } catch (err) {
    throw new Error(`Failed to parse tweets archive JSON: ${err.message}`);
  }

  if (!Array.isArray(rawList)) {
    throw new Error('Invalid archive format: expected an array of tweet objects');
  }

  return rawList.map(item => normalizeAndClassifyTweet(item));
}

/**
 * Normalizes and categorizes a single tweet record from archive.
 * @param {object} item 
 * @returns {object}
 */
export function normalizeAndClassifyTweet(item) {
  const t = item.tweet || item;
  const id = String(t.id_str || t.id || '');
  const text = t.full_text || t.text || '';
  const createdAt = t.created_at ? new Date(t.created_at) : new Date();
  const favoriteCount = parseInt(t.favorite_count || '0', 10);
  const retweetCount = parseInt(t.retweet_count || '0', 10);

  // 1. Check for Retweet
  // Characteristics: text starts with 'RT @' or has retweeted_status_id
  const isRtPrefix = text.startsWith('RT @');
  const rtStatusId = t.retweeted_status_id_str || t.retweeted_status_id;

  if (isRtPrefix || rtStatusId) {
    let sourceTweetId = rtStatusId ? String(rtStatusId) : null;

    // If sourceTweetId is missing in archive metadata, attempt extraction from entities
    if (!sourceTweetId && t.entities && Array.isArray(t.entities.urls)) {
      for (const u of t.entities.urls) {
        const targetUrl = u.expanded_url || u.url || '';
        const match = targetUrl.match(/\/status\/(\d+)/);
        if (match) {
          sourceTweetId = match[1];
          break;
        }
      }
    }

    return {
      id,
      category: TweetCategory.RETWEET,
      text,
      createdAt,
      favoriteCount,
      retweetCount,
      sourceTweetId: sourceTweetId || id // fallback to self id if source id not found
    };
  }

  // 2. Check for Reply
  // Characteristics: in_reply_to_status_id or in_reply_to_user_id exists
  const inReplyToStatusId = t.in_reply_to_status_id_str || t.in_reply_to_status_id;
  const inReplyToUserId = t.in_reply_to_user_id_str || t.in_reply_to_user_id;

  if (inReplyToStatusId || inReplyToUserId) {
    return {
      id,
      category: TweetCategory.REPLY,
      text,
      createdAt,
      favoriteCount,
      retweetCount,
      inReplyToStatusId: inReplyToStatusId ? String(inReplyToStatusId) : null,
      inReplyToUserId: inReplyToUserId ? String(inReplyToUserId) : null
    };
  }

  // 3. Check for Quote
  // Characteristics: quoted_status_id exists
  const quotedStatusId = t.quoted_status_id_str || t.quoted_status_id;
  const quotedStatusPermalink = t.quoted_status_permalink;

  if (quotedStatusId || quotedStatusPermalink) {
    let extractedQuoteId = quotedStatusId ? String(quotedStatusId) : null;
    if (!extractedQuoteId && quotedStatusPermalink && quotedStatusPermalink.expanded) {
      const match = quotedStatusPermalink.expanded.match(/\/status\/(\d+)/);
      if (match) extractedQuoteId = match[1];
    }

    return {
      id,
      category: TweetCategory.QUOTE,
      text,
      createdAt,
      favoriteCount,
      retweetCount,
      quotedStatusId: extractedQuoteId
    };
  }

  // 4. Default: Original Post
  return {
    id,
    category: TweetCategory.ORIGINAL,
    text,
    createdAt,
    favoriteCount,
    retweetCount
  };
}

/**
 * Filters normalized tweets by user-defined rules.
 * @param {Array<object>} tweets 
 * @param {object} options 
 * @returns {Array<object>}
 */
export function filterTweets(tweets, options = {}) {
  const {
    categories = [TweetCategory.ORIGINAL, TweetCategory.RETWEET, TweetCategory.QUOTE, TweetCategory.REPLY],
    startDate = null,
    endDate = null,
    keepIfFavoriteGte = null,
    keepIfRetweetGte = null,
    excludeKeywords = [],
    includeKeywords = []
  } = options;

  const allowedCategories = new Set(categories);
  const startTs = startDate ? new Date(startDate).getTime() : null;
  const endTs = endDate ? new Date(endDate).getTime() : null;

  return tweets.filter(t => {
    // 1. Category check
    if (!allowedCategories.has(t.category)) {
      return false;
    }

    // 2. Date range check
    const tweetTs = t.createdAt.getTime();
    if (startTs !== null && tweetTs < startTs) {
      return false;
    }
    if (endTs !== null && tweetTs > endTs) {
      return false;
    }

    // 3. Keep high-engagement tweets (Likes)
    if (keepIfFavoriteGte !== null && keepIfFavoriteGte !== undefined && t.favoriteCount >= keepIfFavoriteGte) {
      return false; // preserved
    }

    // 4. Keep high-engagement tweets (Retweets)
    if (keepIfRetweetGte !== null && keepIfRetweetGte !== undefined && t.retweetCount >= keepIfRetweetGte) {
      return false; // preserved
    }

    // 5. Keyword exclusion (Whitelist protection)
    if (Array.isArray(excludeKeywords) && excludeKeywords.length > 0) {
      const lowerText = t.text.toLowerCase();
      const hasExcludedKeyword = excludeKeywords.some(kw => kw && lowerText.includes(kw.toLowerCase()));
      if (hasExcludedKeyword) {
        return false;
      }
    }

    // 6. Keyword inclusion (Target only specific keywords if provided)
    if (Array.isArray(includeKeywords) && includeKeywords.length > 0) {
      const lowerText = t.text.toLowerCase();
      const hasIncludedKeyword = includeKeywords.some(kw => kw && lowerText.includes(kw.toLowerCase()));
      if (!hasIncludedKeyword) {
        return false;
      }
    }

    return true;
  });
}
