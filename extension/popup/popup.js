import {
  TweetCategory,
  parseArchiveContent,
  filterTweets
} from '../core/parser.js';

import {
  XDeletionClient
} from '../core/client.js';

import {
  DeletionEngine,
  EngineState
} from '../core/engine.js';

import {
  createCheckpoint,
  saveProgress,
  loadCheckpoint,
  clearCheckpoint
} from '../core/checkpoint.js';

// State
let rawTweets = [];
let matchedTweets = [];
let activeSession = null;
let client = null;
let engine = null;
let coolingTimerId = null;

let countSuccess = 0;
let countAlready = 0;
let countFailed = 0;

// DOM Elements
const sessionDot = document.getElementById('session-dot');
const sessionText = document.getElementById('session-text');
const openSidepanelBtn = document.getElementById('open-sidepanel-btn');
const openFullBtn = document.getElementById('open-full-btn');

const tabBtnZip = document.getElementById('tab-btn-zip');
const tabBtnLive = document.getElementById('tab-btn-live');
const tabBtnUnfollow = document.getElementById('tab-btn-unfollow');
const tabZip = document.getElementById('tab-zip');
const tabLive = document.getElementById('tab-live');
const tabUnfollow = document.getElementById('tab-unfollow');

const zipDropArea = document.getElementById('zip-drop-area');
const zipFileInput = document.getElementById('zip-file-input');
const fileLoadedStatus = document.getElementById('file-loaded-status');

const scanPageBtn = document.getElementById('scan-page-btn');
const liveScanStatus = document.getElementById('live-scan-status');
const scanTimesInput = document.getElementById('scan-times-input');

const catRt = document.getElementById('cat-rt');
const catReply = document.getElementById('cat-reply');
const catOrig = document.getElementById('cat-orig');
const catQuote = document.getElementById('cat-quote');

const countRt = document.getElementById('count-rt');
const countReply = document.getElementById('count-reply');
const countOrig = document.getElementById('count-orig');
const countQuote = document.getElementById('count-quote');

const filterBeforeDate = document.getElementById('filter-before-date');
const keepFavInput = document.getElementById('keep-fav-input');
const excludeKwInput = document.getElementById('exclude-kw-input');
const dryRunCheck = document.getElementById('dry-run-check');

const mainActionBtn = document.getElementById('main-action-btn');

const progressWrapper = document.getElementById('progress-wrapper');
const pStatus = document.getElementById('p-status');
const pPercent = document.getElementById('p-percent');
const pFill = document.getElementById('p-fill');
const pCur = document.getElementById('p-cur');
const pTot = document.getElementById('p-tot');
const pSucc = document.getElementById('p-succ');
const pAlready = document.getElementById('p-already');
const pFail = document.getElementById('p-fail');
const coolingBox = document.getElementById('cooling-box');
const coolingTime = document.getElementById('cooling-time');

const pauseRunBtn = document.getElementById('pause-run-btn');
const stopRunBtn = document.getElementById('stop-run-btn');
const exportCsvBtn = document.getElementById('export-csv-btn');
const miniLogBox = document.getElementById('mini-log-box');

const resumeBar = document.getElementById('resume-bar');
const resumeText = document.getElementById('resume-text');
const resumeBtn = document.getElementById('resume-btn');
const resumeDiscardBtn = document.getElementById('resume-discard-btn');

const loadFollowingBtn = document.getElementById('load-following-btn');
const followingStatus = document.getElementById('following-status');
const unfollowBtn = document.getElementById('unfollow-btn');

// Unfollow state
let followingUsers = [];
let unfollowMutation = null;
let unfollowRunning = false;

// Init
document.addEventListener('DOMContentLoaded', () => {
  bindEvents();
  restoreScanTimes();
  checkSession();
  checkResume();
});

function clampScanTimes(val) {
  const n = parseInt(val, 10);
  if (Number.isNaN(n)) return 8;
  return Math.max(1, Math.min(50, n));
}

