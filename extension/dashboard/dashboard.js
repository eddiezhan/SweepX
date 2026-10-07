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

// Application State
let rawTweets = [];
let matchedTweets = [];
let activeSession = null;
let client = null;
let engine = null;
let coolingTimerId = null;

// Metrics
let countSuccess = 0;
let countAlready = 0;
let countFailed = 0;

// DOM Elements
const sessionDot = document.getElementById('session-dot');
const sessionText = document.getElementById('session-text');
const refreshSessionBtn = document.getElementById('refresh-session-btn');

const statTotal = document.getElementById('stat-total');
const statMatched = document.getElementById('stat-matched');
const statOriginal = document.getElementById('stat-original');
const statRetweet = document.getElementById('stat-retweet');
const statQuote = document.getElementById('stat-quote');
const statReply = document.getElementById('stat-reply');

const dropZone = document.getElementById('drop-zone');
const fileInput = document.getElementById('file-input');
const fileInfo = document.getElementById('file-info');

const filterOriginal = document.getElementById('filter-original');
const filterRetweet = document.getElementById('filter-retweet');
const filterQuote = document.getElementById('filter-quote');
const filterReply = document.getElementById('filter-reply');
const filterStartDate = document.getElementById('filter-start-date');
const filterEndDate = document.getElementById('filter-end-date');
const keepFavInput = document.getElementById('keep-fav-input');
const keepRtInput = document.getElementById('keep-rt-input');
const excludeKeywordsInput = document.getElementById('exclude-keywords-input');
const dryRunToggle = document.getElementById('dry-run-toggle');

const startBtn = document.getElementById('start-btn');
const pauseBtn = document.getElementById('pause-btn');
const stopBtn = document.getElementById('stop-btn');
const exportBtn = document.getElementById('export-btn');

const progressBarFill = document.getElementById('progress-bar-fill');
const progressStatusText = document.getElementById('progress-status-text');
const progressPercentText = document.getElementById('progress-percent-text');
const metricCurrent = document.getElementById('metric-current');
const metricTotal = document.getElementById('metric-total');
const metricSuccess = document.getElementById('metric-success');
const metricAlready = document.getElementById('metric-already');
const metricFailed = document.getElementById('metric-failed');

const coolingBanner = document.getElementById('cooling-banner');
const coolingCountdown = document.getElementById('cooling-countdown');
const logConsole = document.getElementById('log-console');
const clearLogBtn = document.getElementById('clear-log-btn');

const previewCountLabel = document.getElementById('preview-count-label');
const previewTbody = document.getElementById('preview-tbody');

const resumeBar = document.getElementById('resume-bar');
const resumeText = document.getElementById('resume-text');
const resumeBtn = document.getElementById('resume-btn');
const resumeDiscardBtn = document.getElementById('resume-discard-btn');

// Dashboard tabs & live features
const dashTabBtnArchive = document.getElementById('dash-tab-btn-archive');
const dashTabBtnLive = document.getElementById('dash-tab-btn-live');
const dashTabBtnUnfollow = document.getElementById('dash-tab-btn-unfollow');
const dashTabArchive = document.getElementById('dash-tab-archive');
const dashTabLive = document.getElementById('dash-tab-live');
const dashTabUnfollow = document.getElementById('dash-tab-unfollow');
const dashScanBtn = document.getElementById('dash-scan-btn');
const dashScanDepth = document.getElementById('dash-scan-depth');
const dashScanStatus = document.getElementById('dash-scan-status');
const dashLoadFollowingBtn = document.getElementById('dash-load-following-btn');
const dashUnfollowBtn = document.getElementById('dash-unfollow-btn');
const dashFollowingStatus = document.getElementById('dash-following-status');
const dashFollowingList = document.getElementById('dash-following-list');
const dashFollowingItems = document.getElementById('dash-following-items');
const dashFollowingCheckAll = document.getElementById('dash-following-check-all');
const dashFollowingSelectedCount = document.getElementById('dash-following-selected-count');

// Unfollow state (dashboard)
let dashFollowingUsers = [];
let dashUnfollowMutation = null;
let dashUnfollowRunning = false;
let dashFollowMutationCandidates = [];

// --- Initialization ---
init();

function init() {
  bindEvents();
  checkSession();
  checkResume();
}

