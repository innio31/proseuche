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

  // ── Theme support ──
  const savedTheme = localStorage.getItem('proseuche_theme');
  if (savedTheme && savedTheme !== 'system') {
    document.documentElement.setAttribute('data-theme', savedTheme);
  } else if (savedTheme === 'system') {
    document.documentElement.removeAttribute('data-theme');
  }

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
      'position:sticky;top:0;z-index:20;background:var(--accent);color:#201406;padding:12px 16px;font-weight:600;display:flex;justify-content:space-between;align-items:center;gap:12px;';
    document.getElementById('app').prepend(banner);
  }
  banner.innerHTML = `
    <span class="reminder-icon">🕯️</span>
    <span class="reminder-text">${label}</span>
    <button style="background:none;border:none;color:#201406;font-weight:700;font-size:1.2rem;padding:4px 8px;cursor:pointer" id="dismiss-reminder">×</button>
  `;
  banner.querySelector('#dismiss-reminder').addEventListener('click', () => banner.remove());
}

boot();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((err) => console.warn('SW registration failed', err));
  });
}

/* ── Install banner ── */
const DISMISS_KEY = 'proseuche_install_banner_dismissed';

function maybeShowInstallBanner() {
  if (isStandalone() || sessionStorage.getItem(DISMISS_KEY)) return;

  if (canPromptInstall()) {
    showInstallBanner('Add <strong>Proseuche</strong> to your home screen for quick access.', async () => {
      await promptInstall();
      removeInstallBanner();
    });
  } else if (isIOS()) {
    showInstallBanner('Install <strong>Proseuche</strong>: tap the Share icon, then "Add to Home Screen".', null);
  }
}

function showInstallBanner(text, onInstallClick) {
  removeInstallBanner();
  const banner = document.createElement('div');
  banner.id = 'install-banner';
  banner.innerHTML = `
    <span class="install-text">${text}</span>
    <span style="display:flex;gap:8px;flex-shrink:0">
      ${onInstallClick ? '<button class="btn btn-primary btn-sm" id="install-action" style="width:auto;padding:6px 16px">Install</button>' : ''}
      <button class="btn-ghost" id="install-dismiss" style="font-size:1.2rem;padding:4px 8px">×</button>
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