function restoreScanTimes() {
  chrome.storage.local.get('scanTimes', ({ scanTimes }) => {
    if (scanTimes) scanTimesInput.value = scanTimes;
  });
}

// --- Resume unfinished run (checkpoint) ---
async function checkResume() {
  try {
    const cp = await loadCheckpoint();
    if (!cp) return;
    resumeText.textContent =
      `检测到未完成任务：已处理 ${cp.state.currentIndex}/${cp.queue.length} (${cp.state.dryRun ? 'Dry-Run' : '真实删除'})`;
    resumeBar.style.display = 'flex';
  } catch (e) { /* ignore */ }
}

async function handleDiscardCheckpoint() {
  await clearCheckpoint();
  resumeBar.style.display = 'none';
  log('已放弃未完成的清理任务。', 'warn');
}

function bindEvents() {
  // Tabs
  tabBtnZip.addEventListener('click', () => switchTab('zip'));
  tabBtnLive.addEventListener('click', () => switchTab('live'));
  tabBtnUnfollow.addEventListener('click', () => switchTab('unfollow'));

  // Header Actions
  openFullBtn.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'OPEN_DASHBOARD' });
  });

  openSidepanelBtn.addEventListener('click', async () => {
    if (chrome.sidePanel && chrome.sidePanel.open) {
      const window = await chrome.windows.getCurrent();
      await chrome.sidePanel.open({ windowId: window.id });
      window.close?.();
    } else {
      alert('当前浏览器版本暂不支持一键侧栏 API，请在全屏大屏或此弹窗中运行。');
    }
  });

  // Zip Drop & Select
  zipDropArea.addEventListener('click', () => zipFileInput.click());
  zipFileInput.addEventListener('change', (e) => {
    if (e.target.files && e.target.files[0]) handleIncomingFile(e.target.files[0]);
  });

  zipDropArea.addEventListener('dragover', (e) => {
    e.preventDefault();
    zipDropArea.classList.add('dragover');
  });

  zipDropArea.addEventListener('dragleave', () => {
    zipDropArea.classList.remove('dragover');
  });

  zipDropArea.addEventListener('drop', (e) => {
    e.preventDefault();
    zipDropArea.classList.remove('dragover');
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleIncomingFile(e.dataTransfer.files[0]);
    }
  });

  // Live Scan
  scanPageBtn.addEventListener('click', handleLiveScan);
  scanTimesInput.addEventListener('change', () => {
    // Persist scan depth across sessions
    chrome.storage.local.set({ scanTimes: clampScanTimes(scanTimesInput.value) });
  });

  // Filters
  [catRt, catReply, catOrig, catQuote, filterBeforeDate, keepFavInput, excludeKwInput].forEach(el => {
    el.addEventListener('input', applyFilters);
  });

  // Main Action
  mainActionBtn.addEventListener('click', handleStartExecution);

  // Progress Controls
  pauseRunBtn.addEventListener('click', handlePause);
  stopRunBtn.addEventListener('click', handleStop);
  exportCsvBtn.addEventListener('click', handleExportCsv);

  // Checkpoint Resume
  resumeBtn.addEventListener('click', handleResumeExecution);
  resumeDiscardBtn.addEventListener('click', handleDiscardCheckpoint);

  // Unfollow
  loadFollowingBtn.addEventListener('click', handleLoadFollowing);
  unfollowBtn.addEventListener('click', handleStartUnfollow);
}

function switchTab(mode) {
  const tabs = {
    zip: [tabBtnZip, tabZip],
    live: [tabBtnLive, tabLive],
    unfollow: [tabBtnUnfollow, tabUnfollow]
  };
  for (const [key, [btn, content]] of Object.entries(tabs)) {
    const active = key === mode;
    btn.classList.toggle('active', active);
    content.classList.toggle('active', active);
  }
}