function bindEvents() {
  refreshSessionBtn.addEventListener('click', checkSession);

  // File Upload
  dropZone.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', handleFileSelect);

  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('dragover');
  });

  dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('dragover');
  });

  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      processFile(e.dataTransfer.files[0]);
    }
  });

  // Filter Changes
  const filterInputs = [
    filterOriginal, filterRetweet, filterQuote, filterReply,
    filterStartDate, filterEndDate, keepFavInput, keepRtInput,
    excludeKeywordsInput
  ];
  filterInputs.forEach(el => el.addEventListener('input', applyFilters));

  // Quick Preset Buttons
  document.querySelectorAll('.preset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const preset = btn.dataset.preset;
      const now = new Date();
      if (preset === 'all') {
        filterStartDate.value = '';
        filterEndDate.value = '';
      } else if (preset === '1y') {
        const d = new Date(now.setFullYear(now.getFullYear() - 1));
        filterEndDate.value = d.toISOString().split('T')[0];
        filterStartDate.value = '';
      } else if (preset === '2y') {
        const d = new Date(now.setFullYear(now.getFullYear() - 2));
        filterEndDate.value = d.toISOString().split('T')[0];
        filterStartDate.value = '';
      }
      applyFilters();
    });
  });

  // Engine Actions
  startBtn.addEventListener('click', handleStart);
  pauseBtn.addEventListener('click', handlePause);
  stopBtn.addEventListener('click', handleStop);
  exportBtn.addEventListener('click', handleExport);
  clearLogBtn.addEventListener('click', () => { logConsole.innerHTML = ''; });

  // Checkpoint Resume
  resumeBtn.addEventListener('click', handleResume);
  resumeDiscardBtn.addEventListener('click', handleDiscardCheckpoint);

  // Dashboard tabs
  dashTabBtnArchive.addEventListener('click', () => switchDashTab('archive'));
  dashTabBtnLive.addEventListener('click', () => switchDashTab('live'));
  dashTabBtnUnfollow.addEventListener('click', () => switchDashTab('unfollow'));

  // Live scan (dashboard)
  dashScanBtn.addEventListener('click', () => handleDashLiveScan().catch(err => appendLog(`[扫描] 异常: ${err.message}`, 'error')));

  // Unfollow (dashboard)
  dashLoadFollowingBtn.addEventListener('click', () => handleDashLoadFollowing().catch(err => appendLog(`[取关] 读取异常: ${err.message}`, 'error')));
  dashUnfollowBtn.addEventListener('click', () => handleDashStartUnfollow().catch(err => appendLog(`[取关] 异常: ${err.message}`, 'error')));
  dashFollowingCheckAll.addEventListener('change', () => {
    const checked = dashFollowingCheckAll.checked;
    dashFollowingItems.querySelectorAll('input[type="checkbox"]').forEach(cb => { cb.checked = checked; });
    updateDashFollowingSelection();
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
  appendLog('已放弃未完成的清理任务。', 'warn');
}

// --- Session Handling ---
async function checkSession() {
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
    chrome.runtime.sendMessage({ type: 'GET_X_SESSION' }, (response) => {
      if (response && response.success && response.session) {
        activeSession = response.session;
        sessionDot.className = 'indicator-dot active';
        sessionText.textContent = `已连接 x.com 会话 (ct0 就绪)`;
        appendLog(`[系统] 成功捕获 x.com 登录凭证。`, 'success');
        initClient();
      } else {
        sessionDot.className = 'indicator-dot error';
        sessionText.textContent = response?.error || '未检测到登录，请先在浏览器登录 x.com';
        appendLog(`[警告] 未检测到 x.com 会话凭证。如在独立页面运行，请确认扩展权限或在 x.com 标签页登录。`, 'warn');
      }
    });
  } else {
    // Running as standard web page fallback
    sessionDot.className = 'indicator-dot error';
    sessionText.textContent = '未在 Chrome 扩展环境运行 (可使用模拟测试模式)';
  }
}

function initClient() {
  if (!activeSession) return;
  client = new XDeletionClient({
    ct0: activeSession.ct0,
    authToken: activeSession.authToken
  });
}

// --- File Reading & Parsing ---
function handleFileSelect(e) {
  if (e.target.files && e.target.files[0]) {
    processFile(e.target.files[0]);
  }
}

