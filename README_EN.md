<div align="center">

# 🧹 SweepX

**Free, open-source, 100% local bulk cleanup tool for X (Twitter)**

English | [中文](./README.md)

Bulk-delete your posts / retweets / quotes / replies, and bulk-unfollow — your data never leaves your machine. No servers, no tracking, no paywall.

</div>

---

## ✨ Features

- **📦 Full archive cleanup** — drop in your official X data export (zip or tweets.js) and wipe your entire history
- **⚡ Live timeline scan** — reads the page's own GraphQL responses (not DOM guesswork): exact categories, real engagement counts, results merge across scans, adjustable scan depth
- **👥 Batch unfollow** — learn-by-demo architecture: manually unfollow ONE account to teach SweepX the current unfollow endpoint, then tick a checklist and run (all selected by default, display names shown, rate-limited pacing)
- **🎯 Accurate 4-way classification** — posts / retweets / quotes / replies; retweets go through Unretweet, everything else through DeleteTweet
- **🔍 Multi-dimensional filters** — date range, keep highly-liked/highly-retweeted posts, keyword whitelist to prevent accidents
- **🧪 Dry-Run mode** — preview exactly what would be deleted without calling the API
- **⏯ Checkpoint & resume** — queue and progress persist in real time; close the tab or restart the browser and resume where you left off
- **🧠 Endpoint auto-learning** — captures the page's own delete requests and query IDs, so X rotations don't require extension updates; self-persists after the first successful deletion
- **🛡 Anti-ban pacing** — human-like jitter, batch cooling (60 items / 15 min), exponential backoff on 429, auto circuit-breaker
- **🗑 Auto-cleanup of done items** — deleted items leave the working set immediately; button counts stay honest
- **🖥 Full-screen dashboard** — one click from the popup: live scan / batch unfollow / archive in three tabs, big preview table, shared execution console, tab-following activity log
- **🔔 Toolbar icon states** — lights up while an x.com session exists, dims when logged out
- **💾 CSV backup** — one-click full backup before deletion
- **🔒 100% local** — no backend, no telemetry; credentials are only used to build requests on your machine

## 📦 Install

1. Download this repo (unzip, or `git clone`)
2. Open `chrome://extensions` in Chrome
3. Enable **Developer mode** (top right)
4. Click **Load unpacked** and select the `extension/` folder
5. Log in to x.com — the toolbar icon **lights up** when the session is ready

> A userscript build (`userscript/sweepx.user.js`) is also available for Tampermonkey.

## 🖒 Popup vs Dashboard

| | Popup (extension icon) | Dashboard ("↗ 大屏" inside the popup) |
|---|---|---|
| Best for | quick small batches | deep scans, large batches, preview table |
| Live scan / unfollow / archive | ✅ all three | ✅ all three |
| Log | mini log | big activity log (follows the active tab) |
| Data preview table | ✗ | ✅ first 50 matched |
| Checkpoint resume | ✅ shared between both | ✅ |

> The dashboard's deletion console is shared by the live-scan and archive tabs — scan, then delete right there.

## 🚀 Usage

### Option A: Full archive cleanup (recommended for the big sweep)

1. On X: Settings → Your account → **Download an archive of your data** (takes hours to 24h+)
2. "Archive" tab → drop in the `.zip`
3. Pick categories and filters (dates / keep high-engagement / keyword whitelist)
4. **Run once with Dry-Run enabled** and verify the preview counts
5. Disable Dry-Run and execute for real (keep the page open; the engine auto-cools between batches; interrupted runs resume from the checkpoint)

### Option B: Live scan (best for recent data)

1. Open your x.com profile in the browser (Posts or Replies tab, either works)
2. Click Scan — SweepX **auto-reloads the page** and reads the official GraphQL data the page loads: exact categories, real counts
3. Scan depth is adjustable (default 8 scrolls ≈ 40-80 items); multiple scans merge by ID
4. Delete right from the scan tab (popup) or from the dashboard's shared deletion console

### Option C: Batch unfollow

1. Open your Following list (left nav → Following), **refresh the page once**
2. **Manually unfollow any one account** — this teaches SweepX the current unfollow endpoint (you can re-follow them afterwards)
3. Back in SweepX → "👥 Unfollow" → "📋 Read captured list"
4. Tick the accounts you want gone (all selected by default) → "🚫 Start unfollow"
5. ~3-6 seconds per account; rate limits stop the run automatically; successful accounts leave the list, failures stay for retry

### Checkpoint & resume

Progress is saved automatically while a run is active. If the page closes unexpectedly,
reopening the extension or dashboard shows "Unfinished task: X/Y processed" — click Resume to continue.
Completed runs clear the checkpoint automatically; you can also discard it manually.

### Endpoint auto-learning

X rotates its internal API IDs. SweepX adapts three ways:

1. **Page sniffing** — listens to the page's own delete requests (manually delete any one tweet on x.com once)
2. **Success bootstrap** — after SweepX's own first successful deletion, the working parameters are persisted
3. **Built-in fallback** — otherwise built-in IDs are used; failures surface X's raw response instead of fake successes

## ❓ FAQ

<details>
<summary>Deletion fails with 403 / auth error?</summary>

Make sure you are logged in to x.com, then click "Refresh session" in the extension.
</details>

<details>
<summary>Deletion fails with 404 or a "fake success"?</summary>

The API parameters are stale (X redesigned). Manually delete one tweet on x.com so SweepX
re-learns, then retry. SweepX marks a 200-without-real-effect response as a failure with the
raw body — it will not silently pretend to succeed.
</details>

<details>
<summary>Scan returns nothing / says "DOM fallback"?</summary>

Scanning auto-reloads the x.com page to activate data capture. If it still says fallback,
refresh x.com manually and scan again. Reply detection is unavailable in fallback mode
(X no longer renders reply indicators in the timeline DOM).
</details>

<details>
<summary>Unfollow says "endpoint not learned"?</summary>

A page refresh clears the learned state. On the Following list page, refresh, manually
unfollow one account, then click "Read". The log shows captured candidate endpoints and the
latest requests — everything is visible.
</details>

<details>
<summary>How fast is deletion?</summary>

Slow on purpose, for account safety: ~15-20 items/minute, cooling 15 minutes after every 60.
500 items ≈ 2-3h, 5,000 ≈ 1-2 days, tens of thousands ≈ several days (hands-off).
</details>

<details>
<summary>Will I get suspended?</summary>

Automating internal endpoints violates X's ToS. SweepX paces requests to mimic human
behavior to reduce risk, but **cannot guarantee zero risk**. Evaluate for yourself; start
with a small batch first.
</details>

## 🔒 Privacy

- All parsing, filtering, and deletion/unfollow requests happen **locally in your browser** — no third-party servers involved
- The `ct0` / `auth_token` cookies are read **solely** to build requests locally; never stored or uploaded
- Archive files are parsed locally and never sent anywhere

## ☕ Donate

SweepX is free and open source, forever. If it cleaned up years of old posts for you, buy the author a coffee:

| Method | Link / QR |
|---|---|
| ⚡ Afdian | [afdian.com/a/eddiezhan](https://afdian.com/a/eddiezhan) |
| 💚 WeChat | ![WeChat](./donate/wechat_qr.png) |
| 💙 Alipay | ![Alipay](./donate/alipay_qr.png) |
| ₿ USDT (TRC20) | ![USDT](./donate/usdt_qr.png) |

## ⚠️ Disclaimer

This project is for personal data management and educational purposes only. Any consequences
of using it (including account restrictions) are borne by the user. Please comply with the
target platform's terms of service and local laws.

## 📄 License

[MIT](./LICENSE)
