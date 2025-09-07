// options.js
// TimeBoxer Options Dashboard Logic: Handles site management, limit editing, usage reset, import/export, and real-time UI updates.

const STORAGE_KEY = 'siteLimits';
const USAGE_HISTORY_KEY = 'usageHistory';

// Utility: Format seconds as HH:MM:SS
function formatTime(sec) {
  sec = Math.max(0, sec);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return h > 0 ? `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}` : `${m}:${s.toString().padStart(2, '0')}`;
}

// Utility: Normalize domain
function normalizeDomain(domain) {
  return domain.trim().replace(/^www\./, '').toLowerCase();
}

// Ensure validateDomain is defined globally
function validateDomain(domain) {
  return domain && domain !== 'null' && domain.trim() !== '';
}

// Attach validateDomain to the global scope
window.validateDomain = validateDomain;

// Render sites table
function renderSites(limits) {
  const tbody = document.getElementById('sitesTbody');
  tbody.innerHTML = '';
  Object.entries(limits).forEach(([domain, site]) => {
    const tr = document.createElement('tr');
    // Used/Limit
    const used = formatTime(site.usedSeconds);
    const limit = formatTime(site.limitSeconds);
    const percent = Math.min(100, Math.round((site.usedSeconds / site.limitSeconds) * 100));
    const snoozeCount = site.snoozeCount || 0;
    tr.innerHTML = `
      <td>${domain}</td>
      <td>${used}</td>
      <td>${limit}</td>
      <td><span class="tbx-snooze-count" title="Snoozes">⏰ ${snoozeCount}</span></td>
      <td>
        <div class="tbx-progress">
          <div class="tbx-progress-bar" style="width:${percent}%"></div>
        </div>
        <span class="tbx-progress-label">${percent}%</span>
      </td>
      <td>
        <button class="editBtn" title="Edit limit">✏️</button>
        <button class="removeBtn" title="Remove site">🗑️</button>
        <button class="resetBtn" title="Reset usage">🔄</button>
      </td>
    `;
    // Edit limit
    tr.querySelector('.editBtn').onclick = () => {
      const newMin = prompt(`Set daily limit for ${domain} (minutes):`, Math.round(site.limitSeconds / 60));
      if (newMin && !isNaN(newMin) && newMin > 0 && newMin <= 1440) {
        site.limitSeconds = Math.round(Number(newMin) * 60);
        chrome.storage.sync.get([STORAGE_KEY], (data) => {
          const limits = data[STORAGE_KEY] || {};
          limits[domain] = site;
          chrome.storage.sync.set({ [STORAGE_KEY]: limits });
        });
      }
    };
    // Remove site
    tr.querySelector('.removeBtn').onclick = () => {
      if (confirm(`Remove ${domain}?`)) {
        chrome.storage.sync.get([STORAGE_KEY], (data) => {
          const limits = data[STORAGE_KEY] || {};
          delete limits[domain];
          chrome.storage.sync.set({ [STORAGE_KEY]: limits });
        });
      }
    };
    // Reset usage
    tr.querySelector('.resetBtn').onclick = () => {
      chrome.runtime.sendMessage({ action: 'manualReset', domain });
    };
    tbody.appendChild(tr);
  });
}

// Render history from usageHistory
function renderHistoryFromUsageHistory() {
  const historyDiv = document.getElementById('historyList');
  historyDiv.innerHTML = '';
  chrome.storage.sync.get([USAGE_HISTORY_KEY], (data) => {
    const usageHistory = data[USAGE_HISTORY_KEY] || {};
    const entries = Object.entries(usageHistory).filter(([domain, info]) => {
      return validateDomain(domain) && info && typeof info.usedSeconds === 'number';
    });
    if (entries.length) {
      const table = document.createElement('table');
      table.className = 'tbx-history-table';
      table.innerHTML = `
        <thead>
          <tr><th>Domain</th><th>Time Spent</th></tr>
        </thead>
        <tbody>
          ${entries.map(([domain, info]) => `<tr><td>${domain === 'chrome-extensions' ? 'chrome://extensions' : domain}</td><td>${formatTime(info.usedSeconds)}</td></tr>`).join('')}
        </tbody>
      `;
      historyDiv.appendChild(table);
    } else {
      historyDiv.textContent = 'No history yet.';
    }
  });
}

// Add site form
document.getElementById('addSiteForm').onsubmit = (e) => {
  e.preventDefault();
  const domainInput = document.getElementById('domainInput');
  const minutesInput = document.getElementById('minutesInput');
  const errorDiv = document.getElementById('addSiteError');
  let domain = normalizeDomain(domainInput.value);
  let minutes = Number(minutesInput.value);
  errorDiv.textContent = '';
  if (!domain.match(/^[a-zA-Z0-9.-]+$/)) {
    errorDiv.textContent = 'Invalid domain format.';
    return;
  }
  if (minutes < 1 || minutes > 1440) {
    errorDiv.textContent = 'Minutes must be between 1 and 1440.';
    return;
  }
  chrome.storage.sync.get([STORAGE_KEY], (data) => {
    const limits = data[STORAGE_KEY] || {};
    if (limits[domain]) {
      errorDiv.textContent = 'Domain already exists.';
      return;
    }
    limits[domain] = {
      limitSeconds: minutes * 60,
      usedSeconds: 0,
      lastStart: null,
      isActive: false,
      snoozedUntil: null,
      history: []
    };
    chrome.storage.sync.set({ [STORAGE_KEY]: limits }, () => {
      domainInput.value = '';
      minutesInput.value = '';
    });
  });
};

// Export settings
document.getElementById('exportBtn').onclick = () => {
  chrome.runtime.sendMessage({ action: 'exportSettings' }, (resp) => {
    const blob = new Blob([resp.json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'timeboxer-settings.json';
    a.click();
    URL.revokeObjectURL(url);
  });
};

// Import settings
document.getElementById('importBtn').onclick = () => {
  document.getElementById('importFileInput').click();
};
document.getElementById('importFileInput').onchange = (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    chrome.runtime.sendMessage({ action: 'importSettings', json: reader.result }, (resp) => {
      if (!resp.success) alert('Import failed: ' + (resp.error || 'Unknown error'));
    });
  };
  reader.readAsText(file);
};

// Global reset
document.getElementById('globalResetBtn').onclick = () => {
  if (confirm('Reset usage for all sites?')) {
    chrome.runtime.sendMessage({ action: 'globalReset' });
  }
};

// Listen for storage changes and initial load
function updateUI() {
  chrome.storage.sync.get([STORAGE_KEY], (data) => {
    const limits = data[STORAGE_KEY] || {};
    renderSites(limits);
    renderHistoryFromUsageHistory();
  });
}
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && (changes[STORAGE_KEY] || changes['usageHistory'])) updateUI();
});
document.addEventListener('DOMContentLoaded', updateUI);

// Update table headers
document.getElementById('sitesTable').querySelector('thead').innerHTML = `
  <tr>
    <th>Domain</th>
    <th>Used</th>
    <th>Limit</th>
    <th>Snoozes</th>
    <th>Progress</th>
    <th>Actions</th>
  </tr>
`;