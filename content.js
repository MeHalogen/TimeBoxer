// content.js
// Injects and manages the "Time's Up" overlay. Listens for messages from background.js to show/hide overlay.
// Handles Snooze and Close Tab actions, and blocks interaction under the overlay.

let overlay = null;

// Remove overlay if exists
function removeOverlay() {
  if (overlay) {
    overlay.remove();
    overlay = null;
    document.body.style.overflow = '';
  }
}

// Show overlay modal
function showOverlay(domain) {
  removeOverlay();

  overlay = document.createElement('div');
  overlay.id = 'timeboxer-overlay';
  overlay.tabIndex = -1;
  overlay.innerHTML = `
    <div class="timeboxer-modal" role="dialog" aria-modal="true" aria-label="Time's Up!">
      <button class="timeboxer-close" title="Close (Shift+Click for debug)">×</button>
      <div class="timeboxer-title">⏳ Time's Up!</div>
      <div class="timeboxer-text">You've used your daily limit for <b>${domain}</b>.<br>Take a short break!</div>
      <div class="timeboxer-actions">
        <button class="timeboxer-snooze">Snooze 5 minutes</button>
        <button class="timeboxer-closeTab">Close tab</button>
      </div>
    </div>
    <div class="timeboxer-backdrop"></div>
  `;
  document.body.appendChild(overlay);
  document.body.style.overflow = 'hidden';

  // Focus trap
  const modal = overlay.querySelector('.timeboxer-modal');
  modal.focus();

  // Snooze button
  overlay.querySelector('.timeboxer-snooze').onclick = () => {
    chrome.runtime.sendMessage({ action: 'snooze', domain });
    removeOverlay();
  };

  // Close tab button
  overlay.querySelector('.timeboxer-closeTab').onclick = () => {
    chrome.runtime.sendMessage({ action: 'closeTab' });
    removeOverlay();
  };

  // Close icon (debug only: Shift+Click)
  overlay.querySelector('.timeboxer-close').onclick = (e) => {
    if (e.shiftKey) removeOverlay();
  };

  // Prevent interaction under overlay
  overlay.querySelector('.timeboxer-backdrop').onclick = (e) => {
    e.stopPropagation();
    modal.focus();
  };

  // Trap tab key
  overlay.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      modal.focus();
    }
  });
}

// Listen for messages from background.js
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.action === 'showOverlay' && msg.domain) {
    showOverlay(msg.domain);
  }
  if (msg.action === 'hideOverlay' && msg.domain) {
    removeOverlay();
  }
});

// Remove overlay on navigation (just in case)
window.addEventListener('beforeunload', removeOverlay);