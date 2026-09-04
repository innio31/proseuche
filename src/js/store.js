// Local-first data layer. Every read/write here hits IndexedDB first and
// returns instantly, online or not. Sync with the server (impactdigitalacademy.com.ng)
// happens separately, in the background, only when: the device is online AND
// the local profile has been linked to an account (Settings → Account & Sync).
//
// Personal use never requires an account. Signing in only unlocks sync +
// the Together (group) feature, which is inherently online-only.

import * as db from './db-local.js';
import { api, isSignedIn, API_BASE } from './api.js';

const PROFILE_KEY = 'local';
const SETTINGS_KEY = 'local';

/* ── Profile (local identity, account-linking optional) ─────── */

export const profile = {
  async init() {
    let p = await db.get('profile', PROFILE_KEY);
    if (!p) {
      p = { id: PROFILE_KEY, name: 'Friend', linked: false, createdAt: Date.now() };
      await db.put('profile', p);
    }
    return p;
  },
  async get() {
    return (await db.get('profile', PROFILE_KEY)) || profile.init();
  },
  // Call after a successful sign-in/sign-up: marks the local profile as
  // linked to a real account and does an initial two-way sync.
  async linkToAccount(user) {
    const p = await profile.get();
    p.linked = true;
    p.name = user.name;
    await db.put('profile', p);
    await sync.run();
    return p;
  },
  async isLinked() {
    return (await profile.get()).linked;
  },
};

/* ── Settings ─────────────────────────────────────────────── */

const DEFAULT_SETTINGS = {
  id: SETTINGS_KEY,
  reminderMode: 'FixedTimes',
  defaultPrayerTimes: ['06:00', '12:00', '18:00'],
  intervalHours: 2,
  theme: 'Dark',
  playReminderSound: true,
  dirty: false,
};

export const settings = {
  async get() {
    return (await db.get('settings', SETTINGS_KEY)) || (await db.put('settings', { ...DEFAULT_SETTINGS }));
  },
  async update(patch) {
    const current = await settings.get();
    const next = { ...current, ...patch, dirty: true };
    await db.put('settings', next);
    sync.runSoon();
    return next;
  },
};

/* ── Categories ───────────────────────────────────────────── */

export const categories = {
  async list() {
    const all = await db.getAll('categories');
    return all.filter((c) => !c.deleted);
  },
  async create({ name, color }) {
    const record = {
      clientId: db.newId(),
      serverId: null,
      name,
      color: color || '#3498DB',
      dirty: true,
      deleted: false,
      updatedAt: Date.now(),
    };
    await db.put('categories', record);
    sync.runSoon();
    return record;
  },
};

/* ── Prayer points ────────────────────────────────────────── */

function isPrayedToday(record) {
  if (!record.lastPrayedDate) return false;
  return new Date(record.lastPrayedDate).toDateString() === new Date().toDateString();
}

export const prayerPoints = {
  async list(categoryClientId) {
    const all = await db.getAll('prayerPoints');
    return all
      .filter((p) => !p.deleted && (!categoryClientId || p.categoryClientId === categoryClientId))
      .map((p) => ({ ...p, isPrayedToday: isPrayedToday(p) }))
      .sort((a, b) => b.createdAt - a.createdAt);
  },
  async random() {
    const list = await prayerPoints.list();
    const unprayed = list.filter((p) => !p.isPrayedToday);
    if (!unprayed.length) return null;
    return unprayed[Math.floor(Math.random() * unprayed.length)];
  },
  async create({ title, scripture, prayerText, notes, categoryClientId }) {
    const record = {
      clientId: db.newId(),
      serverId: null,
      title,
      scripture: scripture || null,
      prayerText: prayerText || null,
      notes: notes || null,
      categoryClientId: categoryClientId || null,
      lastPrayedDate: null,
      createdAt: Date.now(),
      dirty: true,
      deleted: false,
    };
    await db.put('prayerPoints', record);
    sync.runSoon();
    return record;
  },
  async markPrayed(clientId) {
    const record = await db.get('prayerPoints', clientId);
    if (!record) return null;
    record.lastPrayedDate = new Date().toISOString();
    record.dirty = true;
    record.prayedDirty = true;
    await db.put('prayerPoints', record);
    sync.runSoon();
    return record;
  },
  async remove(clientId) {
    const record = await db.get('prayerPoints', clientId);
    if (!record) return;
    if (record.serverId) {
      record.deleted = true;
      record.dirty = true;
      await db.put('prayerPoints', record);
      sync.runSoon();
    } else {
      await db.del('prayerPoints', clientId);
    }
  },
};

