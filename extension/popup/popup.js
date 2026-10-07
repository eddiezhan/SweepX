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
const tabZip = document.getElementById('tab-zip');
const tabLive = document.getElementById('tab-live');

const zipDropArea = document.getElementById('zip-drop-area');
const zipFileInput = document.getElementById('zip-file-input');
const fileLoadedStatus = document.getElementById('file-loaded-status');

const scanPageBtn = document.getElementById('scan-page-btn');
const liveScanStatus = document.getElementById('live-scan-status');

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

// Init
document.addEventListener('DOMContentLoaded', () => {
  bindEvents();
  checkSession();
});

function bindEvents() {
  // Tabs
  tabBtnZip.addEventListener('click', () => switchTab('zip'));
  tabBtnLive.addEventListener('click', () => switchTab('live'));

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
}

function switchTab(mode) {
  if (mode === 'zip') {
    tabBtnZip.classList.add('active');
    tabBtnLive.classList.remove('active');
    tabZip.classList.add('active');
    tabLive.classList.remove('active');
  } else {
    tabBtnLive.classList.add('active');
    tabBtnZip.classList.remove('active');
    tabLive.classList.add('active');
    tabZip.classList.remove('active');
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
async function handleLiveScan() {
  scanPageBtn.disabled = true;
  scanPageBtn.textContent = '⏳ 正在滚动扫描中...';
  liveScanStatus.textContent = '正在获取当前标签页推文...';

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || (!tab.url.includes('x.com') && !tab.url.includes('twitter.com'))) {
      throw new Error('请先在浏览器当前标签页打开 x.com 个人主页');
    }

    const response = await chrome.tabs.sendMessage(tab.id, { type: 'SCAN_TIMELINE', scrollTimes: 4 });
    if (response && response.success && response.tweets) {
      rawTweets = response.tweets;
      liveScanStatus.textContent = `扫描完成，共捕获 ${rawTweets.length} 条推文！`;
      log(`在线扫描到 ${rawTweets.length} 条推文。`, 'success');
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

  if (!client) {
    client = new XDeletionClient({
      ct0: activeSession?.ct0,
      authToken: activeSession?.authToken
    });
  }

  // Reset Metrics
  countSuccess = 0;
  countAlready = 0;
  countFailed = 0;
  updateProgressDisplay(0, matchedTweets.length);

  progressWrapper.style.display = 'block';
  mainActionBtn.disabled = true;

  engine = new DeletionEngine({
    client,
    dryRun: isDryRun,
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
      }
    },
    onError: (e) => {
      log(`[异常] ${e.error.message}`, 'error');
    },
    onBatchCooling: (c) => {
      showCoolingBox(c.durationMs);
    }
  });

  engine.setQueue(matchedTweets);
  log(`开始执行清理任务 (共 ${matchedTweets.length} 项)...`, 'info');
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
  a.download = `deleteX_backup_${new Date().toISOString().slice(0, 10)}.csv`;
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
