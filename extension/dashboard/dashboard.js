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
