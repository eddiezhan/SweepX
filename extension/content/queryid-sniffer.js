/**
 * SweepX - QueryId Sniffer (MAIN world)
 *
 * tweetXer-style: hook the page's own fetch/XHR and watch for DeleteTweet /
 * DeleteRetweet GraphQL requests. The URL contains the live queryId, so the
 * deletion client can follow X's rotations without shipping an update.
 *
 * Additionally captures the page's UserTweets* timeline responses so the
 * scanner classifies from authoritative API data instead of DOM guessing.
 *
 * Must run in the MAIN world (page context) at document_start, before the
 * site's bundles load, otherwise the hooks would miss requests.
 */

(() => {
  if (window.__sweepxSnifferInstalled) return;
  window.__sweepxSnifferInstalled = true;

  // queryId = path segment, operationName = last segment
  const GRAPHQL_RE = /\/i\/api\/graphql\/([^/]+)\/([A-Za-z0-9_]+)/;
  // Follow/unfollow still goes through the legacy v1.1 REST API on web:
  // POST /1.1/friendships/create.json (follow) | destroy.json (unfollow)
  const FRIENDSHIPS_RE = /\/1\.1\/friendships\/(create|destroy)\.json/;

  // Self-diagnostics + persistent buffer. The buffer lives HERE (MAIN world,
  // installed at document_start) because the scanner's listeners only come up
  // at document_idle — initial-load timeline data would otherwise be lost.
  const sniff = {
    graphqlOps: [],        // last GraphQL operation names seen on this page
    timelineResponses: 0,  // timeline responses intercepted
    entriesSeen: 0,        // timeline entries discovered inside them
    tweetsExtracted: 0     // own tweets extracted from them
  };
  const tweetBuffer = new Map(); // id -> normalized item

  // Following-list capture + unfollow template learning
  const followBuffer = {
    users: new Map(),          // user id -> {id, name} (entries seen on following lists)
    mutationCandidates: []     // last follow-family POST bodies (newest last; a list
                               // query like UserFollowing also matches /follow/, so
                               // the popup picks the real mutation from candidates)
  };

  // Rolling log of recent POST requests with bodies — ground truth for
  // "where does the unfollow actually go", surfaced in the popup log
  const recentPosts = [];
  function pushRecentPost(url, body) {
    try {
      const u = String(url);
      const b = String(body || '');
      // Skip obvious telemetry floods; keep API calls and anything carrying user ids
      if (/\/jot|logging|analytics/i.test(u)) return;
      if (!u.includes('/i/api/') && !/user_id|screen_name|rest_id/i.test(b)) return;
      recentPosts.push({ url: u.slice(0, 300), body: b.slice(0, 300) });
      if (recentPosts.length > 25) recentPosts.shift();
    } catch (e) { /* ignore */ }
  }

  function trackOp(name) {
    if (!sniff.graphqlOps.includes(name)) {
      sniff.graphqlOps.push(name);
      if (sniff.graphqlOps.length > 15) sniff.graphqlOps.shift();
    }
  }

  // On-demand state pull from the scanner (push events are lossy during
  // early page load — the pull is authoritative)
  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const d = event.data;
    if (d && d.source === 'sweepx-get-state') {
      try {
        window.postMessage({ source: 'sweepx-timeline', tweets: Array.from(tweetBuffer.values()) }, '*');
        window.postMessage({
          source: 'sweepx-following',
          users: Array.from(followBuffer.users.values()),
          mutationCandidates: followBuffer.mutationCandidates,
          recentPosts: recentPosts.slice()
        }, '*');
        window.postMessage({ source: 'sweepx-sniff-debug', sniff: { ...sniff } }, '*');
      } catch (e) { /* ignore */ }
    }
  });

  const report = (operation, queryId) => {
    try {
      window.postMessage({ source: 'sweepx-sniffer', operation, queryId }, '*');
    } catch (e) { /* never break the page */ }
  };

  // --- Timeline response extraction ---
  // NOTE: conversation modules may also include other users' PARENT tweets,
  // so every item is ownership-checked before collection.

  function getOwnScreenName() {
    const navHref = document.querySelector('a[data-testid="AppTabBar_Profile_Link"]')?.getAttribute('href');
    if (navHref && navHref.startsWith('/') && navHref.length > 1) {
      return navHref.slice(1).split('/')[0].toLowerCase();
    }
    const first = window.location.pathname.split('/')[1] || '';
    const reserved = ['home', 'i', 'explore', 'search', 'settings', 'notifications', 'messages'];
    if (first && !reserved.includes(first.toLowerCase())) return first.toLowerCase();
    return null;
  }

  function collectEntry(entry, out, ownName) {
    const ic = entry && entry.content;
    if (!ic) return;
    sniff.entriesSeen++;
    if (ic.entryType === 'TimelineTimelineModule' && Array.isArray(ic.items)) {
      for (const it of ic.items) {
        collectItemContent(it && it.item && it.item.itemContent, out, ownName);
      }
    } else {
      collectItemContent(ic.itemContent, out, ownName);
    }
  }

  function collectItemContent(itemContent, out, ownName) {
    // User entries (following/followers lists) — buffer for the unfollow tool
    const userEntry = itemContent && itemContent.user_results && itemContent.user_results.result;
    if (userEntry && userEntry.rest_id) {
      const uname = (userEntry.legacy && userEntry.legacy.screen_name)
        || (userEntry.core && userEntry.core.screen_name) || '';
      if (uname) {
        followBuffer.users.set(userEntry.rest_id, { id: userEntry.rest_id, name: uname });
      }
      return;
    }

    let result = itemContent && itemContent.tweet_results && itemContent.tweet_results.result;
    if (!result) return;
    if (result.__typename === 'TweetWithVisibilityResults' && result.tweet) {
      result = result.tweet;
    }
    const legacy = result.legacy;
    if (!legacy || !legacy.id_str) return;

    // Ownership check — conversation modules can contain other users' parent tweets
    const author = (result.core && result.core.user_results && result.core.user_results.result
      && ((result.core.user_results.result.legacy && result.core.user_results.result.legacy.screen_name)
        || (result.core.user_results.result.core && result.core.user_results.result.core.screen_name))) || '';
    if (ownName && author && author.toLowerCase() !== ownName) return;

    const fullText = legacy.full_text || '';
    let category = 'original';
    let sourceTweetId = null;

    const rt = legacy.retweeted_status_result && legacy.retweeted_status_result.result;
    if (rt || fullText.startsWith('RT @')) {
      category = 'retweet';
      sourceTweetId = (rt && (rt.rest_id || (rt.legacy && rt.legacy.id_str))) || legacy.id_str;
    } else if (legacy.in_reply_to_status_id_str) {
      category = 'reply';
    } else if (result.is_quote_status || legacy.quoted_status_id_str || result.quoted_status_result) {
      category = 'quote';
    }

    sniff.tweetsExtracted++;
    const item = {
      id: legacy.id_str,
      category,
      sourceTweetId,
      text: fullText,
      favoriteCount: typeof legacy.favorite_count === 'number' ? legacy.favorite_count : null,
      retweetCount: typeof legacy.retweet_count === 'number' ? legacy.retweet_count : null,
      createdAt: legacy.created_at ? new Date(legacy.created_at).toISOString() : new Date().toISOString()
    };
    tweetBuffer.set(item.id, item);
    out.push(item);
  }

  function reportTimeline(json) {
    try {
      const userResult = json && json.data && json.data.user && json.data.user.result;
      const timeline = (userResult && (userResult.timeline_v2 || userResult.timeline) || {}).timeline;
      const instructions = timeline && timeline.instructions;
      if (!Array.isArray(instructions)) {
        postDebug();
        return;
      }

      const ownName = getOwnScreenName();
      const out = [];
      for (const ins of instructions) {
        if (ins.type === 'TimelineAddEntries' && Array.isArray(ins.entries)) {
          for (const entry of ins.entries) collectEntry(entry, out, ownName);
        } else if (ins.type === 'TimelinePinEntry' && ins.entry) {
          collectEntry(ins.entry, out, ownName);
        }
      }
      if (out.length > 0) {
        window.postMessage({ source: 'sweepx-timeline', tweets: out }, '*');
      }
    } catch (e) { /* never break the page */ }
    postDebug();
  }

  function postDebug() {
    try {
      window.postMessage({ source: 'sweepx-sniff-debug', sniff: { ...sniff } }, '*');
    } catch (e) { /* ignore */ }
  }

  function watchResponseText(responseText) {
    try {
      sniff.timelineResponses++;
      reportTimeline(JSON.parse(responseText));
    } catch (e) {
      postDebug();
    }
  }

  // --- fetch hook ---
  const origFetch = window.fetch;
  if (typeof origFetch === 'function') {
    window.fetch = function (...args) {
      const promise = origFetch.apply(this, args);
      try {
        const input = args[0];
        const init = args[1];
        const url = typeof input === 'string' ? input : (input && input.url) || '';
        // Record every POST with a body (ground-truth request log)
        if (init && typeof init.body === 'string' && init.body) {
          pushRecentPost(url, init.body);
        } else if (init && init.body) {
          pushRecentPost(url, '(non-string body)');
        }
        const m = GRAPHQL_RE.exec(url);
        if (m) {
          const [, queryId, opName] = m;
          trackOp(opName);
          if (opName === 'DeleteTweet' || opName === 'DeleteRetweet') {
            report(opName, queryId);
          } else {
            // Follow-family ops need BOTH handlers, never else-if:
            // e.g. "UserFollowing" is a list QUERY whose response holds the
            // user entries, while "Unfollow" is the mutation we must learn.
            let isFollowOp = false;
            if (/follow|friendship/i.test(opName)) {
              isFollowOp = true;
              try {
                const init = args[1];
                const body = init && typeof init.body === 'string' ? init.body : null;
                if (body && body.includes('"variables"')) {
                  followBuffer.mutationCandidates.push({ opName, queryId, url, bodyText: body });
                  if (followBuffer.mutationCandidates.length > 5) followBuffer.mutationCandidates.shift();
                }
              } catch (e) { /* ignore */ }
            }
            if ((/Timeline/.test(opName) || isFollowOp) && promise && typeof promise.then === 'function') {
              // Capture the response body without consuming it for the page
              promise.then(res => {
                try {
                  if (res && typeof res.clone === 'function') {
                    res.clone().text().then(watchResponseText).catch(() => {});
                  }
                } catch (e) { /* ignore */ }
              }).catch(() => {});
            }
          }
        } else if (FRIENDSHIPS_RE.test(url)) {
          // v1.1 REST follow/unfollow (the web client still uses these)
          try {
            const init = args[1];
            const body = init && typeof init.body === 'string' ? init.body : null;
            if (body) {
              const kind = FRIENDSHIPS_RE.exec(url)[1];
              followBuffer.mutationCandidates.push({
                opName: `friendships/${kind}`,
                queryId: '',
                url,
                bodyText: body
              });
              if (followBuffer.mutationCandidates.length > 5) followBuffer.mutationCandidates.shift();
            }
          } catch (e) { /* ignore */ }
        }
      } catch (e) { /* ignore */ }
      return promise;
    };
  }

  // --- XHR send hook: capture request bodies for follow-family mutations ---
  const origSend = XMLHttpRequest.prototype.send;
  if (typeof origSend === 'function') {
    XMLHttpRequest.prototype.send = function (...args) {
      try {
        const body = args[0] == null ? '' : String(args[0]);
        if (body) pushRecentPost(this.__sweepxAllUrl || '', body);
        const info = this.__sweepx;
        if (info && /follow|friendship/i.test(info.opName) && body && body.includes('"variables"')) {
          followBuffer.mutationCandidates.push({
            opName: info.opName,
            queryId: info.queryId,
            url: info.url,
            bodyText: body
          });
          if (followBuffer.mutationCandidates.length > 5) followBuffer.mutationCandidates.shift();
        }
      } catch (e) { /* ignore */ }
      return origSend.apply(this, args);
    };
  }

  // --- XHR hook ---
  const origOpen = XMLHttpRequest.prototype.open;
  if (typeof origOpen === 'function') {
    XMLHttpRequest.prototype.open = function (method, url, ...rest) {
      try {
        this.__sweepxAllUrl = String(url);
        const m = GRAPHQL_RE.exec(String(url));
        if (m) {
          const [, queryId, opName] = m;
          trackOp(opName);
          this.__sweepx = { queryId, opName, url: String(url) };
          if (opName === 'DeleteTweet' || opName === 'DeleteRetweet') {
            report(opName, queryId);
          } else if (/Timeline/.test(opName) || /follow|friendship/i.test(opName)) {
            this.addEventListener('load', function () {
              watchResponseText(this.responseText);
            });
          }
        } else if (FRIENDSHIPS_RE.test(String(url))) {
          const fm = FRIENDSHIPS_RE.exec(String(url));
          this.__sweepx = { queryId: '', opName: `friendships/${fm[1]}`, url: String(url) };
        }
      } catch (e) { /* ignore */ }
      return origOpen.apply(this, [method, url, ...rest]);
    };
  }
})();
