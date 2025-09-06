// background.js
// TimeBoxer Service Worker: Handles timer logic, domain normalization, daily reset, storage updates, and messaging with content/popup/options scripts.

const STORAGE_KEY = 'siteLimits';

// Normalize domain: strips www. and returns hostname
function normalizeDomain(url) {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, '');
    return hostname;
  } catch (e) {
    return null;
  }
}

// Get next local midnight timestamp
function getNextMidnight() {
  const now = new Date();
  const next = new Date(now);
  next.setHours(24, 0, 0, 0);
  return next.getTime();
}

// Initialize default site on install (youtube.com: 15 min)
chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === 'install') {
    chrome.storage.sync.get([STORAGE_KEY], (data) => {
      if (!data[STORAGE_KEY]) {
        chrome.storage.sync.set({
          [STORAGE_KEY]: {
            'youtube.com': {
              limitSeconds: 15 * 60,
              usedSeconds: 0,
              lastStart: null,
              isActive: false,
              snoozedUntil: null,
              history: []
            }
          }
        });
      }
    });
  }
  // Set daily reset alarm
  chrome.alarms.create('dailyReset', {
    when: getNextMidnight(),
    periodInMinutes: 24 * 60
  });
});

// Daily reset: clear usedSeconds, lastStart, snoozedUntil, push to history
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'dailyReset') {
    chrome.storage.sync.get([STORAGE_KEY], (data) => {
      const limits = data[STORAGE_KEY] || {};
      Object.keys(limits).forEach(domain => {
        // Save yesterday's usage to history (max 7 days)
        const entry = {
          date: new Date().toISOString().slice(0, 10),
          usedSeconds: limits[domain].usedSeconds
        };
        limits[domain].history = (limits[domain].history || []).concat(entry).slice(-7);
        limits[domain].usedSeconds = 0;
        limits[domain].lastStart = null;
        limits[domain].isActive = false;
        limits[domain].snoozedUntil = null;
      });
      chrome.storage.sync.set({ [STORAGE_KEY]: limits });
    });
  }
});

// Track active tab and window focus
let currentTabId = null;
let currentWindowFocused = true;
let activeDomain = null;
let realtimeAlarmActive = false;

// Helper: update timer for all domains
function pauseAllDomains(callback) {
  chrome.storage.sync.get([STORAGE_KEY], (data) => {
    const limits = data[STORAGE_KEY] || {};
    let changed = false;
    let updatedDomain = null;
    Object.keys(limits).forEach(domain => {
      const site = limits[domain];
      if (site.isActive && site.lastStart) {
        const elapsed = Math.round((Date.now() - site.lastStart) / 1000);
        site.usedSeconds += elapsed;
        site.lastStart = null;
        site.isActive = false;
        changed = true;
        updatedDomain = domain;
      }
    });
    if (changed) {
      chrome.storage.sync.set({ [STORAGE_KEY]: limits }, () => {
        // After pausing, check overlay for current active tab
        if (currentTabId && updatedDomain) {
          chrome.tabs.get(currentTabId, (tab) => {
            if (tab && tab.url) {
              checkOverlay(currentTabId, tab.url);
            }
          });
        }
        // Stop realtime alarm
        chrome.alarms.clear('realtimeCheck');
        realtimeAlarmActive = false;
        activeDomain = null;
        if (callback) callback();
      });
    } else {
      // Stop realtime alarm
      chrome.alarms.clear('realtimeCheck');
      realtimeAlarmActive = false;
      activeDomain = null;
      if (callback) callback();
    }
  });
}

// Helper: activate timer for domain
function activateDomain(domain) {
  chrome.storage.sync.get([STORAGE_KEY], (data) => {
    const limits = data[STORAGE_KEY] || {};
    const site = limits[domain];
    if (site && !site.isActive && (!site.snoozedUntil || site.snoozedUntil <= Date.now())) {
      site.lastStart = Date.now();
      site.isActive = true;
      chrome.storage.sync.set({ [STORAGE_KEY]: limits }, () => {
        // Start realtime alarm if not already running
        activeDomain = domain;
        if (!realtimeAlarmActive) {
          chrome.alarms.create('realtimeCheck', { periodInMinutes: 1/60 }); // every 1 second
          realtimeAlarmActive = true;
        }
      });
    }
  });
}

