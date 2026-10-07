/**
 * SweepX - Extension Background Service Worker
 *
 * Handles fetching x.com cookies (ct0, auth_token) securely for the dashboard.
 */

// --- Session icon state: toolbar icon lights up while an x.com session
// cookie exists, dims when logged out (no badge text) ---

const ICON_BRIGHT = { '16': 'icons/icon16.png', '48': 'icons/icon48.png', '128': 'icons/icon128.png' };
const ICON_DIM = { '16': 'icons/icon16-dim.png', '48': 'icons/icon48-dim.png', '128': 'icons/icon128-dim.png' };

async function updateSessionIcon() {
  try {
    const cookies = await chrome.cookies.getAll({ domain: 'x.com' });
    const hasSession = cookies.some(c => c.name === 'ct0');
    await chrome.action.setIcon({ path: hasSession ? ICON_BRIGHT : ICON_DIM });
  } catch (e) {
    // icon state is cosmetic; never let it break the worker
  }
}

chrome.cookies.onChanged.addListener(change => {
  if (change.cookie.name === 'ct0') updateSessionIcon();
});

chrome.runtime.onInstalled.addListener(updateSessionIcon);
chrome.runtime.onStartup.addListener(updateSessionIcon);
updateSessionIcon();

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'GET_X_SESSION') {
    handleGetSession().then(sendResponse).catch(err => {
      sendResponse({ success: false, error: err.message });
    });
    return true; // Keep message channel open for async response
  }

  if (request.type === 'OPEN_DASHBOARD') {
    chrome.tabs.create({ url: chrome.runtime.getURL('dashboard/index.html') });
    sendResponse({ success: true });
    return true;
  }
});

async function handleGetSession() {
  const cookies = await chrome.cookies.getAll({ domain: 'x.com' });
  
  const ct0 = cookies.find(c => c.name === 'ct0')?.value;
  const authToken = cookies.find(c => c.name === 'auth_token')?.value;

  if (!ct0) {
    return {
      success: false,
      error: '未检测到 X (x.com) 的登录凭据。请确保您已在浏览器中登录 x.com。'
    };
  }

  return {
    success: true,
    session: {
      ct0,
      authToken,
      domain: 'x.com'
    }
  };
}
