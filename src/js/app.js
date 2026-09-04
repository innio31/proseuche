import { registerRoute, startRouter } from './router.js';
import {
  renderSignIn,
  renderSignUp,
  renderToday,
  renderPrayers,
  renderPrayerBank,
  renderJournal,
  renderBible,
  renderTogether,
  renderJoin,
  renderSettings,
} from './views.js';
import { profile } from './store.js';
import { startReminderEngine, onReminderDue } from './reminders.js';
import { onInstallAvailabilityChange, canPromptInstall, promptInstall, isStandalone, isIOS } from './install.js';

registerRoute('#/signin', renderSignIn);
registerRoute('#/signup', renderSignUp);
registerRoute('#/today', renderToday);
registerRoute('#/prayers', renderPrayers);
registerRoute('#/prayer-bank', renderPrayerBank);
registerRoute('#/journal', renderJournal);
registerRoute('#/bible', renderBible);
registerRoute('#/bible/', renderBible);
registerRoute('#/together', renderTogether);
registerRoute('#/join/', renderJoin);
registerRoute('#/settings', renderSettings);

async function boot() {
  await profile.init(); // local identity always exists — no account required to start
  startRouter();
  startReminderEngine();
}

onReminderDue((label) => showReminderBanner(label));

function showReminderBanner(label) {
  let banner = document.getElementById('reminder-banner');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'reminder-banner';
    banner.style.cssText =
      'position:sticky;top:0;z-index:20;background:var(--accent);color:#201406;padding:12px 16px;font-weight:600;display:flex;justify-content:space-between;align-items:center;';
    document.getElementById('app').prepend(banner);
  }
  banner.innerHTML = `<span>🕯️ ${label}</span><button style="background:none;border:none;color:#201406;font-weight:700;font-size:1.1rem" id="dismiss-reminder">×</button>`;
  banner.querySelector('#dismiss-reminder').addEventListener('click', () => banner.remove());
}

boot();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((err) => console.warn('SW registration failed', err));
  });
}

/* ── Install banner ───────────────────────────────────────────────────
   Android/Chrome: shows once beforeinstallprompt has fired, lets the
   person trigger it on their own terms via a real button.
   iOS Safari: that event never fires, so we show manual instructions
   instead — this is a platform limit, not something we can prompt around. */

const DISMISS_KEY = 'proseuche_install_banner_dismissed';

function maybeShowInstallBanner() {
  if (isStandalone() || sessionStorage.getItem(DISMISS_KEY)) return;

  if (canPromptInstall()) {
    showInstallBanner('Add Proseuche to your home screen for quick access.', async () => {
      await promptInstall();
      removeInstallBanner();
    });
  } else if (isIOS()) {
    showInstallBanner('Install Proseuche: tap the Share icon, then "Add to Home Screen".', null);
  }
}

function showInstallBanner(text, onInstallClick) {
  removeInstallBanner();
  const banner = document.createElement('div');
  banner.id = 'install-banner';
  banner.style.cssText =
    'position:sticky;top:0;z-index:20;background:var(--bg-raised-2);border-bottom:1px solid var(--line);color:var(--text);padding:10px 14px;font-size:.85rem;display:flex;justify-content:space-between;align-items:center;gap:10px;';
  banner.innerHTML = `
    <span>${text}</span>
    <span style="display:flex;gap:8px;flex-shrink:0">
      ${onInstallClick ? '<button id="install-action" style="background:var(--accent);color:#201406;border:none;border-radius:6px;padding:6px 12px;font-weight:600">Install</button>' : ''}
      <button id="install-dismiss" style="background:none;border:none;color:var(--text-faint);font-size:1.1rem">×</button>
    </span>`;
  document.getElementById('app').prepend(banner);
  banner.querySelector('#install-action')?.addEventListener('click', onInstallClick);
  banner.querySelector('#install-dismiss').addEventListener('click', () => {
    sessionStorage.setItem(DISMISS_KEY, '1');
    removeInstallBanner();
  });
}

function removeInstallBanner() {
  document.getElementById('install-banner')?.remove();
}

onInstallAvailabilityChange(maybeShowInstallBanner);
window.addEventListener('load', () => setTimeout(maybeShowInstallBanner, 1200));