/* ── Journal ──────────────────────────────────────────────── */

export const journal = {
  async list() {
    const [entries, points] = await Promise.all([db.getAll('journalEntries'), db.getAll('prayerPoints')]);
    const titleFor = (clientId) => points.find((p) => p.clientId === clientId)?.title || '(deleted prayer point)';
    return entries
      .filter((e) => !e.deleted)
      .map((e) => ({ ...e, prayerPointTitle: titleFor(e.prayerPointClientId) }))
      .sort((a, b) => b.date - a.date);
  },
  async create({ prayerPointClientId, notes, durationMinutes }) {
    const record = {
      clientId: db.newId(),
      serverId: null,
      prayerPointClientId,
      notes: notes || null,
      durationMinutes: durationMinutes || 0,
      date: Date.now(),
      dirty: true,
      deleted: false,
    };
    await db.put('journalEntries', record);
    await prayerPoints.markPrayed(prayerPointClientId);
    sync.runSoon();
    return record;
  },
};

/* ── Prayer bank (reference data, cached once, imported fully offline) ── */

export const prayerBank = {
  async get() {
    const cached = await db.get('prayerBank', 'kjv-bank');
    if (cached) return cached.data;
    if (!navigator.onLine) return null;
    const data = await api.prayerBank.get();
    await db.put('prayerBank', { key: 'kjv-bank', data, cachedAt: Date.now() });
    return data;
  },
  // Importing is pure local copying — no server round trip needed, works offline
  // as long as the bank was cached at least once before.
  async import(categoryName, titles) {
    const bank = await prayerBank.get();
    if (!bank) throw new Error('Prayer bank not downloaded yet — connect to the internet once to fetch it.');
    const category = bank.PrayerCategories.find((c) => c.Name === categoryName);
    if (!category) throw new Error('Category not found.');

    const toImport = titles?.length ? category.Prayers.filter((p) => titles.includes(p.Title)) : category.Prayers;

    const existingCategories = await categories.list();
    let local = existingCategories.find((c) => c.name === category.Name);
    if (!local) local = await categories.create({ name: category.Name, color: category.Color });

    for (const prayer of toImport) {
      await prayerPoints.create({
        title: prayer.Title,
        scripture: prayer.Scripture,
        prayerText: prayer.PrayerText,
        notes: prayer.Notes,
        categoryClientId: local.clientId,
      });
    }
    return toImport.length;
  },
};

/* ── Bible (downloaded once, fully offline afterwards) ───────── */

export const bible = {
  async isDownloaded() {
    return !!(await db.get('meta', 'bibleDownloaded'));
  },
  async download() {
    if (!navigator.onLine) throw new Error('Connect to the internet once to download the Bible (about 1–2 MB).');
    const res = await fetch(`${API_BASE}/bible`);
    if (!res.ok) throw new Error('Could not download the Bible right now.');
    const data = await res.json();
    for (const book of data.books) {
      await db.put('bibleBooks', book);
    }
    await db.put('meta', { key: 'bibleDownloaded', value: true, at: Date.now() });
  },
  async listBooks() {
    const books = await db.getAll('bibleBooks');
    return books
      .map((b) => ({ id: b.id, name: b.name, abbr: b.abbr, chapterCount: b.chapterCount, testament: b.testament }))
      .sort((a, b) => a.id - b.id);
  },
  async getChapter(bookId, chapter) {
    const book = await db.get('bibleBooks', Number(bookId));
    if (!book) return null;
    return { book: book.name, chapter: Number(chapter), verses: book.chapters[String(chapter)] || null };
  },
};



/* ── Sync engine ──────────────────────────────────────────── */

let syncTimer = null;

export const sync = {
  runSoon() {
    clearTimeout(syncTimer);
    syncTimer = setTimeout(() => sync.run().catch((err) => console.warn('sync failed', err)), 1500);
  },

  async status() {
    const meta = await db.get('meta', 'lastSyncAt');
    return { lastSyncAt: meta?.value || null, linked: await profile.isLinked(), online: navigator.onLine };
  },

  async run() {
    if (!navigator.onLine || !isSignedIn() || !(await profile.isLinked())) {
      return { skipped: true };
    }

    await pushCategories();
    await pushPrayerPoints();
    await pushJournal();
    await pushSettings();

    await pullAll();

    await db.put('meta', { key: 'lastSyncAt', value: Date.now() });
    return { skipped: false };
  },
};

