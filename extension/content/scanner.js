/**
 * SweepX - Content Script Timeline Scanner
 *
 * Scans tweets, retweets, replies, and quotes directly from the user's active x.com page.
 */

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'SCAN_TIMELINE') {
    scanCurrentPage(request.scrollTimes || 3).then(sendResponse);
    return true; // async response
  }
  if (request.type === 'SCAN_FOLLOWING') {
    // Flush the sniffer buffers, give the round-trip a moment, then report
    requestSnifferState();
    sleep(500).then(() => sendResponse({
      success: true,
      users: Array.from(followingUsersMap.values()),
      mutationCandidates: followMutationCandidates,
      recentPosts: recentPostsLog
    }));
    return true;
  }
});

// --- Exact timeline data (works with content/queryid-sniffer.js) ---
// The MAIN-world sniffer captures the page's own UserTweets(AndReplies)
// GraphQL responses, which contain authoritative per-tweet data
// (in_reply_to flags, engagement counts) and only ever the user's own content.
const apiTweetsMap = new Map();
let lastSniffDebug = null;

// Following-list capture (for the unfollow tool)
const followingUsersMap = new Map();
let followMutationCandidates = [];
let recentPostsLog = [];

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// Ask the MAIN-world sniffer to flush its buffered state (authoritative —
// push events can be lost before our listeners are up)
function requestSnifferState() {
  try {
    window.postMessage({ source: 'sweepx-get-state' }, '*');
  } catch (e) { /* ignore */ }
}

window.addEventListener('message', (event) => {
  if (event.source !== window) return;
  const d = event.data;
  if (!d) return;
  if (d.source === 'sweepx-timeline' && Array.isArray(d.tweets)) {
    for (const t of d.tweets) {
      if (t && t.id) apiTweetsMap.set(t.id, t);
    }
  } else if (d.source === 'sweepx-following') {
    if (Array.isArray(d.users)) {
      for (const u of d.users) {
        if (u && u.id) followingUsersMap.set(u.id, u);
      }
    }
    if (Array.isArray(d.mutationCandidates)) followMutationCandidates = d.mutationCandidates;
    if (Array.isArray(d.recentPosts)) recentPostsLog = d.recentPosts;
  } else if (d.source === 'sweepx-sniff-debug' && d.sniff) {
    lastSniffDebug = d.sniff;
  }
});

// --- QueryId learning (works with content/queryid-sniffer.js) ---
// The MAIN-world sniffer reports DeleteTweet/DeleteRetweet requests the page
// itself makes; persist the live queryIds so the deletion client follows X's
// rotations without shipping an extension update.
window.addEventListener('message', (event) => {
  if (event.source !== window) return;
  const d = event.data;
  if (!d || d.source !== 'sweepx-sniffer' || !d.operation || !d.queryId) return;
  try {
    chrome.storage.local.set({
      [`queryId_${d.operation}`]: d.queryId,
      [`queryIdAt_${d.operation}`]: Date.now()
    });
  } catch (e) { /* storage unavailable — ignore */ }
});

/**
 * Resolves the logged-in user's screen name so the scanner only collects
 * tweets authored by them. Tries the side-nav profile link first, then the
 * profile page URL itself (e.g. /<name>/with_replies).
 */
function getMyScreenName() {
  // 1. Side nav profile link (/name)
  const navHref = document.querySelector('a[data-testid="AppTabBar_Profile_Link"]')?.getAttribute('href');
  if (navHref && navHref.startsWith('/') && navHref.length > 1) {
    return navHref.slice(1).split('/')[0].toLowerCase();
  }
  // 2. Account switcher text ("@name", present in collapsed/side-panel layouts)
  const switcher = document.querySelector('div[data-testid="SideNav_AccountSwitcher_Button"]');
  const m = switcher?.innerText?.match(/@([A-Za-z0-9_]{1,15})/);
  if (m) return m[1].toLowerCase();
  // 3. Profile page URL itself (/name/...)
  const first = window.location.pathname.split('/')[1] || '';
  const reserved = ['home', 'i', 'explore', 'search', 'settings', 'notifications', 'messages'];
  if (first && !reserved.includes(first.toLowerCase())) {
    return first.toLowerCase();
  }
  return null;
}

/**
 * Detects which profile tab is active from the URL:
 *   /<name>/with_replies (or /replies) -> replies scope (collect only replies)
 *   /<name> (default)                  -> posts scope (collect posts/retweets/quotes)
 */
function getScanScope() {
  return /^\/[^/]+\/(with_replies|replies)/.test(window.location.pathname) ? 'replies' : 'posts';
}

async function scanCurrentPage(scrollTimes = 3) {
  const foundTweetsMap = new Map();
  const myName = getMyScreenName();
  const scope = getScanScope();
  const stats = { articles: 0, owned: 0, replyLike: 0, kept: 0 };

  // Pull everything the sniffer buffered since page load (initial timeline data)
  requestSnifferState();
  await sleep(400);

  // Scroll to make the page fetch more timeline data (captured by the sniffer)
  extractVisibleTweets(foundTweetsMap, myName, scope, stats); // DOM fallback data

  for (let i = 0; i < scrollTimes; i++) {
    window.scrollBy({ top: 1600, behavior: 'auto' });
    await waitForTimelineGrowth();
    extractVisibleTweets(foundTweetsMap, myName, scope, stats);
  }
  stats.kept = foundTweetsMap.size;

  // Final pull: collect anything captured during scrolling
  requestSnifferState();
  await sleep(400);

  // Prefer exact API data (authoritative categories/counts, own content only);
  // fall back to DOM parsing when the sniffer captured nothing (e.g. the page
  // was opened before the extension was reloaded)
  const mode = apiTweetsMap.size > 0 ? 'api' : 'dom';
  const tweets = mode === 'api'
    ? Array.from(apiTweetsMap.values())
    : Array.from(foundTweetsMap.values());

  return {
    success: true,
    scope,
    mode,
    stats,
    sniff: lastSniffDebug,
    apiMapSize: apiTweetsMap.size,
    tweets,
    warning: myName ? undefined : '无法确认当前登录用户，仅捕获了转推内容。请在本人个人主页上重新扫描。'
  };
}

