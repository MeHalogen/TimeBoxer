# TimeBoxer

**A Chrome extension to help you timebox your daily usage of distracting sites. Track, snooze, and take friendly breaks.**

---

## Features

- Add any site (by domain) and set a daily time budget (minutes).
- Timer only counts when a tab of that site is focused and the window is active.
- Friendly overlay appears when you reach your daily limit, with "Snooze 5 minutes" and "Close tab" options.
- Real-time usage stats in popup and full dashboard (options page).
- All data is synced via `chrome.storage.sync` and resets at local midnight.
- Import/export settings, manual and global reset, and usage history (last 7 days).
- Clean, modern UI with progress bars and accessible overlays.

---

## Install & Load Unpacked

1. **Clone or download this repo.**
2. Open `chrome://extensions` in Chrome.
3. Enable "Developer mode" (top right).
4. Click "Load unpacked" and select the `TimeBoxer` folder.
5. The extension icon will appear in your toolbar.

---

## How to Test

- **Add a site:** Click the extension icon, then "+ Add Site" to open the dashboard. Add e.g. `youtube.com` with 3 minutes.
- **Timer behavior:** Open a tab for `youtube.com`. Timer starts only when tab is focused and window is active. Switch away or minimize to pause.
- **Limit reached:** After 3 minutes, overlay appears. Click "Snooze 5 minutes" to add time, or "Close tab" to exit.
- **Real-time updates:** Popup and dashboard update instantly as you use time.
- **Midnight reset:** Usage resets automatically at local midnight.
- **Manual reset:** Use "Reset" buttons in dashboard for per-site or global reset.
- **Import/export:** Use "Export" to save settings, "Import" to restore.

---

## Debugging & Troubleshooting

- **Service Worker logs:**  
  Go to `chrome://extensions`, find TimeBoxer, and click "Service worker" under "Inspect views" to open the console.  
  All timer logic and events are logged here.

- **Simulate time / midnight:**  
  In the dashboard, use the "Simulate time" feature (if enabled) or manually adjust `usedSeconds` in storage via the console for testing overlays and resets.

- **Common issue: Service Worker terminated**  
  Chrome may suspend the service worker when idle. TimeBoxer uses a timestamp approach:  
  - When a site becomes active, it records `lastStart = Date.now()`.  
  - When inactive, it calculates elapsed time and adds to `usedSeconds`.  
  - This ensures accurate tracking even if the service worker is suspended.

- **Inspect storage:**  
  Use the console in the service worker or dashboard to view `chrome.storage.sync` contents.  
  All site data is under the `siteLimits` key.

- **Internal pages:**  
  The extension ignores `chrome://`, `file://`, and extension pages.

- **Quota exceeded?**  
  If you hit Chrome sync quota, fallback to `chrome.storage.local` (not implemented by default).

---

## Development

- All code is in plain JS/CSS/HTML, no build step required.
- Icons: Add your own PNGs for `icon16.png`, `icon32.png`, `icon48.png`, `icon128.png` (or use placeholders).
- For UI tweaks, edit `styles.css`, `options.css`, or `popup.css`.

---

## Feedback & Contributions

Open issues or PRs for bugs, features, or improvements!

---

Done.