function processFile(file) {
  fileInfo.textContent = `正在读取: ${file.name} (${(file.size / 1024 / 1024).toFixed(2)} MB)...`;
  appendLog(`[文件] 正在加载并解析 ${file.name}...`, 'info');

  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const content = e.target.result;
      rawTweets = parseArchiveContent(content);
      fileInfo.textContent = `成功加载: ${file.name}，包含 ${rawTweets.length} 条推文记录。`;
      appendLog(`[解析] 成功解析 ${rawTweets.length} 条历史推文！`, 'success');
      
      updateOverviewStats();
      applyFilters();

      startBtn.disabled = false;
      exportBtn.disabled = false;
    } catch (err) {
      fileInfo.textContent = `解析失败: ${err.message}`;
      appendLog(`[错误] 解析归档文件失败: ${err.message}`, 'error');
    }
  };
  reader.onerror = () => {
    fileInfo.textContent = '读取文件失败';
    appendLog('[错误] 文件读取发生错误', 'error');
  };
  reader.readAsText(file);
}

function updateOverviewStats() {
  statTotal.textContent = rawTweets.length.toLocaleString();

  let orig = 0, rt = 0, quote = 0, reply = 0;
  for (const t of rawTweets) {
    if (t.category === TweetCategory.ORIGINAL) orig++;
    else if (t.category === TweetCategory.RETWEET) rt++;
    else if (t.category === TweetCategory.QUOTE) quote++;
    else if (t.category === TweetCategory.REPLY) reply++;
  }

  statOriginal.textContent = orig.toLocaleString();
  statRetweet.textContent = rt.toLocaleString();
  statQuote.textContent = quote.toLocaleString();
  statReply.textContent = reply.toLocaleString();
}

// --- Filters & Preview ---
function applyFilters() {
  if (rawTweets.length === 0) return;

  const categories = [];
  if (filterOriginal.checked) categories.push(TweetCategory.ORIGINAL);
  if (filterRetweet.checked) categories.push(TweetCategory.RETWEET);
  if (filterQuote.checked) categories.push(TweetCategory.QUOTE);
  if (filterReply.checked) categories.push(TweetCategory.REPLY);

  const excludeKw = excludeKeywordsInput.value
    ? excludeKeywordsInput.value.split(',').map(s => s.trim()).filter(Boolean)
    : [];

  const keepFav = keepFavInput.value !== '' ? parseInt(keepFavInput.value, 10) : null;
  const keepRt = keepRtInput.value !== '' ? parseInt(keepRtInput.value, 10) : null;

  matchedTweets = filterTweets(rawTweets, {
    categories,
    startDate: filterStartDate.value || null,
    endDate: filterEndDate.value || null,
    keepIfFavoriteGte: keepFav,
    keepIfRetweetGte: keepRt,
    excludeKeywords: excludeKw
  });

  statMatched.textContent = `待清理: ${matchedTweets.length.toLocaleString()}`;
  metricTotal.textContent = matchedTweets.length.toLocaleString();
  previewCountLabel.textContent = `共匹配 ${matchedTweets.length.toLocaleString()} 条`;

  renderPreviewTable();
}

function renderPreviewTable() {
  previewTbody.innerHTML = '';
  if (matchedTweets.length === 0) {
    previewTbody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: #71767b; padding: 20px;">没有符合筛选条件的数据</td></tr>';
    return;
  }

  const itemsToShow = matchedTweets.slice(0, 50);
  for (const t of itemsToShow) {
    const tr = document.createElement('tr');

    const catName = {
      original: '原创发帖',
      retweet: '转发/转推',
      quote: '引用',
      reply: '回复'
    }[t.category] || t.category;

    const dateStr = t.createdAt instanceof Date ? t.createdAt.toLocaleDateString() : '';
    const targetIdStr = t.category === TweetCategory.RETWEET ? `原推: ${t.sourceTweetId || t.id}` : t.id;

    tr.innerHTML = `
      <td><span class="type-pill ${t.category}">${catName}</span></td>
      <td>${dateStr}</td>
      <td style="font-family: monospace; font-size: 11px;">${targetIdStr}</td>
      <td style="max-width: 400px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${escapeHtml(t.text)}">${escapeHtml(t.text)}</td>
      <td style="font-size: 11px; color: #8b949e;">❤️ ${t.favoriteCount} / 🔁 ${t.retweetCount}</td>
    `;
    previewTbody.appendChild(tr);
  }
}

