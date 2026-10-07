/**
 * deleteX - Content Script Timeline Scanner
 * 
 * Scans tweets, retweets, replies, and quotes directly from the user's active x.com page.
 */

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'SCAN_TIMELINE') {
    scanCurrentPage(request.scrollTimes || 3).then(sendResponse);
    return true; // async response
  }
});

async function scanCurrentPage(scrollTimes = 3) {
  const foundTweetsMap = new Map();

  for (let i = 0; i < scrollTimes; i++) {
    extractVisibleTweets(foundTweetsMap);
    if (i < scrollTimes - 1) {
      window.scrollBy({ top: 1200, behavior: 'smooth' });
      await new Promise(r => setTimeout(r, 1200));
    }
  }

  return {
    success: true,
    tweets: Array.from(foundTweetsMap.values())
  };
}

function extractVisibleTweets(map) {
  const tweetArticles = document.querySelectorAll('article[data-testid="tweet"]');

  tweetArticles.forEach(article => {
    try {
      // 1. Extract Tweet ID from timestamp permalink
      const timeLink = article.querySelector('time')?.closest('a');
      if (!timeLink) return;

      const href = timeLink.getAttribute('href') || '';
      const match = href.match(/\/status\/(\d+)/);
      if (!match) return;

      const id = match[1];
      if (map.has(id)) return;

      // 2. Extract Text
      const textEl = article.querySelector('div[data-testid="tweetText"]');
      const text = textEl ? textEl.innerText : '';

      // 3. Classify: Retweet, Reply, Quote, Original
      let category = 'original';
      let sourceTweetId = null;

      // Check Retweet
      const socialContext = article.querySelector('span[data-testid="socialContext"]')?.innerText || '';
      if (socialContext.includes('Reposted') || socialContext.includes('转推') || socialContext.includes('Retweeted')) {
        category = 'retweet';
        sourceTweetId = id; // In live DOM, the link on the tweet is the source tweet ID
      } else {
        // Check Reply
        const isReply = text.startsWith('@') || article.innerText.includes('Replying to') || article.innerText.includes('回复');
        if (isReply) {
          category = 'reply';
        } else {
          // Check Quote
          const quoteContainer = article.querySelector('div[aria-labelledby] time');
          if (quoteContainer) {
            category = 'quote';
          }
        }
      }

      map.set(id, {
        id,
        category,
        sourceTweetId,
        text,
        createdAt: new Date().toISOString()
      });
    } catch (e) {
      // Ignore individual element parse errors
    }
  });
}
