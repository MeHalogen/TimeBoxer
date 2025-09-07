// background.js
// TimeBoxer Service Worker: Handles timer logic, domain normalization, daily reset, storage updates, and messaging with content/popup/options scripts.

const STORAGE_KEY = 'siteLimits';
const USAGE_HISTORY_KEY = 'usageHistory';
let currentHistoryDomain = null;
let historyLastStart = null;

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
              history: [],
              snoozeCount: 0
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

// Usage history tracking
// Periodically flush history timer every 10 seconds
chrome.alarms.create('historyFlush', { periodInMinutes: 1/6 }); // every 10 seconds

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'historyFlush') {
    pauseHistoryTimer();
    // If still on the same domain, restart timer
    if (currentHistoryDomain) {
      startHistoryTimer(currentHistoryDomain);
    }
  }
});
// Flush history timer when tab is closed
chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
  pauseHistoryTimer();
});

// Flush history timer when extension is unloaded (service worker is terminated)
self.addEventListener('unload', () => {
  pauseHistoryTimer();
});
// Only one declaration for usage history tracking variables

function normalizeDomainForHistory(url) {
  try {
    if (url.startsWith('chrome://')) {
      return url.replace('chrome://', '').replace(/\//g, '-');
    }
    const hostname = new URL(url).hostname.replace(/^www\./, '').toLowerCase();
    return hostname || url;
  } catch (e) {
    console.error('[TimeBoxer] normalizeDomainForHistory ERROR:', url, e);
    return null; // Return null for invalid URLs
  }
}

function validateDomain(domain) {
  return domain && domain !== 'null' && domain.trim() !== '';
}

function startHistoryTimer(domain) {
  if (!validateDomain(domain)) {
    return;
  }
  chrome.windows.getCurrent({ populate: false }, (win) => {
    if (!win || !win.focused) {
      return;
    }
    currentHistoryDomain = domain;
    historyLastStart = Date.now();
  });
}

// Ensure usageHistory is updated correctly
function updateUsageHistory(domain, elapsed) {
  chrome.storage.sync.get([USAGE_HISTORY_KEY], (data) => {
    const history = data[USAGE_HISTORY_KEY] || {};
    if (!history[domain]) {
      history[domain] = { usedSeconds: 0 };
    }
    history[domain].usedSeconds += elapsed;
    chrome.storage.sync.set({ [USAGE_HISTORY_KEY]: history }, () => {
      console.log('[TimeBoxer] updateUsageHistory: Updated history for domain:', domain, 'Elapsed seconds:', elapsed);
    });
  });
}

// Update pauseHistoryTimer to use updateUsageHistory
function pauseHistoryTimer() {
  if (!validateDomain(currentHistoryDomain) || !historyLastStart) {
    console.warn('[TimeBoxer] pauseHistoryTimer: Skipping invalid domain', currentHistoryDomain);
    currentHistoryDomain = null;
    historyLastStart = null;
    return;
  }
  const elapsed = Math.round((Date.now() - historyLastStart) / 1000);
  updateUsageHistory(currentHistoryDomain, elapsed);
  currentHistoryDomain = null;
  historyLastStart = null;
}

// Tab activated: pause previous, start new
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  pauseHistoryTimer();
  pauseAllDomains(() => {
    chrome.tabs.get(activeInfo.tabId, (tab) => {
      if (!tab || !tab.url || !(tab.url.startsWith('http://') || tab.url.startsWith('https://'))) {
        console.warn('[TimeBoxer] Invalid tab URL:', tab?.url);
        return;
      }
      const domain = normalizeDomainForHistory(tab.url);
      if (!domain) {
        console.warn('[TimeBoxer] Failed to normalize domain:', tab.url);
        return;
      }
      chrome.windows.get(tab.windowId, {}, (win) => {
        if (!win || !win.focused) {
          console.warn('[TimeBoxer] Window not focused:', win);
          return;
        }
        startHistoryTimer(domain);
        activateDomain(domain);
      });
    });
  });
});

