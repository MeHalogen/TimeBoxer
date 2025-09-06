// popup.js
// TimeBoxer Popup Logic: Shows real-time usage for all tracked sites and minutes left. Updates instantly on changes.

const STORAGE_KEY = 'siteLimits';

// Utility: Format seconds as mm:ss or HH:MM:SS
function formatTime(sec) {
  sec = Math.max(0, sec);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return h > 0 ? `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}` : `${m}:${s.toString().padStart(2, '0')}`;
}

// Render popup table
function renderPopup(limits) {
  const tbody = document.getElementById('popupSitesTbody');
  const emptyDiv = document.getElementById('popupEmpty');
  tbody.innerHTML = '';
  const entries = Object.entries(limits);
  if (!entries.length) {
    emptyDiv.style.display = '';
    return;
  }
  emptyDiv.style.display = 'none';
  entries.forEach(([domain, site]) => {
    const tr = document.createElement('tr');
    const used = formatTime(site.usedSeconds);
    const limit = formatTime(site.limitSeconds);
    const leftSec = Math.max(0, site.limitSeconds - site.usedSeconds);
    const left = formatTime(leftSec);
    const percent = Math.min(100, Math.round((site.usedSeconds / site.limitSeconds) * 100));
    tr.innerHTML = `
      <td>${domain}</td>
      <td>${used}</td>
      <td>${limit}</td>
      <td>${left}</td>
      <td>
        <div class="tbx-progress">
          <div class="tbx-progress-bar" style="width:${percent}%"></div>
        </div>
        <span class="tbx-progress-label">${percent}%</span>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

// Listen for storage changes and initial load
function updateUI() {
  chrome.storage.sync.get([STORAGE_KEY], (data) => {
    const limits = data[STORAGE_KEY] || {};
    renderPopup(limits);
  });
}
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && changes[STORAGE_KEY]) updateUI();
});
document.addEventListener('DOMContentLoaded', updateUI);