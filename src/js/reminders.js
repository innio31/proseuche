// Reminders, fully offline: this only ever reads local settings/prayer points
// and shows an in-app banner or a Notification. No network call is ever
// needed to decide "is it time to pray" or to display the reminder.
//
// Like the desktop app's ReminderService, this runs while the app is open
// (foreground or background tab) and catches up on anything missed as soon
// as the app is reopened. See web/README.md for why closed-app, exact-time,
// zero-connectivity reminders aren't reliably possible on mobile web.

import { settings as settingsStore } from './store.js';

const CHECK_INTERVAL_MS = 30_000;
const LAST_FIRED_KEY = 'proseuche_last_reminder_fired';

let onDue = null; // callback the UI registers to show its own in-app banner

export function onReminderDue(callback) {
  onDue = callback;
}

function minutesSinceMidnight(date) {
  return date.getHours() * 60 + date.getMinutes();
}

function parseHHMM(str) {
  const [h, m] = str.split(':').map(Number);
  return h * 60 + (m || 0);
}

async function checkDue() {
  const s = await settingsStore.get();
  const now = new Date();
  const nowMinutes = minutesSinceMidnight(now);
  const todayKey = now.toDateString();

  let due = false;
  let label = 'Time to pray';

  if (s.reminderMode === 'FixedTimes') {
    for (const t of s.defaultPrayerTimes || []) {
      const target = parseHHMM(t);
      // Fires within a 2-minute window of the target so a 30s poll doesn't miss it.
      if (Math.abs(nowMinutes - target) <= 1) {
        due = true;
        label = `Prayer time — ${t}`;
        break;
      }
    }
  } else if (s.reminderMode === 'Interval') {
    const everyMinutes = (s.intervalHours || 2) * 60;
    if (nowMinutes % everyMinutes < 1) due = true;
  }

  if (!due) return;

  const firedKey = `${todayKey}-${Math.floor(nowMinutes)}`;
  if (localStorage.getItem(LAST_FIRED_KEY) === firedKey) return; // already fired this exact minute
  localStorage.setItem(LAST_FIRED_KEY, firedKey);

  fireReminder(label);
}

function fireReminder(label) {
  if (onDue) onDue(label);

  if (document.visibilityState !== 'visible' && 'Notification' in window && Notification.permission === 'granted') {
    new Notification('Proseuche', { body: label, icon: '/icons/icon-192.png' });
  }
}

export async function requestNotificationPermission() {
  if (!('Notification' in window)) return 'unsupported';
  if (Notification.permission === 'granted' || Notification.permission === 'denied') return Notification.permission;
  return Notification.requestPermission();
}

export function startReminderEngine() {
  checkDue();
  setInterval(checkDue, CHECK_INTERVAL_MS);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') checkDue(); // catch up immediately on reopen
  });
}
