// Minimal promise wrapper around IndexedDB. No external library so the app
// stays a plain static site (no bundler needed for Netlify).

const DB_NAME = 'proseuche';
const DB_VERSION = 1;

let dbPromise = null;

export function openDB() {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = () => {
      const db = req.result;

      if (!db.objectStoreNames.contains('profile')) {
        db.createObjectStore('profile', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('categories')) {
        const s = db.createObjectStore('categories', { keyPath: 'clientId' });
        s.createIndex('serverId', 'serverId');
      }
      if (!db.objectStoreNames.contains('prayerPoints')) {
        const s = db.createObjectStore('prayerPoints', { keyPath: 'clientId' });
        s.createIndex('serverId', 'serverId');
        s.createIndex('categoryId', 'categoryId');
      }
      if (!db.objectStoreNames.contains('journalEntries')) {
        const s = db.createObjectStore('journalEntries', { keyPath: 'clientId' });
        s.createIndex('serverId', 'serverId');
      }
      if (!db.objectStoreNames.contains('bibleBooks')) {
        db.createObjectStore('bibleBooks', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('prayerBank')) {
        db.createObjectStore('prayerBank', { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains('meta')) {
        db.createObjectStore('meta', { keyPath: 'key' });
      }
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

  return dbPromise;
}

function promisify(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function getAll(storeName) {
  const db = await openDB();
  return promisify(db.transaction(storeName, 'readonly').objectStore(storeName).getAll());
}

export async function get(storeName, key) {
  const db = await openDB();
  return promisify(db.transaction(storeName, 'readonly').objectStore(storeName).get(key));
}

export async function put(storeName, value) {
  const db = await openDB();
  const tx = db.transaction(storeName, 'readwrite');
  tx.objectStore(storeName).put(value);
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve(value);
    tx.onerror = () => reject(tx.error);
  });
}

export async function del(storeName, key) {
  const db = await openDB();
  const tx = db.transaction(storeName, 'readwrite');
  tx.objectStore(storeName).delete(key);
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getByIndex(storeName, indexName, value) {
  const db = await openDB();
  return promisify(db.transaction(storeName, 'readonly').objectStore(storeName).index(indexName).get(value));
}

export function newId() {
  return (crypto.randomUUID ? crypto.randomUUID() : `id-${Date.now()}-${Math.random().toString(16).slice(2)}`);
}