// Helper: check if overlay needed
function checkOverlay(tabId, url) {
  const domain = normalizeDomain(url);
  if (!domain) {
    console.log('[TimeBoxer] checkOverlay: Could not normalize domain for url', url);
    return;
  }
  chrome.storage.sync.get([STORAGE_KEY], (data) => {
    const site = (data[STORAGE_KEY] || {})[domain];
    if (!site) {
      console.log(`[TimeBoxer] checkOverlay: No site config for domain ${domain}`);
      return;
    }
    const now = Date.now();
    // Always inject content.js before sending message
    chrome.scripting.executeScript({
      target: { tabId },
      files: ['content.js']
    }, () => {
      if (chrome.runtime.lastError) {
        console.log('[TimeBoxer] scripting.executeScript error:', chrome.runtime.lastError.message);
      }
      if (site.usedSeconds >= site.limitSeconds && (!site.snoozedUntil || site.snoozedUntil <= now)) {
        console.log(`[TimeBoxer] checkOverlay: Sending showOverlay for ${domain} on tab ${tabId}`);
        chrome.tabs.sendMessage(tabId, { action: 'showOverlay', domain }, (resp) => {
          if (chrome.runtime.lastError) {
            console.log('[TimeBoxer] showOverlay message error:', chrome.runtime.lastError.message);
          } else {
            console.log('[TimeBoxer] showOverlay message sent successfully');
          }
        });
      } else {
        console.log(`[TimeBoxer] checkOverlay: Sending hideOverlay for ${domain} on tab ${tabId}`);
        chrome.tabs.sendMessage(tabId, { action: 'hideOverlay', domain }, (resp) => {
          if (chrome.runtime.lastError) {
            console.log('[TimeBoxer] hideOverlay message error:', chrome.runtime.lastError.message);
          } else {
            console.log('[TimeBoxer] hideOverlay message sent successfully');
          }
        });
      }
    });
  });
}

// Tab activated: pause previous, activate new if tracked
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  pauseAllDomains(() => {
    chrome.tabs.get(activeInfo.tabId, (tab) => {
      if (!tab || !tab.url) return;
      const domain = normalizeDomain(tab.url);
      if (!domain) return;
      currentTabId = activeInfo.tabId;
      if (currentWindowFocused) activateDomain(domain);
      checkOverlay(activeInfo.tabId, tab.url);
    });
  });
});

// Tab updated: activate if status complete and tab is active
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.active && tab.url) {
    const domain = normalizeDomain(tab.url);
    if (!domain) return;
    if (currentWindowFocused) activateDomain(domain);
    checkOverlay(tabId, tab.url);
  }
});

// Window focus changed: pause all if unfocused, activate if focused
chrome.windows.onFocusChanged.addListener((windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) {
    currentWindowFocused = false;
    pauseAllDomains();
  } else {
    currentWindowFocused = true;
    // Find active tab in focused window
    chrome.windows.get(windowId, { populate: true }, (win) => {
      if (!win || !win.focused) return;
      const activeTab = win.tabs.find(t => t.active && t.url);
      if (activeTab) {
        const domain = normalizeDomain(activeTab.url);
        if (domain) activateDomain(domain);
        checkOverlay(activeTab.id, activeTab.url);
      }
    });
  }
});

// Tab removed: pause all if active tab closed
chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
  if (tabId === currentTabId) {
    pauseAllDomains();
    currentTabId = null;
  }
});