// --- Engine Execution ---
async function handleStart() {
  if (matchedTweets.length === 0) {
    alert('请先导入推文数据并确认有待删除的匹配项！');
    return;
  }

  const isDryRun = dryRunToggle.checked;
  if (!isDryRun && !activeSession) {
    const confirmProceed = confirm('未获取到有效的 x.com 会话凭据！建议先勾选【模拟测试模式 (Dry-Run)】体验，是否仍要尝试启动？');
    if (!confirmProceed) return;
  }

  const confirmMsg = isDryRun
    ? `即将启动【模拟测试模式 (Dry-Run)】，模拟处理 ${matchedTweets.length} 条推文。是否继续？`
    : `【高能警告】即将开始真实批量删除！\n\n共 ${matchedTweets.length} 条推文将被永久删除。\n此操作不可逆！\n\n是否确认开始？`;

  if (!confirm(confirmMsg)) return;

  await ensureClientReady();

  // Persist checkpoint so the run survives tab/browser close (resume later)
  await createCheckpoint(matchedTweets, { dryRun: isDryRun });
  resumeBar.style.display = 'none';

  // Reset metrics
  countSuccess = 0;
  countAlready = 0;
  countFailed = 0;
  updateMetricsDisplay(0, matchedTweets.length);

  engine = buildEngine(isDryRun);
  engine.setQueue(matchedTweets);
  appendLog(`[任务启动] 队列共 ${matchedTweets.length} 项 (Dry-Run: ${isDryRun})`, 'info');
  await engine.start();
}