// Session
function checkSession() {
  if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
    chrome.runtime.sendMessage({ type: 'GET_X_SESSION' }, (response) => {
      if (response && response.success && response.session) {
        activeSession = response.session;
        sessionDot.className = 'dot active';
        sessionText.textContent = '已连接 x.com 会话 (可正常删除)';
        client = new XDeletionClient({
          ct0: activeSession.ct0,
          authToken: activeSession.authToken
        });
      } else {
        sessionDot.className = 'dot error';
        sessionText.textContent = '未检测到 x.com 登录，请在浏览器先打开 x.com';
      }
    });
  }
}

// File Processing (Zip or JS)
async function handleIncomingFile(file) {
  fileLoadedStatus.textContent = `正在读取 ${file.name}...`;
  log(`正在解析文件: ${file.name}`, 'info');

  try {
    let tweetsJsContent = '';

    if (file.name.endsWith('.zip')) {
      if (typeof JSZip === 'undefined') {
        throw new Error('JSZip 依赖库未就绪');
      }
      fileLoadedStatus.textContent = `正在解压 ${file.name}...`;
      const zip = await JSZip.loadAsync(file);

      // Locate tweets.js
      let targetFile = zip.file('data/tweets.js');
      if (!targetFile) {
        // Find any file matching tweets
        const candidateKey = Object.keys(zip.files).find(
          k => k.toLowerCase().includes('tweet') && (k.endsWith('.js') || k.endsWith('.json'))
        );
        if (candidateKey) {
          targetFile = zip.file(candidateKey);
        }
      }

      if (!targetFile) {
        throw new Error('压缩包内未找到 data/tweets.js，请确认是推特官方数据包');
      }

      tweetsJsContent = await targetFile.async('string');
    } else {
      // Plain text .js or .json
      tweetsJsContent = await readFileAsText(file);
    }

    rawTweets = parseArchiveContent(tweetsJsContent);
    fileLoadedStatus.textContent = `成功加载 ${rawTweets.length} 条记录！`;
    log(`成功识别全量推文: 共 ${rawTweets.length} 条！`, 'success');

    updateCounts();
    applyFilters();
  } catch (err) {
    fileLoadedStatus.textContent = `加载失败: ${err.message}`;
    log(`解析失败: ${err.message}`, 'error');
  }
}

function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => resolve(e.target.result);
    reader.onerror = e => reject(e);
    reader.readAsText(file);
  });
}

// Live Timeline Scan
function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function waitForTabComplete(tabId, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const tab = await chrome.tabs.get(tabId);
      if (tab.status === 'complete') return;
    } catch (e) { /* tab may be gone */ }
    await sleep(300);
  }
}