// Message handler: snooze, closeTab, manual reset, export/import
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'snooze' && msg.domain) {
    chrome.storage.sync.get([STORAGE_KEY], (data) => {
      const limits = data[STORAGE_KEY] || {};
      const site = limits[msg.domain];
      if (site) {
        site.snoozedUntil = Date.now() + 5 * 60 * 1000;
        site.lastStart = null;
        site.isActive = false;
        chrome.storage.sync.set({ [STORAGE_KEY]: limits }, () => {
          sendResponse({ success: true });
        });
      } else sendResponse({ success: false });
    });
    return true;
  }
  if (msg.action === 'closeTab' && sender.tab && sender.tab.id) {
    chrome.tabs.remove(sender.tab.id);
    sendResponse({ success: true });
    return true;
  }
  if (msg.action === 'manualReset' && msg.domain) {
    chrome.storage.sync.get([STORAGE_KEY], (data) => {
      const limits = data[STORAGE_KEY] || {};
      const site = limits[msg.domain];
      if (site) {
        site.usedSeconds = 0;
        site.lastStart = null;
        site.isActive = false;
        site.snoozedUntil = null;
        chrome.storage.sync.set({ [STORAGE_KEY]: limits }, () => {
          sendResponse({ success: true });
        });
      } else sendResponse({ success: false });
    });
    return true;
  }
  if (msg.action === 'globalReset') {
    chrome.storage.sync.get([STORAGE_KEY], (data) => {
      const limits = data[STORAGE_KEY] || {};
      Object.keys(limits).forEach(domain => {
        limits[domain].usedSeconds = 0;
        limits[domain].lastStart = null;
        limits[domain].isActive = false;
        limits[domain].snoozedUntil = null;
      });
      chrome.storage.sync.set({ [STORAGE_KEY]: limits }, () => {
        sendResponse({ success: true });
      });
    });
    return true;
  }
  if (msg.action === 'exportSettings') {
    chrome.storage.sync.get([STORAGE_KEY], (data) => {
      sendResponse({ json: JSON.stringify(data[STORAGE_KEY] || {}, null, 2) });
    });
    return true;
  }
  if (msg.action === 'importSettings' && msg.json) {
    let imported;
    try {
      imported = JSON.parse(msg.json);
    } catch (e) {
      sendResponse({ success: false, error: 'Invalid JSON' });
      return true;
    }
    chrome.storage.sync.set({ [STORAGE_KEY]: imported }, () => {
      sendResponse({ success: true });
    });
    return true;
  }
  // For debugging: simulate time
  if (msg.action === 'simulateTime' && msg.domain && typeof msg.seconds === 'number') {
    chrome.storage.sync.get([STORAGE_KEY], (data) => {
      const limits = data[STORAGE_KEY] || {};
      const site = limits[msg.domain];
      if (site) {
        site.usedSeconds += msg.seconds;
        chrome.storage.sync.set({ [STORAGE_KEY]: limits }, () => {
          sendResponse({ success: true });
        });
      } else sendResponse({ success: false });
    });
    return true;
  }
});

// Ignore internal pages
function isInternalUrl(url) {
  return /^chrome:|^file:|^about:|^edge:|^moz-extension:|^chrome-extension:/.test(url);
}

// Listen for storage changes to update overlays
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && changes[STORAGE_KEY]) {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      tabs.forEach(tab => {
        if (tab.url && !isInternalUrl(tab.url)) {
          checkOverlay(tab.id, tab.url);
        }
      });
    });
  }
});

// Optional: notify when limit reached (ask user in options/popup to enable)
function notifyLimit(domain) {
  chrome.notifications.create({
    type: 'basic',
    iconUrl: 'icon128.png',
    title: "TimeBoxer",
    message: `You've reached your daily limit for ${domain}.`
  });
}

// Realtime alarm: update timer and check overlay every second
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'realtimeCheck' && currentTabId && currentWindowFocused && activeDomain) {
    chrome.tabs.get(currentTabId, (tab) => {
      if (!tab || !tab.url) return;
      const domain = normalizeDomain(tab.url);
      if (domain !== activeDomain) return;
      chrome.storage.sync.get([STORAGE_KEY], (data) => {
        const limits = data[STORAGE_KEY] || {};
        const site = limits[domain];
        if (site && site.isActive && site.lastStart) {
          const now = Date.now();
          const elapsed = Math.round((now - site.lastStart) / 1000);
          if (elapsed > 0) {
            site.usedSeconds += elapsed;
            site.lastStart = now;
            chrome.storage.sync.set({ [STORAGE_KEY]: limits }, () => {
              checkOverlay(currentTabId, tab.url);
            });
          } else {
            checkOverlay(currentTabId, tab.url);
          }
        }
      });
    });
  }
});