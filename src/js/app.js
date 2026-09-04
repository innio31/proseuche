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
