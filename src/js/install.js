// Wraps the PWA install flow. Chrome/Android fire `beforeinstallprompt` and let
// us trigger it ourselves on a button tap (more reliable than waiting on the
// browser's own mini-infobar, which has its own engagement heuristics and won't
// show at all if the manifest/service worker aren't both valid).
//
// iOS Safari never fires this event — there is no programmatic install prompt
// there, period. The only path is Share → Add to Home Screen, so on iOS we show
// instructions instead of a button.

let deferredPrompt = null;
let listeners = [];

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  listeners.forEach((cb) => cb());
});

window.addEventListener('appinstalled', () => {
  deferredPrompt = null;
  listeners.forEach((cb) => cb());
});

export function onInstallAvailabilityChange(cb) {
  listeners.push(cb);
}

export function canPromptInstall() {
  return !!deferredPrompt;
}

export function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}

export function isIOS() {
  return /iphone|ipad|ipod/i.test(window.navigator.userAgent);
}

export async function promptInstall() {
  if (!deferredPrompt) return 'unavailable';
  deferredPrompt.prompt();
  const { outcome } = await deferredPrompt.userChoice;
  deferredPrompt = null;
  return outcome; // 'accepted' | 'dismissed'
}