async function handleLiveScan() {
  scanPageBtn.disabled = true;
  scanPageBtn.textContent = '⏳ 正在滚动扫描中...';
  liveScanStatus.textContent = '正在准备扫描...';

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || (!tab.url.includes('x.com') && !tab.url.includes('twitter.com'))) {
      throw new Error('请先在浏览器当前标签页打开 x.com 个人主页');
    }

    // Reload the page so content scripts install at document_start and the
    // page's initial timeline fetches are captured — this removes any
    // dependency on the user reloading the extension/page in the right order
    liveScanStatus.textContent = '正在刷新页面以获取精确数据...';
    await chrome.tabs.reload(tab.id);
    await waitForTabComplete(tab.id);
    await sleep(1200); // let the initial timeline fetches fire

    let response;
    const scrollTimes = clampScanTimes(scanTimesInput.value);

    // Ensure the MAIN-world sniffer is present (needed for exact API data).
    // Idempotent: the script self-guards against double installation.
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['content/queryid-sniffer.js'],
        world: 'MAIN'
      });
    } catch (e) { /* DOM fallback still works without it */ }

    try {
      response = await chrome.tabs.sendMessage(tab.id, { type: 'SCAN_TIMELINE', scrollTimes });
    } catch (err) {
      // Tabs opened before the extension was installed/reloaded have no content script.
      // Inject it on demand (activeTab grants this after clicking the extension), then retry.
      if (!/Receiving end|message port/i.test(err.message)) throw err;
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['content/scanner.js']
      });
      response = await chrome.tabs.sendMessage(tab.id, { type: 'SCAN_TIMELINE', scrollTimes });
    }

    if (response && response.success && response.tweets) {
      if (response.warning) {
        log(`[警告] ${response.warning}`, 'warn');
      }
      // Normalize: sendMessage serializes Date -> ISO string, and live items
      // have no engagement counts. Keep shapes identical to archive-parsed data.
      const fresh = response.tweets.map(t => ({
        ...t,
        createdAt: t.createdAt instanceof Date ? t.createdAt : new Date(t.createdAt),
        favoriteCount: t.favoriteCount ?? null,
        retweetCount: t.retweetCount ?? null
      }));
      // Merge with previous scans (Posts tab + Replies tab runs accumulate);
      // fresh data wins on ID conflicts
      const merged = new Map(rawTweets.map(t => [t.id, t]));
      for (const t of fresh) merged.set(t.id, t);
      rawTweets = Array.from(merged.values());

      const scopeText = response.scope === 'replies' ? '回复页' : '帖子页';
      liveScanStatus.textContent =
        `扫描完成 (${scopeText})：本次 ${fresh.length} 条，累计 ${rawTweets.length} 条。可切换另一标签页继续扫描。`;
      log(`在线扫描到 ${fresh.length} 条推文 (${scopeText})，累计 ${rawTweets.length} 条。`, 'success');
      log(`数据来源: ${response.mode === 'api' ? '接口精确数据 ✓（分类/计数准确）' : '页面解析兜底 — 请刷新 x.com 页面后重扫以获得精确数据'}`,
        response.mode === 'api' ? 'info' : 'warn');
      if (response.stats) {
        const s = response.stats;
        log(`[诊断] 可解析推文 ${s.articles} | 本人/转推 ${s.owned} | 判定为回复 ${s.replyLike} | 保留 ${s.kept}`, 'info');
      }
      if (response.sniff) {
        const sf = response.sniff;
        log(`[嗅探诊断] 接口模式数据 ${response.apiMapSize} 条 | 时间线响应 ${sf.timelineResponses} 次 | 解析推文 ${sf.tweetsExtracted} 条 | 看到的接口: ${sf.graphqlOps.join(', ') || '无'}`, 'info');
      } else {
        log(`[嗅探诊断] 嗅探器未捕获任何接口响应 (已自动刷新页面)，接口模式数据 ${response.apiMapSize} 条`, 'warn');
      }
      updateCounts();
      applyFilters();
    } else {
      throw new Error('扫描结果为空，请确保页面已滚动并处于个人主页');
    }
  } catch (err) {
    liveScanStatus.textContent = `扫描失败: ${err.message}`;
    log(`扫描异常: ${err.message}`, 'error');
  } finally {
    scanPageBtn.disabled = false;
    scanPageBtn.textContent = '🔍 自动扫描当前页面推文';
  }
}

// Counts & Filters
function updateCounts() {
  let rt = 0, reply = 0, orig = 0, quote = 0;
  for (const t of rawTweets) {
    if (t.category === TweetCategory.RETWEET) rt++;
    else if (t.category === TweetCategory.REPLY) reply++;
    else if (t.category === TweetCategory.ORIGINAL) orig++;
    else if (t.category === TweetCategory.QUOTE) quote++;
  }

  countRt.textContent = rt.toLocaleString();
  countReply.textContent = reply.toLocaleString();
  countOrig.textContent = orig.toLocaleString();
  countQuote.textContent = quote.toLocaleString();
}