/** Ensures the API client exists and applies page-captured queryIds. */
async function ensureClientReady() {
  if (!client) {
    initClient();
  }

  // Follow X's live queryId rotations captured from the page (queryid-sniffer.js)
  const captured = {};
  try {
    const stored = await chrome.storage.local.get(['queryId_DeleteTweet', 'queryId_DeleteRetweet']);
    if (stored.queryId_DeleteTweet) captured.DeleteTweet = stored.queryId_DeleteTweet;
    if (stored.queryId_DeleteRetweet) captured.DeleteRetweet = stored.queryId_DeleteRetweet;
  } catch (e) { /* fall back to defaults */ }
  if (Object.keys(captured).length > 0) {
    client.setQueryIds(captured);
    appendLog('已自动学习页面最新接口参数 (queryId)，自动适配 X 改版。', 'info');
  } else {
    appendLog('未捕获到页面接口参数，使用内置默认值。若删除报 404，请先在 x.com 上手动删除一条推文，扩展会自动学习最新参数。', 'warn');
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

/** Builds the deletion engine with the shared UI wiring. */
function buildEngine(dryRun) {
  return new DeletionEngine({
    client,
    dryRun,
    minDelayMs: 2000,
    maxDelayMs: 4500,
    batchSize: 60,
    batchCoolingMs: 15 * 60 * 1000,
    onProgress: (p) => {
      updateMetricsDisplay(p.current, p.total);
      if (p.result.status === 'success' || p.result.status === 'success_dry_run') {
        countSuccess++;
        appendLog(`[删除成功] ID: ${p.item.id} (${p.item.category})`, 'success');
      } else if (p.result.status === 'already_deleted') {
        countAlready++;
        appendLog(`[已不存在] ID: ${p.item.id} 原推已被删除或不存在`, 'warn');
      } else {
        countFailed++;
        appendLog(`[失败] ID: ${p.item.id}: ${p.result.message || '未知错误'}`, 'error');
      }
      metricSuccess.textContent = countSuccess;
      metricAlready.textContent = countAlready;
      metricFailed.textContent = countFailed;
      if (p.result.status === 'success') {
        // Bootstrap queryId learning: persist the IDs just used successfully
        persistQueryIds();
      }
      // Auto-remove completed items from the working set (real runs only —
      // dry-run must leave the list intact for the real run afterwards)
      if (p.result.status === 'success' || p.result.status === 'already_deleted') {
        rawTweets = rawTweets.filter(t => t.id !== p.item.id);
        updateOverviewStats();
        applyFilters();
      }
      saveProgress(p.current, {
        success: countSuccess,
        already: countAlready,
        failed: countFailed
      }).catch(() => {});
    },
    onStateChange: (s) => {
      progressStatusText.textContent = s.message || s.state;
      if (s.state === EngineState.RUNNING) {
        startBtn.disabled = true;
        pauseBtn.disabled = false;
        stopBtn.disabled = false;
      } else if (s.state === EngineState.PAUSED) {
        startBtn.disabled = false;
        startBtn.textContent = '▶ 继续清理';
        pauseBtn.disabled = true;
      } else if (s.state === EngineState.IDLE || s.state === EngineState.STOPPED) {
        startBtn.disabled = false;
        startBtn.textContent = '🚀 开始清理';
        pauseBtn.disabled = true;
        stopBtn.disabled = true;
        hideCoolingBanner();
        if (s.state === EngineState.IDLE) {
          // Run completed — checkpoint no longer needed
          clearCheckpoint().catch(() => {});
          appendLog('任务完成。x.com 页面不会自动刷新，请刷新页面确认删除结果。', 'info');
        }
      }
    },
    onError: (e) => {
      appendLog(`[异常] ${e.error.message}`, 'error');
    },
    onBatchCooling: (c) => {
      showCoolingBanner(c.durationMs);
    }
  });
}

/** Resumes an interrupted run from the persisted checkpoint. */
async function handleResume() {
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
    alert('未检测到有效的 x.com 会话凭据，无法继续真实删除！');
    return;
  }

  matchedTweets = cp.queue;
  dryRunToggle.checked = cp.state.dryRun;
  await ensureClientReady();

  // Restore metrics from checkpoint
  countSuccess = cp.state.success;
  countAlready = cp.state.already;
  countFailed = cp.state.failed;

  resumeBar.style.display = 'none';

  engine = buildEngine(cp.state.dryRun);
  engine.setQueue(matchedTweets);
  engine.currentIndex = cp.state.currentIndex;
  updateMetricsDisplay(cp.state.currentIndex, matchedTweets.length);
  metricSuccess.textContent = countSuccess;
  metricAlready.textContent = countAlready;
  metricFailed.textContent = countFailed;

  appendLog(`[任务恢复] 从第 ${cp.state.currentIndex + 1} 项继续 (剩余 ${remaining} 项)。`, 'info');
  await engine.start();
}

function handlePause() {
  if (engine) {
    engine.pause();
    appendLog('[暂停] 用户已暂停批量清理任务。', 'warn');
  }
}

function handleStop() {
  if (engine) {
    engine.stop();
    appendLog('[终止] 用户已手动终止批量清理任务。', 'error');
    hideCoolingBanner();
  }
}

function updateMetricsDisplay(current, total) {
  metricCurrent.textContent = current;
  metricTotal.textContent = total;
  const pct = total > 0 ? ((current / total) * 100).toFixed(1) : 0;
  progressPercentText.textContent = `${pct}%`;
  progressBarFill.style.width = `${pct}%`;
}

function showCoolingBanner(durationMs) {
  coolingBanner.style.display = 'block';
  let remainingSec = Math.round(durationMs / 1000);

  if (coolingTimerId) clearInterval(coolingTimerId);

  coolingTimerId = setInterval(() => {
    remainingSec--;
    if (remainingSec <= 0) {
      clearInterval(coolingTimerId);
      hideCoolingBanner();
    } else {
      const mins = Math.floor(remainingSec / 60);
      const secs = remainingSec % 60;
      coolingCountdown.textContent = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
  }, 1000);
}

function hideCoolingBanner() {
  if (coolingTimerId) clearInterval(coolingTimerId);
  coolingBanner.style.display = 'none';
}

// --- CSV Export Backup ---
function handleExport() {
  if (matchedTweets.length === 0) return;

  appendLog(`[导出] 正在导出 ${matchedTweets.length} 条待清理数据为 CSV 备份...`, 'info');

  const headers = ['id', 'category', 'createdAt', 'sourceTweetId', 'favoriteCount', 'retweetCount', 'text'];
  const rows = matchedTweets.map(t => [
    t.id,
    t.category,
    t.createdAt instanceof Date ? t.createdAt.toISOString() : '',
    t.sourceTweetId || '',
    t.favoriteCount,
    t.retweetCount,
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

  appendLog('[导出] CSV 备份下载完成！请妥善保存。', 'success');
}

// --- Helper Functions ---
function appendLog(msg, type = 'info') {
  const div = document.createElement('div');
  const time = new Date().toLocaleTimeString();
  div.className = `log-item ${type}`;
  div.textContent = `[${time}] ${msg}`;
  logConsole.appendChild(div);
  logConsole.scrollTop = logConsole.scrollHeight;
}

function escapeHtml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// --- Dashboard mode tabs ---
function switchDashTab(mode) {
  const tabs = {
    archive: [dashTabBtnArchive, dashTabArchive],
    live: [dashTabBtnLive, dashTabLive],
    unfollow: [dashTabBtnUnfollow, dashTabUnfollow]
  };
  for (const [key, [btn, content]] of Object.entries(tabs)) {
    const active = key === mode;
    btn.classList.toggle('active', active);
    content.classList.toggle('active', active);
  }
  // The shared log travels with the active tab so it is always in view
  const logSection = document.getElementById('shared-log-section');
  const slot = document.getElementById(`log-slot-${mode}`);
  if (logSection && slot) slot.appendChild(logSection);
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function findXComTab() {
  const tabs = await chrome.tabs.query({ url: ['https://x.com/*', 'https://twitter.com/*'] });
  if (!tabs || tabs.length === 0) {
    throw new Error('未找到打开的 x.com 标签页——请先打开 x.com 并刷新一次');
  }
  return tabs[0];
}

// --- Live scan (dashboard) ---
async function handleDashLiveScan() {
  dashScanBtn.disabled = true;
  dashScanStatus.textContent = '正在准备扫描...';

  try {
    const tab = await findXComTab();
    appendLog(`[扫描] 目标标签页: ${tab.url}`, 'info');

    dashScanStatus.textContent = '正在刷新 x.com 页面以获取精确数据...';
    await chrome.tabs.reload(tab.id);
    const start = Date.now();
    while (Date.now() - start < 15000) {
      const t = await chrome.tabs.get(tab.id);
      if (t.status === 'complete') break;
      await sleep(300);
    }
    await sleep(1200);

    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['content/queryid-sniffer.js'],
        world: 'MAIN'
      });
    } catch (e) { /* fallback below */ }

    let response;
    const scrollTimes = Math.max(1, Math.min(50, parseInt(dashScanDepth.value, 10) || 8));
    try {
      response = await chrome.tabs.sendMessage(tab.id, { type: 'SCAN_TIMELINE', scrollTimes });
    } catch (err) {
      if (!/Receiving end|message port/i.test(err.message)) throw err;
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content/scanner.js'] });
      response = await chrome.tabs.sendMessage(tab.id, { type: 'SCAN_TIMELINE', scrollTimes });
    }

    if (response && response.success && response.tweets) {
      const fresh = response.tweets.map(t => ({
        ...t,
        createdAt: t.createdAt instanceof Date ? t.createdAt : new Date(t.createdAt),
        favoriteCount: t.favoriteCount ?? null,
        retweetCount: t.retweetCount ?? null
      }));
      const merged = new Map(rawTweets.map(t => [t.id, t]));
      for (const t of fresh) merged.set(t.id, t);
      rawTweets = Array.from(merged.values());

      appendLog(`[扫描] 本次 ${fresh.length} 条，累计 ${rawTweets.length} 条 (${response.mode === 'api' ? '接口精确数据 ✓' : '页面解析兜底'})`,
        response.mode === 'api' ? 'success' : 'warn');
      updateOverviewStats();
      applyFilters();
      dashScanStatus.textContent = `扫描完成：本次 ${fresh.length} 条，累计 ${rawTweets.length} 条。可在归档页查看预览并执行删除。`;
    } else {
      throw new Error('扫描结果为空');
    }
  } finally {
    dashScanBtn.disabled = false;
  }
}

// --- Unfollow (dashboard) ---

function getDashSelectedFollowing() {
  const ids = new Set(
    Array.from(dashFollowingItems.querySelectorAll('input[type="checkbox"]:checked')).map(cb => cb.dataset.id)
  );
  return dashFollowingUsers.filter(u => ids.has(u.id));
}

function updateDashFollowingSelection() {
  const selected = getDashSelectedFollowing();
  dashFollowingSelectedCount.textContent = `已选 ${selected.length} / ${dashFollowingUsers.length}`;
  dashUnfollowBtn.textContent = `🚫 开始取关 ${selected.length} 人`;
  dashUnfollowBtn.disabled = dashUnfollowRunning || selected.length === 0 || !dashUnfollowMutation;
  dashFollowingCheckAll.checked = dashFollowingUsers.length > 0 && selected.length === dashFollowingUsers.length;
}

function renderDashFollowingList() {
  if (dashFollowingUsers.length === 0) {
    dashFollowingList.style.display = 'none';
    dashFollowingItems.innerHTML = '';
    updateDashFollowingSelection();
    return;
  }
  dashFollowingList.style.display = 'block';
  dashFollowingItems.innerHTML = '';
  for (const u of dashFollowingUsers) {
    const row = document.createElement('label');
    row.className = 'following-item';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = true;
    cb.dataset.id = u.id;
    cb.addEventListener('change', updateDashFollowingSelection);
    const span = document.createElement('span');
    span.className = 'following-name';
    const label = u.displayName ? `${u.displayName} (@${u.name})` : `@${u.name}`;
    span.textContent = label;
    span.title = `${label} · ID ${u.id}`;
    row.appendChild(cb);
    row.appendChild(span);
    dashFollowingItems.appendChild(row);
  }
  updateDashFollowingSelection();
}

function pickUnfollowMutation(candidates) {
  if (!Array.isArray(candidates) || candidates.length === 0) return null;
  return candidates.find(m => /unfollow|destroy/i.test(m.opName)) || candidates[candidates.length - 1] || null;
}

async function handleDashLoadFollowing() {
  dashLoadFollowingBtn.disabled = true;
  dashFollowingStatus.textContent = '正在从页面缓冲区读取...';

  try {
    const tab = await findXComTab();
    let resp;
    try {
      resp = await chrome.tabs.sendMessage(tab.id, { type: 'SCAN_FOLLOWING' });
    } catch (err) {
      if (!/Receiving end|message port/i.test(err.message)) throw err;
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content/scanner.js'] });
      resp = await chrome.tabs.sendMessage(tab.id, { type: 'SCAN_FOLLOWING' });
    }

    dashFollowingUsers = (resp && resp.users) || [];
    const cands = ((resp && resp.mutationCandidates) || []).slice();
    dashFollowMutationCandidates = cands;
    dashUnfollowMutation = pickUnfollowMutation(cands);

    const posts = (resp && resp.recentPosts) || [];
    if (cands.length > 0) {
      appendLog(`[取关候选] ${cands.map(c => c.opName).join(', ')}`, 'info');
    } else {
      appendLog('[取关候选] 无 —— 请在「关注」页刷新后手动取关 1 人再读取。', 'warn');
    }
    if (posts.length > 0) {
      appendLog(`[最近POST] 共 ${posts.length} 条（最新在上）:`, 'info');
      for (const p of posts.slice(-6).reverse()) {
        appendLog(`  ↳ ${p.url.slice(0, 110)}`, 'info');
        appendLog(`    body: ${p.body.slice(0, 140)}`, 'info');
      }
    }

    if (dashFollowingUsers.length === 0) {
      dashFollowingStatus.textContent = '未捕获到关注列表。请打开「关注」列表页并刷新页面后重试。';
    } else if (!dashUnfollowMutation) {
      dashFollowingStatus.textContent = `已捕获 ${dashFollowingUsers.length} 个关注，但取关接口未学习——请先手动取关 1 人，再点「读取」。`;
    } else {
      dashFollowingStatus.textContent = `已捕获 ${dashFollowingUsers.length} 个关注，取关接口已学习 ✓（${dashUnfollowMutation.opName}）`;
    }
    dashUnfollowBtn.disabled = false;
    renderDashFollowingList();
  } finally {
    dashLoadFollowingBtn.disabled = false;
  }
}

async function handleDashStartUnfollow() {
  const selected = getDashSelectedFollowing();
  if (dashUnfollowRunning || selected.length === 0 || !dashUnfollowMutation) return;
  if (!activeSession) {
    alert('未检测到 x.com 登录，无法取关！');
    return;
  }
  if (!client) initClient();

  if (!confirm(`确定要取消关注选中的 ${selected.length} 人吗？\n\n每次间隔约 3-6 秒。`)) return;

  const tryOrder = [
    dashUnfollowMutation,
    ...dashFollowMutationCandidates.filter(c => c !== dashUnfollowMutation)
  ];
  let parsedBody = null;
  let formParams = null;
  let isJsonBody = false;
  let idField = null;
  let swapWith = null;
  let learnedFrom = null;

  function extractTargetField(bodyText) {
    try {
      const raw = String(bodyText || '').trim();
      if (raw.startsWith('{')) {
        const parsed = JSON.parse(raw);
        for (const [k, v] of Object.entries(parsed.variables || {})) {
          if (typeof v !== 'string' || !v) continue;
          if (/^\d{6,}$/.test(v)) return { parsedBody: parsed, isJsonBody: true, idField: k, swapWith: 'id' };
          if (/screen_name/i.test(k)) return { parsedBody: parsed, isJsonBody: true, idField: k, swapWith: 'name' };
        }
      } else {
        const params = new URLSearchParams(raw);
        for (const [k, v] of params.entries()) {
          if (!v) continue;
          if (/^\d{6,}$/.test(v)) return { formParams: params, isJsonBody: false, idField: k, swapWith: 'id' };
          if (/screen_name/i.test(k)) return { formParams: params, isJsonBody: false, idField: k, swapWith: 'name' };
        }
      }
    } catch (e) { /* fall through */ }
    return null;
  }

  for (const cand of tryOrder) {
    const res = extractTargetField(cand.bodyText);
    if (res) {
      parsedBody = res.parsedBody || null;
      formParams = res.formParams || null;
      isJsonBody = res.isJsonBody;
      idField = res.idField;
      swapWith = res.swapWith;
      learnedFrom = cand;
      break;
    }
  }
  if (!idField) {
    alert(`未能从学习的请求中识别目标用户字段，取关终止。已尝试候选数: ${tryOrder.length}`);
    return;
  }
  appendLog(`[取关] 已识别目标字段: ${idField}，模板来源: ${learnedFrom.opName}`, 'info');

  dashUnfollowRunning = true;
  dashUnfollowBtn.disabled = true;
  let ok = 0;
  let fail = 0;
  const unfollowedIds = new Set();

  for (const u of selected) {
    try {
      let body;
      if (isJsonBody) {
        body = JSON.stringify({
          ...parsedBody,
          variables: { ...parsedBody.variables, [idField]: swapWith === 'id' ? u.id : u.name }
        });
      } else {
        formParams.set(idField, swapWith === 'id' ? u.id : u.name);
        body = formParams.toString();
      }
      const headers = client.getHeaders();
      headers['content-type'] = isJsonBody ? 'application/json' : 'application/x-www-form-urlencoded';
      const res = await fetch(learnedFrom.url, {
        method: 'POST',
        credentials: 'include',
        headers,
        body
      });
      if (res.ok) {
        ok++;
        unfollowedIds.add(u.id);
        appendLog(`[取关] 已取消关注 @${u.name}`, 'success');
      } else if (res.status === 429) {
        appendLog('[取关] 触发频率限制，停止本次任务。', 'error');
        break;
      } else {
        fail++;
        appendLog(`[取关] @${u.name} 失败 (HTTP ${res.status})`, 'error');
      }
      // Near-button live progress (the log sits inside the same tab, but the
      // status line keeps feedback immediate)
      dashFollowingStatus.textContent = `取关中 ${ok + fail}/${selected.length} · 最近: @${u.name}`;
    } catch (err) {
      fail++;
      appendLog(`[取关] @${u.name} 异常: ${err.message}`, 'error');
    }

    dashUnfollowBtn.textContent = `🚫 取关中 ${ok + fail}/${selected.length}`;
    await sleep(3000 + Math.random() * 3000);
  }

  dashUnfollowRunning = false;
  dashFollowingUsers = dashFollowingUsers.filter(u => !unfollowedIds.has(u.id));
  renderDashFollowingList();
  dashFollowingStatus.textContent = `取关完成: 成功 ${ok}，失败 ${fail}。${fail > 0 ? '失败项仍在列表中可重试。' : ''}`;
  appendLog(`取关完成: 成功 ${ok}，失败 ${fail}。`, fail > 0 ? 'warn' : 'success');
}