// Tab updated: start timer if status complete and tab is active
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.active && tab.url && (tab.url.startsWith('http://') || tab.url.startsWith('https://'))) {
    pauseHistoryTimer();
    pauseAllDomains(() => {
      const domain = normalizeDomainForHistory(tab.url);
      if (!domain) {
        console.warn('[TimeBoxer] Failed to normalize domain:', tab.url);
        return;
      }
      chrome.windows.get(tab.windowId, {}, (win) => {
        if (!win || !win.focused) {
          console.warn('[TimeBoxer] Window not focused:', win);
          return;
        }
        startHistoryTimer(domain);
        activateDomain(domain);
      });
    });
  }
});

// Window focus changed: pause if unfocused, start if focused
chrome.windows.onFocusChanged.addListener((windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) {
    pauseHistoryTimer();
    pauseAllDomains();
  } else {
    chrome.windows.get(windowId, { populate: true }, (win) => {
      if (!win || !win.focused) {
        pauseHistoryTimer();
        pauseAllDomains();
        return;
      }
      const activeTab = win.tabs.find(t => t.active && t.url && (t.url.startsWith('http://') || t.url.startsWith('https://')));
      if (activeTab) {
        const domain = normalizeDomainForHistory(activeTab.url);
        if (!domain) return;
        pauseHistoryTimer();
        pauseAllDomains(() => {
          startHistoryTimer(domain);
          activateDomain(domain);
        });
      }
    });
  }
});

// Content script message listener: update limits or snooze
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'updateLimit') {
    const { domain, limitSeconds } = message;
    chrome.storage.sync.get([STORAGE_KEY], (data) => {
      const limits = data[STORAGE_KEY] || {};
      if (limits[domain]) {
        limits[domain].limitSeconds = limitSeconds;
        chrome.storage.sync.set({ [STORAGE_KEY]: limits }, () => {
          sendResponse({ success: true });
        });
      } else {
        sendResponse({ success: false, error: 'Domain not found' });
      }
    });
    return true; // Async response
  } else if (message.action === 'snooze') {
    const { domain, minutes } = message;
    chrome.storage.sync.get([STORAGE_KEY], (data) => {
      const limits = data[STORAGE_KEY] || {};
      if (limits[domain]) {
        limits[domain].snoozedUntil = Date.now() + minutes * 60 * 1000;
        chrome.storage.sync.set({ [STORAGE_KEY]: limits }, () => {
          // If snoozed from active state, pause the domain
          if (limits[domain].isActive) {
            pauseAllDomains();
          }
          sendResponse({ success: true });
        });
      } else {
        sendResponse({ success: false, error: 'Domain not found' });
      }
    });
    return true; // Async response
  }
});

// Realtime check: update overlay every minute
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'realtimeCheck') {
    // Only check overlays, do not write timer values to storage
    chrome.storage.sync.get([STORAGE_KEY], (data) => {
      const limits = data[STORAGE_KEY] || {};
      let activeDomainFound = false;
      Object.keys(limits).forEach(domain => {
        const site = limits[domain];
        if (site.isActive && site.lastStart) {
          activeDomainFound = true;
          // Check if limit exceeded
          if (site.usedSeconds >= site.limitSeconds && (!site.snoozedUntil || site.snoozedUntil <= Date.now())) {
            // Limit exceeded, pause domain
            site.isActive = false;
            site.lastStart = null;
            // Only update overlays, do not write to storage here
            chrome.tabs.query({ url: `*://${domain}/*` }, (tabs) => {
              tabs.forEach(tab => {
                checkOverlay(tab.id, tab.url);
              });
            });
          }
        }
      });
      // If no active domain found, clear the alarm
      if (!activeDomainFound) {
        chrome.alarms.clear('realtimeCheck');
        realtimeAlarmActive = false;
      }
    });
  }
});