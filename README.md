# Proseuche Web (PWA)

Plain HTML/CSS/JS — no bundler. Deploys to Netlify with zero build configuration
(`netlify.toml` has `command = ""`). If it outgrows this later, `api.js`/`store.js`
are the only modules that touch the network/IndexedDB, so the UI layer can be
rebuilt around them without touching data logic.

## Architecture: local-first

```
views.js  →  store.js  →  db-local.js (IndexedDB)
                ↕
             api.js  →  server/ (only when online + signed in)
```

- **`db-local.js`** — thin promise wrapper over raw IndexedDB. No library.
- **`store.js`** — the actual data layer the UI talks to. Every function reads/writes
  IndexedDB directly and resolves instantly. `sync.run()` is the only place that
  talks to the network, and only runs when `navigator.onLine` is true *and* the
  local profile has been linked to an account.
- **`api.js`** — raw HTTP client for `server/`. Used directly by `store.js` (for
  sync) and by `views.js` for the two things that are inherently online-only:
  auth and Together (group appointments).
- **`reminders.js`** — polls local settings/prayer points every 30s and fires an
  in-app banner (+ a `Notification` if the tab isn't focused and permission was
  granted). Needs no network at all. Runs while the app is open; catches up on
  anything missed as soon as it's reopened. See the note in that file on why
  closed-app, exact-time reminders aren't reliably possible on mobile web — it's
  a background-execution limitation of the platform (especially iOS Safari PWAs),
  not something more code fixes.

### No account required

Opening the app for the first time silently creates a local profile
(`store.profile.init()`) — nothing is sent anywhere. Prayer points, categories,
journal, settings, and the Bible all work immediately, offline, forever, with no
sign-up. Signing in from **Settings → Account & Sync**:
1. Links the local profile to a real account on `server/`.
2. Pushes anything created offline up to the server.
3. Pulls down anything already on the server (e.g. if signing in on a second device).
4. Unlocks **Together**, which requires an account and a connection by nature —
   scheduling a session other people join can't work offline.

### Data that needs a one-time download

The Bible (KJV, ~1–2 MB compressed) and the prayer bank are static reference data.
The app fetches each once while online and caches it fully in IndexedDB
(`bibleBooks` / `prayerBank` stores) — after that first fetch, both work with the
device in airplane mode.

## Local preview

Any static file server works:

```bash
cd web/src
npx serve .
# or: python3 -m http.server 8080
```

Point it at your local API instead of production by setting, before `app.js`
loads (see the comment in `index.html`):
```html
<script>window.PROSEUCHE_API_BASE = 'http://localhost:4000/proseuche';</script>
```

## Deploying to Netlify

1. Push this repo (or just `web/`) to GitHub.
2. New site from Git in Netlify → it reads `netlify.toml` automatically
   (publish directory `src`, no build command).
3. On the API side, set `CORS_ORIGIN` in `server/.env` to your Netlify URL.

## Screens

| Route | Needs account/internet? | Notes |
|---|---|---|
| `#/today` | No | Daily focus (random unprayed point) + upcoming sessions if signed in |
| `#/prayers` | No | List, add, mark prayed |
| `#/prayer-bank` | Only the first time (to download) | Import is pure local copy after that |
| `#/journal` | No | |
| `#/bible` | Only the first time (to download) | |
| `#/settings` | No, except the Account & Sync card | Reminder config, sign in/out, manual sync |
| `#/together` | Yes | Create/list appointments, generate invite links |
| `#/join/:code` | No to preview; yes to accept | Works for guests, prompts sign-up, then auto-accepts |
| `#/signin`, `#/signup` | — | Optional, reachable from Settings or a join link |

## Not yet built

- **The live session screen** — host pushing the current agenda item to everyone
  in real time, plus the Jitsi voice handoff. Needs a realtime mechanism now that
  Supabase is off the table; see the root README's build-order note for the options
  (simple polling vs. a small WebSocket server).
- Push notifications for upcoming appointments (separate from the offline personal
  reminders, which are already live) — needs VAPID keys + a subscription-storage
  endpoint on `server/`.
- Real app icons — the ones in `icons/` are programmatically generated placeholders.
- Editing/deleting existing prayer points and categories from the UI (the data
  layer supports updates; there's just no edit form yet, only add + mark prayed).