async function pushCategories() {
  const all = await db.getAll('categories');
  for (const c of all.filter((c) => c.dirty)) {
    if (c.deleted) {
      c.dirty = false; // no server delete endpoint wired for categories yet — safe to just stop tracking
      await db.put('categories', c);
      continue;
    }
    if (!c.serverId) {
      const { category } = await api.categories.create({ name: c.name, color: c.color });
      c.serverId = category.id;
    } else {
      await api.categories.update(c.serverId, { name: c.name, color: c.color });
    }
    c.dirty = false;
    await db.put('categories', c);
  }
}

async function resolveCategoryServerId(categoryClientId) {
  if (!categoryClientId) return null;
  const cat = await db.get('categories', categoryClientId);
  return cat?.serverId || null;
}

async function pushPrayerPoints() {
  const all = await db.getAll('prayerPoints');
  for (const p of all.filter((p) => p.dirty)) {
    if (p.deleted) {
      if (p.serverId) await api.prayerPoints.remove(p.serverId).catch(() => {});
      await db.del('prayerPoints', p.clientId);
      continue;
    }
    const categoryId = await resolveCategoryServerId(p.categoryClientId);
    if (!p.serverId) {
      const { prayerPoint } = await api.prayerPoints.create({
        title: p.title, scripture: p.scripture, prayerText: p.prayerText, notes: p.notes, categoryId,
      });
      p.serverId = prayerPoint.id;
    } else {
      await api.prayerPoints.update(p.serverId, {
        title: p.title, scripture: p.scripture, prayerText: p.prayerText, notes: p.notes, categoryId,
      });
    }
    if (p.prayedDirty && p.serverId) {
      await api.prayerPoints.markPrayed(p.serverId);
      p.prayedDirty = false;
    }
    p.dirty = false;
    await db.put('prayerPoints', p);
  }
}

async function pushJournal() {
  const all = await db.getAll('journalEntries');
  for (const e of all.filter((e) => e.dirty)) {
    const point = await db.get('prayerPoints', e.prayerPointClientId);
    if (!point?.serverId) continue; // wait until the prayer point itself has synced
    const { id } = await api.journal.create({
      prayerPointId: point.serverId, notes: e.notes, durationMinutes: e.durationMinutes,
    });
    e.serverId = id;
    e.dirty = false;
    await db.put('journalEntries', e);
  }
}

async function pushSettings() {
  const s = await settings.get();
  if (!s.dirty) return;
  await api.settings.update({
    reminderMode: s.reminderMode,
    defaultPrayerTimes: s.defaultPrayerTimes,
    intervalHours: s.intervalHours,
  });
  s.dirty = false;
  await db.put('settings', s);
}

async function pullAll() {
  const [{ categories: remoteCats }, { prayerPoints: remotePoints }, { settings: remoteSettings }] = await Promise.all([
    api.categories.list(),
    api.prayerPoints.list(),
    api.settings.get(),
  ]);

  const localCats = await db.getAll('categories');
  for (const rc of remoteCats) {
    const existing = localCats.find((c) => c.serverId === rc.id);
    if (existing && !existing.dirty) {
      await db.put('categories', { ...existing, name: rc.name, color: rc.color });
    } else if (!existing) {
      await db.put('categories', {
        clientId: db.newId(), serverId: rc.id, name: rc.name, color: rc.color, dirty: false, deleted: false, updatedAt: Date.now(),
      });
    }
  }

  const refreshedCats = await db.getAll('categories');
  const localPoints = await db.getAll('prayerPoints');
  for (const rp of remotePoints) {
    const categoryClientId = refreshedCats.find((c) => c.serverId === rp.categoryId)?.clientId || null;
    const existing = localPoints.find((p) => p.serverId === rp.id);
    if (existing && !existing.dirty) {
      await db.put('prayerPoints', {
        ...existing,
        title: rp.title, scripture: rp.scripture, prayerText: rp.prayerText, notes: rp.notes,
        lastPrayedDate: rp.lastPrayedDate, categoryClientId,
      });
    } else if (!existing) {
      await db.put('prayerPoints', {
        clientId: db.newId(), serverId: rp.id, title: rp.title, scripture: rp.scripture,
        prayerText: rp.prayerText, notes: rp.notes, categoryClientId, lastPrayedDate: rp.lastPrayedDate,
        createdAt: new Date(rp.createdDate).getTime() || Date.now(), dirty: false, deleted: false,
      });
    }
  }

  const localSettings = await settings.get();
  if (!localSettings.dirty) {
    await db.put('settings', { ...localSettings, ...remoteSettings, dirty: false });
  }
}

// Fire a sync whenever connectivity returns or the app comes back to the foreground.
window.addEventListener('online', () => sync.runSoon());
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') sync.runSoon();
});
