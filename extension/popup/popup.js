document.addEventListener('DOMContentLoaded', async () => {
  const loginStatusEl = document.getElementById('login-status');
  const csrfStatusEl = document.getElementById('csrf-status');
  const openDashboardBtn = document.getElementById('open-dashboard-btn');

  // Check login status with background
  chrome.runtime.sendMessage({ type: 'GET_X_SESSION' }, (response) => {
    if (response && response.success && response.session) {
      loginStatusEl.textContent = '已登录 x.com';
      loginStatusEl.className = 'status-val';
      csrfStatusEl.textContent = '已就绪 (ct0 有效)';
      csrfStatusEl.className = 'status-val';
    } else {
      loginStatusEl.textContent = '未检测到登录';
      loginStatusEl.className = 'status-val warn';
      csrfStatusEl.textContent = '未获取';
      csrfStatusEl.className = 'status-val warn';
    }
  });

  openDashboardBtn.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'OPEN_DASHBOARD' });
    window.close();
  });
});