function applyFilters() {
  if (rawTweets.length === 0) {
    mainActionBtn.disabled = true;
    mainActionBtn.textContent = '🚀 开始删除选中的 0 项';
    return;
  }

  const categories = [];
  if (catRt.checked) categories.push(TweetCategory.RETWEET);
  if (catReply.checked) categories.push(TweetCategory.REPLY);
  if (catOrig.checked) categories.push(TweetCategory.ORIGINAL);
  if (catQuote.checked) categories.push(TweetCategory.QUOTE);

  const excludeKw = excludeKwInput.value
    ? excludeKwInput.value.split(',').map(s => s.trim()).filter(Boolean)
    : [];

  const keepFav = keepFavInput.value !== '' ? parseInt(keepFavInput.value, 10) : null;
  const endDate = filterBeforeDate.value ? new Date(filterBeforeDate.value) : null;

  matchedTweets = filterTweets(rawTweets, {
    categories,
    endDate,
    keepIfFavoriteGte: keepFav,
    excludeKeywords: excludeKw
  });

  const count = matchedTweets.length;
  mainActionBtn.textContent = `🚀 开始删除选中的 ${count.toLocaleString()} 项`;
  mainActionBtn.disabled = count === 0;
}

// Start Deletion Execution
async function handleStartExecution() {
  if (matchedTweets.length === 0) return;

  const isDryRun = dryRunCheck.checked;
  if (!isDryRun && !activeSession) {
    alert('未检测到有效的 x.com 登录凭据，请确保已在浏览器中登录 x.com！');
    return;
  }

  const confirmMsg = isDryRun
    ? `即将启动【模拟测试 (Dry-Run)】，模拟执行 ${matchedTweets.length} 项。是否继续？`
    : `【高能警示】确定要永久删除 ${matchedTweets.length} 项选中的推文/转推/回复吗？\n\n此操作完全不可逆！`;

  if (!confirm(confirmMsg)) return;

  await ensureClientReady();

  // Persist checkpoint so the run survives tab/browser close (resume later)
  await createCheckpoint(matchedTweets, { dryRun: isDryRun });
  resumeBar.style.display = 'none';

  // Reset Metrics
  countSuccess = 0;
  countAlready = 0;
  countFailed = 0;
  updateProgressDisplay(0, matchedTweets.length);

  progressWrapper.style.display = 'block';
  mainActionBtn.disabled = true;

  engine = buildEngine(isDryRun);
  engine.setQueue(matchedTweets);
  log(`开始执行清理任务 (共 ${matchedTweets.length} 项)...`, 'info');
  await engine.start();
}

/** Ensures the API client exists and applies page-captured queryIds. */
async function ensureClientReady() {
  if (!client) {
    client = new XDeletionClient({
      ct0: activeSession?.ct0,
      authToken: activeSession?.authToken
    });
  }

  // Follow X's live queryId rotations captured from the page (queryid-sniffer.js).
  // Capturing requires the user to have manually deleted one tweet on x.com
  // with the extension active; the learned IDs then persist in local storage.
  const captured = {};
  try {
    const stored = await chrome.storage.local.get(['queryId_DeleteTweet', 'queryId_DeleteRetweet']);
    if (stored.queryId_DeleteTweet) captured.DeleteTweet = stored.queryId_DeleteTweet;
    if (stored.queryId_DeleteRetweet) captured.DeleteRetweet = stored.queryId_DeleteRetweet;
  } catch (e) { /* fall back to defaults */ }
  if (Object.keys(captured).length > 0) {
    client.setQueryIds(captured);
    log('已自动学习页面最新接口参数 (queryId)，自动适配 X 改版。', 'info');
  } else {
    log('未捕获到页面接口参数，使用内置默认值。若删除报 404，请先在 x.com 上手动删除一条推文，扩展会自动学习最新参数。', 'warn');
  }
}