/**
 * Waits until the infinite feed actually loads new content (article count or
 * page height grows), giving up after ~2.5s so slow networks don't stall forever.
 * Without this, a fixed short wait scans only whatever is already in the DOM
 * (typically just the first screen).
 */
async function waitForTimelineGrowth() {
  const metrics = () => ({
    articles: document.querySelectorAll('article[data-testid="tweet"]').length,
    height: document.documentElement.scrollHeight
  });
  const baseline = metrics();
  const deadline = Date.now() + 2500;

  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 300));
    const now = metrics();
    if (now.articles > baseline.articles || now.height > baseline.height) return;
  }
}

function extractVisibleTweets(map, myName, scope, stats) {
  const tweetArticles = document.querySelectorAll('article[data-testid="tweet"]');

  tweetArticles.forEach(article => {
    try {
      // 1. Extract author + Tweet ID from timestamp permalink (/author/status/id)
      const timeLink = article.querySelector('time')?.closest('a');
      if (!timeLink) return;

      const href = timeLink.getAttribute('href') || '';
      const match = href.match(/^\/([A-Za-z0-9_]{1,15})\/status\/(\d+)/);
      if (!match) return;

      stats.articles++;
      const author = match[1].toLowerCase();
      const id = match[2];
      if (map.has(id)) return;

      // 2. Extract Text
      const textEl = article.querySelector('div[data-testid="tweetText"]');
      const text = textEl ? textEl.innerText : '';

      // 3. Classify: Retweet, Reply, Quote, Original
      let category = 'original';
      let sourceTweetId = null;

      // Check Retweet (repost wrappers render the ORIGINAL author in the DOM,
      // so the ownership check below must not apply to them)
      const socialContext = article.querySelector('span[data-testid="socialContext"]')?.innerText || '';
      if (socialContext.includes('Reposted') || socialContext.includes('转推') || socialContext.includes('Retweeted')) {
        category = 'retweet';
        sourceTweetId = id; // In live DOM, the link on the tweet is the source tweet ID
      } else {
        // Ownership check: the Replies tab shows other users' parent tweets —
        // never collect tweets we don't own (X rejects them with code 183)
        if (!myName || author !== myName) return;
        stats.owned++;

        // Check Reply (covers en/zh-CN/zh-TW UI languages)
        const isReply = text.startsWith('@')
          || article.innerText.includes('Replying to')
          || article.innerText.includes('回复')
          || article.innerText.includes('回覆');
        if (isReply) {
          category = 'reply';
          stats.replyLike++;
        } else {
          // Check Quote
          const quoteContainer = article.querySelector('div[aria-labelledby] time');
          if (quoteContainer) {
            category = 'quote';
          }
        }

        // Scope filter: X interleaves content across profile tabs (the Posts
        // tab shows self-threads, the Replies tab mixes in originals). Keep
        // each tab's scan single-purpose; popup merges scans from both tabs.
        if (scope === 'posts' && category === 'reply') return;
        if (scope === 'replies' && category !== 'reply') return;
      }

      // 4. Best-effort engagement counts (leave undefined when not detectable;
      //    filterTweets treats unknown counts as protected, never deletes blindly)
      const engagement = parseEngagement(article);

      map.set(id, {
        id,
        category,
        sourceTweetId,
        text,
        favoriteCount: engagement.favoriteCount,
        retweetCount: engagement.retweetCount,
        createdAt: new Date().toISOString()
      });
    } catch (e) {
      // Ignore individual element parse errors
    }
  });
}

/**
 * Extracts retweet/like counts from the action bar aria-labels.
 * Works with both English ("12 replies, 5 retweets, 40 likes") and
 * Chinese ("12 条回复，5 次转推，40 次喜欢") UI languages.
 */
function parseEngagement(article) {
  let retweetCount;
  let favoriteCount;
  try {
    const group = article.querySelector('div[role="group"]');
    if (!group) return {};

    const labels = [];
    if (group.getAttribute('aria-label')) labels.push(group.getAttribute('aria-label'));
    group.querySelectorAll('button[aria-label]').forEach(b => labels.push(b.getAttribute('aria-label')));
    const text = labels.join(' ');

    const num = (re) => {
      const m = text.match(re);
      if (!m) return undefined;
      const n = parseInt(m[1].replace(/,/g, ''), 10);
      return Number.isNaN(n) ? undefined : n;
    };

    retweetCount = num(/([\d,.]+)\s*(?:retweets?|次转推|转推)/i);
    favoriteCount = num(/([\d,.]+)\s*(?:likes?|次喜欢|喜欢)/i);
  } catch (e) {
    // best-effort only
  }
  return { retweetCount, favoriteCount };
}
