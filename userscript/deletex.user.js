// ==UserScript==
// @name         deleteX - 批量删除 X 发帖/转推/引用/回复
// @namespace    https://github.com/deleteX/deleteX
// @version      1.0.0
// @description  免费且保护隐私的 X (Twitter) 历史推文、转推、引用与回复批量清理工具 (Tampermonkey 版本)
// @author       Antigravity
// @match        https://x.com/*
// @match        https://twitter.com/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  // Constants
  const DEFAULT_BEARER_TOKEN =
    'Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA';
  const DEFAULT_QUERY_IDS = {
    DeleteTweet: 'VaenaVgh5q5ih7kvyVjgtg',
    DeleteRetweet: 'iQtK4dl5hBmXewYZuEOKVw'
  };

  // Helper: Get ct0 cookie
  function getCt0() {
    const match = document.cookie.match(/(^|;\s*)ct0=([^;]+)/);
    return match ? match[2] : '';
  }

  // Floating Trigger Button
  function createTriggerButton() {
    if (document.getElementById('deletex-trigger-btn')) return;

    const btn = document.createElement('button');
    btn.id = 'deletex-trigger-btn';
    btn.innerHTML = '🧹 deleteX';
    btn.style.cssText = `
      position: fixed;
      bottom: 24px;
      right: 24px;
      z-index: 999999;
      background: linear-gradient(135deg, #1d9bf0, #00ba7c);
      color: #fff;
      font-weight: 700;
      font-size: 14px;
      padding: 10px 18px;
      border: none;
      border-radius: 9999px;
      box-shadow: 0 4px 14px rgba(0,0,0,0.4);
      cursor: pointer;
      transition: transform 0.2s;
    `;
    btn.onmouseover = () => btn.style.transform = 'scale(1.05)';
    btn.onmouseout = () => btn.style.transform = 'scale(1)';
    btn.onclick = toggleModal;
    document.body.appendChild(btn);
  }

  // Floating Modal
  function createModal() {
    if (document.getElementById('deletex-modal')) return;

    const modal = document.createElement('div');
    modal.id = 'deletex-modal';
    modal.style.cssText = `
      display: none;
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      width: 580px;
      max-width: 90vw;
      max-height: 85vh;
      background: #151921;
      color: #e6edf3;
      border: 1px solid #30363d;
      border-radius: 14px;
      box-shadow: 0 10px 30px rgba(0,0,0,0.6);
      z-index: 1000000;
      padding: 24px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      overflow-y: auto;
    `;

    modal.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #30363d; padding-bottom: 12px; margin-bottom: 16px;">
        <h2 style="font-size: 18px; font-weight: 800; margin: 0; color: #1d9bf0;">deleteX 批量清理工具</h2>
        <button id="deletex-close-btn" style="background: none; border: none; color: #8b949e; font-size: 20px; cursor: pointer;">✕</button>
      </div>

      <div style="font-size: 13px; color: #8b949e; margin-bottom: 16px;">
        100% 运行在当前浏览器登录态内，免费批量清理发帖、转推、引用与回复。
      </div>

      <!-- File Input -->
      <div style="background: #0d1117; border: 2px dashed #30363d; border-radius: 8px; padding: 20px; text-align: center; margin-bottom: 16px; cursor: pointer;" id="deletex-drop-area">
        <div style="font-size: 14px; font-weight: 600;">📁 选择或拖拽 tweets.js 归档文件</div>
        <div style="font-size: 12px; color: #8b949e; margin-top: 4px;">来自 X 官方数据包 (data/tweets.js)</div>
        <input type="file" id="deletex-file" accept=".js,.json" style="display: none;">
      </div>
      <div id="deletex-file-stat" style="font-size: 12px; color: #00ba7c; margin-bottom: 14px;">未加载数据</div>

      <!-- Categories Filter -->
      <div style="margin-bottom: 16px; font-size: 13px;">
        <div style="font-weight: 600; margin-bottom: 8px;">清理目标类型:</div>
        <label style="margin-right: 12px;"><input type="checkbox" id="del-orig" checked> 原创发帖</label>
        <label style="margin-right: 12px;"><input type="checkbox" id="del-rt" checked> 转发/转推</label>
        <label style="margin-right: 12px;"><input type="checkbox" id="del-quote" checked> 引用</label>
        <label><input type="checkbox" id="del-reply" checked> 回复</label>
      </div>

      <!-- Controls -->
      <div style="display: flex; gap: 10px; margin-bottom: 16px;">
        <button id="deletex-start" style="flex: 1; padding: 10px; background: #1d9bf0; color: #fff; font-weight: 700; border: none; border-radius: 6px; cursor: pointer;" disabled>开始清理</button>
        <button id="deletex-stop" style="padding: 10px 16px; background: #21262d; color: #f4212e; font-weight: 700; border: 1px solid #30363d; border-radius: 6px; cursor: pointer;" disabled>终止</button>
      </div>

      <!-- Progress -->
      <div style="background: #0d1117; padding: 12px; border-radius: 6px; font-size: 12px; margin-bottom: 12px;">
        <div style="display: flex; justify-content: space-between; margin-bottom: 6px;">
          <span id="deletex-status">等待导入数据</span>
          <span id="deletex-pct">0%</span>
        </div>
        <div style="height: 6px; background: #21262d; border-radius: 4px; overflow: hidden;">
          <div id="deletex-bar" style="width: 0%; height: 100%; background: #00ba7c; transition: width 0.2s;"></div>
        </div>
      </div>

      <!-- Console Logs -->
      <div id="deletex-logs" style="background: #090c10; border: 1px solid #30363d; border-radius: 6px; height: 120px; overflow-y: auto; padding: 8px; font-family: monospace; font-size: 11px; color: #8b949e;"></div>
    `;

    document.body.appendChild(modal);

    // Bindings inside modal
    document.getElementById('deletex-close-btn').onclick = toggleModal;
    const dropArea = document.getElementById('deletex-drop-area');
    const fileEl = document.getElementById('deletex-file');
    dropArea.onclick = () => fileEl.click();
    fileEl.onchange = (e) => {
      if (e.target.files && e.target.files[0]) handleUserFile(e.target.files[0]);
    };

    document.getElementById('deletex-start').onclick = startDeletionProcess;
    document.getElementById('deletex-stop').onclick = stopDeletionProcess;
  }

  function toggleModal() {
    createModal();
    const modal = document.getElementById('deletex-modal');
    modal.style.display = modal.style.display === 'none' ? 'block' : 'none';
  }

  let parsedList = [];
  let isRunning = false;

  function handleUserFile(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        let text = e.target.result.trim();
        text = text.replace(/^window\.YTD\.tweets\.part\d+\s*=\s*/, '').replace(/;$/, '');
        const raw = JSON.parse(text);

        parsedList = raw.map(item => {
          const t = item.tweet || item;
          const id = String(t.id_str || t.id);
          const fullText = t.full_text || t.text || '';
          let cat = 'original';
          let sourceTweetId = null;

          if (fullText.startsWith('RT @') || t.retweeted_status_id_str) {
            cat = 'retweet';
            sourceTweetId = t.retweeted_status_id_str || id;
          } else if (t.in_reply_to_status_id_str) {
            cat = 'reply';
          } else if (t.quoted_status_id_str) {
            cat = 'quote';
          }

          return { id, cat, sourceTweetId, text: fullText };
        });

        document.getElementById('deletex-file-stat').textContent = `成功加载 ${parsedList.length} 条记录！`;
        document.getElementById('deletex-start').disabled = false;
        log(`已解析 ${parsedList.length} 条历史推文。`);
      } catch (err) {
        alert('解析失败: ' + err.message);
      }
    };
    reader.readAsText(file);
  }

  async function startDeletionProcess() {
    const ct0 = getCt0();
    if (!ct0) {
      alert('未检测到 ct0 Cookie，请确保已登录 x.com 且处于有效页面！');
      return;
    }

    const delOrig = document.getElementById('del-orig').checked;
    const delRt = document.getElementById('del-rt').checked;
    const delQuote = document.getElementById('del-quote').checked;
    const delReply = document.getElementById('del-reply').checked;

    const targets = parsedList.filter(item => {
      if (item.cat === 'original' && !delOrig) return false;
      if (item.cat === 'retweet' && !delRt) return false;
      if (item.cat === 'quote' && !delQuote) return false;
      if (item.cat === 'reply' && !delReply) return false;
      return true;
    });

    if (targets.length === 0) {
      alert('没有符合筛选条件的待清理项！');
      return;
    }

    if (!confirm(`确定要永久删除 ${targets.length} 条推文吗？此操作不可逆！`)) return;

    isRunning = true;
    document.getElementById('deletex-start').disabled = true;
    document.getElementById('deletex-stop').disabled = false;

    let index = 0;
    for (const item of targets) {
      if (!isRunning) break;

      try {
        const queryId = item.cat === 'retweet' ? DEFAULT_QUERY_IDS.DeleteRetweet : DEFAULT_QUERY_IDS.DeleteTweet;
        const opName = item.cat === 'retweet' ? 'DeleteRetweet' : 'DeleteTweet';
        const url = `https://x.com/i/api/graphql/${queryId}/${opName}`;
        const body = item.cat === 'retweet'
          ? { variables: { source_tweet_id: item.sourceTweetId || item.id }, queryId }
          : { variables: { tweet_id: item.id, dark_request: false }, queryId };

        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'authorization': DEFAULT_BEARER_TOKEN,
            'x-csrf-token': ct0,
            'x-twitter-active-user': 'yes',
            'x-twitter-auth-type': 'OAuth2Session',
            'content-type': 'application/json'
          },
          body: JSON.stringify(body)
        });

        if (res.status === 200) {
          log(`[成功] 删除 ${item.cat} ID: ${item.id}`);
        } else if (res.status === 429) {
          log(`[限流 429] 触发频率限制，暂停 15 分钟...`);
          await sleep(15 * 60 * 1000);
        } else {
          log(`[状态 ${res.status}] ID: ${item.id}`);
        }
      } catch (err) {
        log(`[错误] ${err.message}`);
      }

      index++;
      const pct = ((index / targets.length) * 100).toFixed(1);
      document.getElementById('deletex-bar').style.width = pct + '%';
      document.getElementById('deletex-pct').textContent = pct + '%';
      document.getElementById('deletex-status').textContent = `正在清理: ${index} / ${targets.length}`;

      // Jitter delay 2.5s ~ 4s
      await sleep(2500 + Math.random() * 1500);
    }

    isRunning = false;
    document.getElementById('deletex-start').disabled = false;
    document.getElementById('deletex-stop').disabled = true;
    document.getElementById('deletex-status').textContent = '清理完成！';
    log('所有任务处理完毕。');
  }

  function stopDeletionProcess() {
    isRunning = false;
    document.getElementById('deletex-start').disabled = false;
    document.getElementById('deletex-stop').disabled = true;
    log('用户已中止清理任务。');
  }

  function log(msg) {
    const el = document.getElementById('deletex-logs');
    if (!el) return;
    const d = document.createElement('div');
    d.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
    el.appendChild(d);
    el.scrollTop = el.scrollHeight;
  }

  function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
  }

  // Init button after page load
  setTimeout(createTriggerButton, 2000);
})();