/** Persists the queryIds just used successfully, so future runs use them. */
function persistQueryIds() {
  if (!client) return;
  try {
    chrome.storage.local.set({
      queryId_DeleteTweet: client.queryIds.DeleteTweet,
      queryId_DeleteRetweet: client.queryIds.DeleteRetweet
    });
  } catch (e) { /* ignore */ }
}

// --- Unfollow tool (learning-based replay) ---

async function handleLoadFollowing() {
  loadFollowingBtn.disabled = true;
  loadFollowingBtn.textContent = '⏳ 读取中...';
  followingStatus.textContent = '正在从页面缓冲区读取...';

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || (!tab.url.includes('x.com') && !tab.url.includes('twitter.com'))) {
      throw new Error('请先打开 x.com 的「关注」列表页再读取');
    }

    let resp;
    try {
      resp = await chrome.tabs.sendMessage(tab.id, { type: 'SCAN_FOLLOWING' });
    } catch (err) {
      if (!/Receiving end|message port/i.test(err.message)) throw err;
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['content/scanner.js']
      });
      resp = await chrome.tabs.sendMessage(tab.id, { type: 'SCAN_FOLLOWING' });
    }

    followingUsers = (resp && resp.users) || [];
    unfollowMutation = (resp && resp.followMutation) || null;

    if (followingUsers.length === 0) {
      followingStatus.textContent = '未捕获到关注列表。请打开「关注」列表页并刷新页面后重试。';
    } else if (!unfollowMutation) {
      followingStatus.textContent =
        `已捕获 ${followingUsers.length} 个关注，但取关接口未学习——请先手动取关 1 人，再点「读取」。`;
    } else {
      followingStatus.textContent =
        `已捕获 ${followingUsers.length} 个关注，取关接口已学习 ✓（演示接口: ${unfollowMutation.opName}）`;
    }
    unfollowBtn.disabled = !(followingUsers.length > 0 && unfollowMutation);
    unfollowBtn.textContent = `🚫 开始取关 ${followingUsers.length} 人`;
  } catch (err) {
    followingStatus.textContent = `读取失败: ${err.message}`;
    log(`取关读取异常: ${err.message}`, 'error');
  } finally {
    loadFollowingBtn.disabled = false;
    loadFollowingBtn.textContent = '📋 读取已捕获的关注列表';
  }
}

async function handleStartUnfollow() {
  if (unfollowRunning || followingUsers.length === 0 || !unfollowMutation) return;
  if (!activeSession) {
    alert('未检测到 x.com 登录，无法取关！');
    return;
  }

  const confirmMsg = `确定要取消关注 ${followingUsers.length} 人吗？\n\n每次间隔约 3-6 秒，中途可随时关闭弹窗停止。`;
  if (!confirm(confirmMsg)) return;

  if (!client) {
    client = new XDeletionClient({
      ct0: activeSession?.ct0,
      authToken: activeSession?.authToken
    });
  }

  // Locate the target-id field in the learned template (no guessed names:
  // whatever user-id field the page used, we swap exactly that one)
  let parsedBody;
  let idField = null;
  let oldValue = null;
  try {
    parsedBody = JSON.parse(unfollowMutation.bodyText);
    for (const [k, v] of Object.entries(parsedBody.variables || {})) {
      if (typeof v === 'string' && /^\d{6,}$/.test(v)) {
        idField = k;
        oldValue = v;
        break;
      }
    }
  } catch (e) { /* handled below */ }
  if (!idField) {
    alert('未能从学习的请求中识别目标用户字段，取关终止。');
    return;
  }

  unfollowRunning = true;
  unfollowBtn.disabled = true;
  let ok = 0;
  let fail = 0;

  for (const u of followingUsers) {
    try {
      const body = JSON.stringify({
        ...parsedBody,
        variables: { ...parsedBody.variables, [idField]: u.id }
      });
      const res = await fetch(unfollowMutation.url, {
        method: 'POST',
        credentials: 'include',
        headers: client.getHeaders(),
        body
      });
      if (res.ok) {
        ok++;
        log(`[取关] 已取消关注 @${u.name}`, 'success');
      } else if (res.status === 429) {
        log('[取关] 触发频率限制，停止本次任务。稍后再来。', 'error');
        break;
      } else {
        fail++;
        log(`[取关] @${u.name} 失败 (HTTP ${res.status})`, 'error');
      }
    } catch (err) {
      fail++;
      log(`[取关] @${u.name} 异常: ${err.message}`, 'error');
    }

    unfollowBtn.textContent = `🚫 取关中 ${ok + fail}/${followingUsers.length}`;
    await sleep(3000 + Math.random() * 3000);
  }

  unfollowRunning = false;
  unfollowBtn.disabled = false;
  unfollowBtn.textContent = `🚫 开始取关 ${followingUsers.length - ok} 人`;
  followingUsers = followingUsers.slice(ok); // keep only unprocessed ones
  log(`取关完成: 成功 ${ok}，失败 ${fail}。${fail > 0 ? '失败项可重新读取后再试。' : ''}`, fail > 0 ? 'warn' : 'success');
}

