/**
 * deleteX - Extension Background Service Worker
 * 
 * Handles fetching x.com cookies (ct0, auth_token) securely for the dashboard.
 */

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
