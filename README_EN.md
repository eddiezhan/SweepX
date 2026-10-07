<div align="center">

# 🧹 SweepX

**Free, open-source, 100% local bulk cleanup tool for X (Twitter)**

English | [中文](./README.md)

Bulk-delete your posts / retweets / quotes / replies — your data never leaves your machine. No servers, no tracking, no paywall.

</div>

---

## ✨ Features

- **📦 Full archive cleanup** — drop in your official X data export (zip or tweets.js) and wipe your entire history
- **⚡ Live timeline scan** — auto-scrolls your profile to clean recent data, no need to wait for the archive
- **🎯 Accurate 4-way classification** — posts / retweets / quotes / replies, each dispatched to its proper endpoint (retweets via Unretweet)
- **🔍 Multi-dimensional filters** — date range, keep highly-liked posts, keyword whitelist to prevent accidents
- **🧪 Dry-Run mode** — preview exactly what would be deleted without calling the API
- **⏯ Checkpoint & resume** — close the tab or restart the browser; resume right where you left off
- **🧠 queryId auto-learning** — captures live API parameters from the page, so X rotations don't require extension updates
- **🛡 Anti-ban pacing** — human-like jitter, batch cooling, exponential backoff on 429, auto circuit-breaker
- **💾 CSV backup** — one-click full backup before deletion
- **🔒 100% local** — no backend, no telemetry; credentials are only used to build deletion requests on your machine

## 📦 Install

1. Download this repo (unzip, or `git clone`)
2. Open `chrome://extensions` in Chrome
3. Enable **Developer mode** (top right)
4. Click **Load unpacked** and select the `extension/` folder
5. Log in to x.com — the toolbar icon **lights up** when the session is ready

> A userscript build (`userscript/sweepx.user.js`) is also available for Tampermonkey.

## 🚀 Usage

### Option A: Full archive cleanup (recommended for the big sweep)

1. On X: Settings → Your account → **Download an archive of your data** (takes hours to 24h+)
2. Open SweepX → the "Archive" tab → drop in the `.zip`
3. Pick categories and filters
4. **Run once with Dry-Run enabled** and verify the counts
5. Disable Dry-Run and execute for real (keep the page open; the engine auto-cools between batches)

### Option B: Live scan (best for recent data)

1. Open your x.com profile in the browser
2. For **posts/retweets** stay on the "Posts" tab; for **replies** switch to the "Replies" tab
3. Click "Scan current page" — scan depth is adjustable (default 8 scrolls ≈ 40-80 items)
4. Pick categories → delete

### Checkpoint & resume

Progress is saved automatically while a run is active. If the page closes unexpectedly,
reopening the extension shows "Unfinished task: X/Y processed" — click Resume to continue.

### queryId auto-learning

X rotates its internal API IDs. SweepX listens to the page's own delete requests and learns
the current parameters. **Before first use, manually delete any one tweet on x.com** (once is
enough; repeat after X redesigns).

## ❓ FAQ

<details>
<summary>Deletion fails with 403 / auth error?</summary>

Make sure you are logged in to x.com, then click "Refresh session" in the extension.
</details>

<details>
<summary>Deletion fails with 404?</summary>

The API parameters are stale (X redesigned). Manually delete one tweet on x.com so SweepX
re-learns the queryId, then retry.
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

- All parsing, filtering, and deletion requests happen **locally in your browser** — no third-party servers involved
- The `ct0` / `auth_token` cookies are read **solely** to build deletion requests locally; never stored or uploaded
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