/** Builds the deletion engine with the shared UI wiring. */
function buildEngine(dryRun) {
  return new DeletionEngine({
    client,
    dryRun,
    minDelayMs: 2000,
    maxDelayMs: 4000,
    batchSize: 60,
    batchCoolingMs: 15 * 60 * 1000,
    onProgress: (p) => {
      updateProgressDisplay(p.current, p.total);
      if (p.result.status === 'success' || p.result.status === 'success_dry_run') {
        countSuccess++;
        log(`[成功] 删除 ${p.item.category} ID: ${p.item.id}`, 'success');
      } else if (p.result.status === 'already_deleted') {
        countAlready++;
        log(`[跳过] ID ${p.item.id} 之前已被删除`, 'warn');
      } else {
        countFailed++;
        log(`[失败] ID ${p.item.id}: ${p.result.message || '未知错误'}`, 'error');
      }
      pSucc.textContent = countSuccess;
      pAlready.textContent = countAlready;
      pFail.textContent = countFailed;
      if (p.result.status === 'success') {
        // Bootstrap queryId learning: SweepX's own requests are invisible to the
        // page sniffer, so persist the IDs we just used successfully
        persistQueryIds();
      }
      // Auto-remove completed items from the working set (real runs only —
      // dry-run must leave the list intact for the real run afterwards)
      if (p.result.status === 'success' || p.result.status === 'already_deleted') {
        rawTweets = rawTweets.filter(t => t.id !== p.item.id);
        updateCounts();
        applyFilters();
      }
      saveProgress(p.current, {
        success: countSuccess,
        already: countAlready,
        failed: countFailed
      }).catch(() => {});
    },
    onStateChange: (s) => {
      pStatus.textContent = s.message || s.state;
      if (s.state === EngineState.RUNNING) {
        pauseRunBtn.textContent = '⏸ 暂停';
        pauseRunBtn.disabled = false;
        stopRunBtn.disabled = false;
      } else if (s.state === EngineState.PAUSED) {
        pauseRunBtn.textContent = '▶ 继续';
      } else if (s.state === EngineState.IDLE || s.state === EngineState.STOPPED) {
        mainActionBtn.disabled = false;
        pauseRunBtn.disabled = true;
        stopRunBtn.disabled = true;
        hideCoolingBox();
        if (s.state === EngineState.IDLE) {
          // Run completed — checkpoint no longer needed
          clearCheckpoint().catch(() => {});
          log('任务完成。x.com 页面不会自动刷新，请刷新页面确认删除结果。', 'info');
        }
      }
    },
    onError: (e) => {
      log(`[异常] ${e.error.message}`, 'error');
    },
    onBatchCooling: (c) => {
      showCoolingBox(c.durationMs);
    }
  });
}

/** Resumes an interrupted run from the persisted checkpoint. */
async function handleResumeExecution() {
  const cp = await loadCheckpoint();
  if (!cp) {
    resumeBar.style.display = 'none';
    return;
  }

  const remaining = cp.queue.length - cp.state.currentIndex;
  const confirmResume = confirm(
    `检测到未完成的清理任务：已处理 ${cp.state.currentIndex}/${cp.queue.length}，剩余 ${remaining} 项 (${cp.state.dryRun ? 'Dry-Run' : '真实删除'})。\n\n是否从上次中断处继续？`
  );
  if (!confirmResume) return;

  if (!cp.state.dryRun && !activeSession) {
    alert('未检测到有效的 x.com 登录凭据，无法继续真实删除！');
    return;
  }

  matchedTweets = cp.queue;
  dryRunCheck.checked = cp.state.dryRun;
  await ensureClientReady();

  // Restore metrics from checkpoint
  countSuccess = cp.state.success;
  countAlready = cp.state.already;
  countFailed = cp.state.failed;

  progressWrapper.style.display = 'block';
  mainActionBtn.disabled = true;
  resumeBar.style.display = 'none';

  engine = buildEngine(cp.state.dryRun);
  engine.setQueue(matchedTweets);
  engine.currentIndex = cp.state.currentIndex;
  updateProgressDisplay(cp.state.currentIndex, matchedTweets.length);
  pSucc.textContent = countSuccess;
  pAlready.textContent = countAlready;
  pFail.textContent = countFailed;

  log(`已恢复上次任务：从第 ${cp.state.currentIndex + 1} 项继续 (剩余 ${remaining} 项)。`, 'info');
  await engine.start();
}

function handlePause() {
  if (!engine) return;
  if (engine.state === EngineState.RUNNING) {
    engine.pause();
    log('已暂停清理。', 'warn');
  } else if (engine.state === EngineState.PAUSED) {
    engine.resume();
    log('继续清理...', 'info');
  }
}

function handleStop() {
  if (engine) {
    engine.stop();
    log('用户已中止清理。', 'error');
    hideCoolingBox();
  }
}

function updateProgressDisplay(cur, tot) {
  pCur.textContent = cur;
  pTot.textContent = tot;
  const pct = tot > 0 ? ((cur / tot) * 100).toFixed(1) : 0;
  pPercent.textContent = `${pct}%`;
  pFill.style.width = `${pct}%`;
}

function showCoolingBox(durationMs) {
  coolingBox.style.display = 'block';
  let remainingSec = Math.round(durationMs / 1000);
  if (coolingTimerId) clearInterval(coolingTimerId);

  coolingTimerId = setInterval(() => {
    remainingSec--;
    if (remainingSec <= 0) {
      clearInterval(coolingTimerId);
      hideCoolingBox();
    } else {
      const m = Math.floor(remainingSec / 60);
      const s = remainingSec % 60;
      coolingTime.textContent = `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    }
  }, 1000);
}

function hideCoolingBox() {
  if (coolingTimerId) clearInterval(coolingTimerId);
  coolingBox.style.display = 'none';
}

function handleExportCsv() {
  if (matchedTweets.length === 0) return;
  const headers = ['id', 'category', 'createdAt', 'sourceTweetId', 'text'];
  const rows = matchedTweets.map(t => [
    t.id,
    t.category,
    t.createdAt instanceof Date ? t.createdAt.toISOString() : (t.createdAt || ''),
    t.sourceTweetId || '',
    `"${(t.text || '').replace(/"/g, '""')}"`
  ]);
  const csvContent = '\uFEFF' + [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `SweepX_backup_${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  log('已成功导出备份 CSV！', 'success');
}

function log(msg, type = 'info') {
  const line = document.createElement('div');
  line.className = `log-line ${type}`;
  line.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
  miniLogBox.appendChild(line);
  miniLogBox.scrollTop = miniLogBox.scrollHeight;
}
