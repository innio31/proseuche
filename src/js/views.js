import { api, setSession, clearSession, isSignedIn } from './api.js';
import { profile as profileStore, settings as settingsStore, categories as categoriesStore,
         prayerPoints as prayerPointsStore, journal as journalStore, prayerBank as prayerBankStore,
         bible as bibleStore, sync } from './store.js';
import { navigate, escapeHtml } from './router.js';
import { requestNotificationPermission } from './reminders.js';

function fmtDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

/* ── Auth (only needed for sync + Together) ──────────────────────────── */

export function renderSignIn(root) {
  root.innerHTML = `
    <div class="screen stack">
      <div>
        <p class="eyebrow">Sync &amp; group prayer</p>
        <h1>Sign in</h1>
        <p style="color:var(--text-dim)">Your personal prayer points already work offline without an account. Sign in to back them up and use Together.</p>
      </div>
      <form id="signin-form" class="stack">
        <div class="field"><label for="email">Email</label><input id="email" type="email" required autocomplete="email" /></div>
        <div class="field"><label for="password">Password</label><input id="password" type="password" required autocomplete="current-password" /></div>
        <button class="btn btn-primary" type="submit">Sign in</button>
        <div class="error-text" id="signin-error" hidden></div>
      </form>
      <button class="btn-text" id="go-signup">New here? Create an account</button>
      <button class="btn-text" id="go-back">Not now</button>
    </div>`;

  root.querySelector('#go-signup').addEventListener('click', () => navigate('#/signup'));
  root.querySelector('#go-back').addEventListener('click', () => navigate('#/settings'));
  root.querySelector('#signin-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = root.querySelector('#email').value.trim();
    const password = root.querySelector('#password').value;
    const errBox = root.querySelector('#signin-error');
    errBox.hidden = true;
    try {
      const { token, user } = await api.auth.login(email, password);
      setSession(token, user);
      await profileStore.linkToAccount(user);
      await landAfterAuth();
    } catch (err) {
      errBox.textContent = err.message;
      errBox.hidden = false;
    }
  });
}

export function renderSignUp(root) {
  root.innerHTML = `
    <div class="screen stack">
      <div>
        <p class="eyebrow">Sync &amp; group prayer</p>
        <h1>Create an account</h1>
        <p style="color:var(--text-dim)">This links your existing local prayer points to the cloud so they're backed up, and unlocks Together.</p>
      </div>
      <form id="signup-form" class="stack">
        <div class="field"><label for="name">Name</label><input id="name" type="text" placeholder="Prayer Warrior" /></div>
        <div class="field"><label for="email">Email</label><input id="email" type="email" required autocomplete="email" /></div>
        <div class="field"><label for="password">Password</label><input id="password" type="password" required minlength="8" autocomplete="new-password" /></div>
        <button class="btn btn-primary" type="submit">Create account</button>
        <div class="error-text" id="signup-error" hidden></div>
      </form>
      <button class="btn-text" id="go-signin">Already have an account? Sign in</button>
      <button class="btn-text" id="go-back">Not now</button>
    </div>`;

  root.querySelector('#go-signin').addEventListener('click', () => navigate('#/signin'));
  root.querySelector('#go-back').addEventListener('click', () => navigate('#/settings'));
  root.querySelector('#signup-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = root.querySelector('#name').value.trim();
    const email = root.querySelector('#email').value.trim();
    const password = root.querySelector('#password').value;
    const errBox = root.querySelector('#signup-error');
    errBox.hidden = true;
    try {
      const { token, user } = await api.auth.signup(email, password, name);
      setSession(token, user);
      await profileStore.linkToAccount(user);
      await landAfterAuth();
    } catch (err) {
      errBox.textContent = err.message;
      errBox.hidden = false;
    }
  });
}

async function landAfterAuth() {
  const pendingCode = sessionStorage.getItem('proseuche_pending_invite');
  if (pendingCode) {
    sessionStorage.removeItem('proseuche_pending_invite');
    try { await api.appointments.acceptInvite(pendingCode); } catch { /* they can retry from the join screen */ }
    navigate(`#/join/${pendingCode}`);
    return;
  }
  navigate('#/settings');
}

/* ── Today ────────────────────────────────────────────────────────────── */

export async function renderToday(root) {
  const profile = await profileStore.get();
  const focus = await prayerPointsStore.random();

  let upcoming = [];
  if (isSignedIn()) {
    try {
      const { appointments } = await api.appointments.list();
      upcoming = appointments.filter((a) => a.status !== 'completed' && a.status !== 'cancelled').slice(0, 2);
    } catch { /* non-fatal on the home screen */ }
  }

  root.innerHTML = `
    <div class="screen stack">
      <div>
        <p class="eyebrow">${greeting()}</p>
        <h1>${escapeHtml(profile.name || 'Friend')}</h1>
      </div>

      <div class="card">
        <p class="eyebrow">Today's focus</p>
        ${focus ? `
          <h3>${escapeHtml(focus.title)}</h3>
          ${focus.scripture ? `<p class="scripture">${escapeHtml(focus.scripture)}</p>` : ''}
          ${focus.prayerText ? `<p>${escapeHtml(focus.prayerText)}</p>` : ''}
          <button class="btn btn-primary" id="mark-prayed">Mark as prayed</button>
        ` : `<p style="color:var(--text-dim)">You've prayed through everything for today, or you haven't added any prayer points yet.</p>
          <button class="btn btn-secondary" id="go-add">Add a prayer point</button>`}
      </div>

      ${upcoming.length ? `
        <div>
          <h3>Coming up</h3>
          <div class="card">
            ${upcoming.map((a) => `
              <div class="list-row">
                <div>
                  <div>${escapeHtml(a.title)}</div>
                  <div style="color:var(--text-dim);font-size:.85rem">${fmtDate(a.scheduledStart)}</div>
                </div>
                <span class="pill ${a.status === 'live' ? 'pill-live' : ''}">${a.status}</span>
              </div>
            `).join('')}
          </div>
        </div>
      ` : ''}
    </div>`;

  root.querySelector('#mark-prayed')?.addEventListener('click', async (e) => {
    e.target.disabled = true;
    e.target.textContent = 'Marked ✓';
    await prayerPointsStore.markPrayed(focus.clientId);
  });
  root.querySelector('#go-add')?.addEventListener('click', () => navigate('#/prayers'));
}

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

/* ── Prayer points ────────────────────────────────────────────────────── */

export async function renderPrayers(root) {
  const list = await prayerPointsStore.list();

  root.innerHTML = `
    <div class="screen stack">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <h1>Prayer points</h1>
        <button class="btn-text" id="add-toggle">+ Add</button>
      </div>

      <form id="add-form" class="card stack" hidden>
        <div class="field"><label for="pp-title">Title</label><input id="pp-title" required /></div>
        <div class="field"><label for="pp-scripture">Scripture (optional)</label><input id="pp-scripture" /></div>
        <div class="field"><label for="pp-text">Prayer (optional)</label><textarea id="pp-text"></textarea></div>
        <button class="btn btn-primary" type="submit">Save prayer point</button>
      </form>

      <p style="color:var(--text-dim);font-size:.85rem">Want a head start? <a href="#/prayer-bank">Browse the prayer bank</a> and import ready-made prayers.</p>

      <div class="card" id="pp-list">
        ${list.length ? list.map(rowFor).join('') : '<div class="empty-state">No prayer points yet. Add your first one above.</div>'}
      </div>
    </div>`;

  function rowFor(p) {
    return `
      <div class="list-row">
        <div>
          <div>${escapeHtml(p.title)}</div>
          ${p.scripture ? `<div style="color:var(--text-dim);font-size:.85rem">${escapeHtml(p.scripture)}</div>` : ''}
        </div>
        <div style="display:flex;align-items:center;gap:8px">
          ${p.isPrayedToday ? '<span class="pill pill-live">prayed today</span>' : `<button class="btn-text" data-mark="${p.clientId}">Mark prayed</button>`}
          <button class="btn-text" data-journal="${p.clientId}" data-title="${escapeHtml(p.title)}" style="color:var(--text-dim)">Journal</button>
        </div>
      </div>`;
  }

  root.querySelector('#add-toggle').addEventListener('click', () => {
    root.querySelector('#add-form').hidden = !root.querySelector('#add-form').hidden;
  });

  root.querySelector('#add-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    await prayerPointsStore.create({
      title: root.querySelector('#pp-title').value.trim(),
      scripture: root.querySelector('#pp-scripture').value.trim() || null,
      prayerText: root.querySelector('#pp-text').value.trim() || null,
    });
    renderPrayers(root);
  });

  root.querySelectorAll('[data-mark]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      await prayerPointsStore.markPrayed(btn.dataset.mark);
      renderPrayers(root);
    });
  });

  root.querySelectorAll('[data-journal]').forEach((btn) => {
    btn.addEventListener('click', () => navigate(`#/journal?add=${btn.dataset.journal}&title=${encodeURIComponent(btn.dataset.title)}`));
  });
}

/* ── Prayer bank ──────────────────────────────────────────────────────── */

export async function renderPrayerBank(root) {
  const bank = await prayerBankStore.get();

  if (!bank) {
    root.innerHTML = `
      <div class="screen">
        <h1>Prayer bank</h1>
        <div class="empty-state">This needs to be downloaded once while you're online. Connect to the internet and reopen this page.</div>
      </div>`;
    return;
  }

  root.innerHTML = `
    <div class="screen stack">
      <h1>Prayer bank</h1>
      <p style="color:var(--text-dim)">Import ready-made prayers into your own list. Works offline once downloaded.</p>
      <div class="card" id="bank-list">
        ${bank.PrayerCategories.map((c, i) => `
          <div class="list-row">
            <div>${escapeHtml(c.Name)}</div>
            <button class="btn-text" data-import="${escapeHtml(c.Name)}">Import all (${c.Prayers.length})</button>
          </div>
        `).join('')}
      </div>
    </div>`;

  root.querySelectorAll('[data-import]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      btn.textContent = 'Importing…';
      const count = await prayerBankStore.import(btn.dataset.import, null);
      btn.textContent = `Imported ${count} ✓`;
      btn.disabled = true;
    });
  });
}

/* ── Journal ──────────────────────────────────────────────────────────── */

export async function renderJournal(root, hash) {
  const entries = await journalStore.list();
  const points = await prayerPointsStore.list();

  const params = new URLSearchParams(hash.split('?')[1] || '');
  const prefillId = params.get('add');
  const prefillTitle = params.get('title');

  root.innerHTML = `
    <div class="screen stack">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <h1>Journal</h1>
        <button class="btn-text" id="add-toggle">+ Entry</button>
      </div>

      <form id="add-form" class="card stack" ${prefillId ? '' : 'hidden'}>
        <div class="field">
          <label for="j-point">Prayer point</label>
          <select id="j-point" required>
            <option value="">Choose one</option>
            ${points.map((p) => `<option value="${p.clientId}" ${p.clientId === prefillId ? 'selected' : ''}>${escapeHtml(p.title)}</option>`).join('')}
          </select>
        </div>
        <div class="field"><label for="j-notes">What happened / what you sense God saying</label><textarea id="j-notes"></textarea></div>
        <div class="field"><label for="j-duration">Minutes spent</label><input id="j-duration" type="number" min="0" value="5" /></div>
        <button class="btn btn-primary" type="submit">Save entry</button>
      </form>

      <div class="card">
        ${entries.length ? entries.map((e) => `
          <div class="list-row">
            <div>
              <div>${escapeHtml(e.prayerPointTitle)}</div>
              <div style="color:var(--text-dim);font-size:.85rem">${fmtDate(e.date)} · ${e.durationMinutes} min</div>
              ${e.notes ? `<p style="margin-top:6px">${escapeHtml(e.notes)}</p>` : ''}
            </div>
          </div>
        `).join('') : '<div class="empty-state">No journal entries yet.</div>'}
      </div>
    </div>`;

  root.querySelector('#add-toggle').addEventListener('click', () => {
    root.querySelector('#add-form').hidden = !root.querySelector('#add-form').hidden;
  });

  root.querySelector('#add-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    await journalStore.create({
      prayerPointClientId: root.querySelector('#j-point').value,
      notes: root.querySelector('#j-notes').value.trim() || null,
      durationMinutes: Number(root.querySelector('#j-duration').value) || 0,
    });
    navigate('#/journal');
    renderJournal(document.getElementById('screen'), '#/journal');
  });
}

/* ── Bible ────────────────────────────────────────────────────────────── */

export async function renderBible(root, hash) {
  const downloaded = await bibleStore.isDownloaded();

  if (!downloaded) {
    root.innerHTML = `
      <div class="screen stack">
        <h1>Bible</h1>
        <div class="card">
          <p>Download the KJV once (about 1–2 MB) to read it — including fully offline afterwards.</p>
          <button class="btn btn-primary" id="dl-bible" ${navigator.onLine ? '' : 'disabled'}>${navigator.onLine ? 'Download Bible' : 'Connect to the internet to download'}</button>
          <div class="error-text" id="dl-error" hidden></div>
        </div>
      </div>`;
    root.querySelector('#dl-bible')?.addEventListener('click', async (e) => {
      e.target.disabled = true;
      e.target.textContent = 'Downloading…';
      try {
        await bibleStore.download();
        renderBible(root, hash);
      } catch (err) {
        root.querySelector('#dl-error').textContent = err.message;
        root.querySelector('#dl-error').hidden = false;
        e.target.disabled = false;
        e.target.textContent = 'Try again';
      }
    });
    return;
  }

  const parts = hash.replace('#/bible/', '').split('/');
  const bookId = hash.startsWith('#/bible/') && parts[0] ? Number(parts[0]) : null;
  const chapter = parts[1] ? Number(parts[1]) : null;

  if (!bookId) {
    const books = await bibleStore.listBooks();
    root.innerHTML = `
      <div class="screen stack">
        <h1>Bible</h1>
        <div class="card">
          ${books.map((b) => `<div class="list-row" data-book="${b.id}"><div>${escapeHtml(b.name)}</div><span class="pill">${b.chapterCount} ch</span></div>`).join('')}
        </div>
      </div>`;
    root.querySelectorAll('[data-book]').forEach((row) => {
      row.style.cursor = 'pointer';
      row.addEventListener('click', () => navigate(`#/bible/${row.dataset.book}`));
    });
    return;
  }

  if (!chapter) {
    const books = await bibleStore.listBooks();
    const book = books.find((b) => b.id === bookId);
    const chapters = Array.from({ length: book.chapterCount }, (_, i) => i + 1);
    root.innerHTML = `
      <div class="screen stack">
        <button class="btn-text" id="back">‹ Books</button>
        <h1>${escapeHtml(book.name)}</h1>
        <div class="card" style="display:flex;flex-wrap:wrap;gap:8px">
          ${chapters.map((c) => `<button class="btn-secondary" style="width:auto;padding:8px 14px" data-chapter="${c}">${c}</button>`).join('')}
        </div>
      </div>`;
    root.querySelector('#back').addEventListener('click', () => navigate('#/bible'));
    root.querySelectorAll('[data-chapter]').forEach((btn) => {
      btn.addEventListener('click', () => navigate(`#/bible/${bookId}/${btn.dataset.chapter}`));
    });
    return;
  }

  const data = await bibleStore.getChapter(bookId, chapter);
  root.innerHTML = `
    <div class="screen stack">
      <button class="btn-text" id="back">‹ ${escapeHtml(data.book)}</button>
      <h1>${escapeHtml(data.book)} ${chapter}</h1>
      <div class="card">
        ${Object.entries(data.verses || {}).map(([num, text]) => `<p><strong style="color:var(--accent-soft)">${num}</strong> ${escapeHtml(text)}</p>`).join('')}
      </div>
    </div>`;
  root.querySelector('#back').addEventListener('click', () => navigate(`#/bible/${bookId}`));
}

/* ── Together (appointments) ─────────────────────────────────────────── */

export async function renderTogether(root) {
  if (!isSignedIn()) {
    root.innerHTML = `
      <div class="screen stack">
        <h1>Together</h1>
        <div class="card">
          <p>Together is for scheduling shared prayer sessions with others — it needs an account and an internet connection.</p>
          <button class="btn btn-primary" id="go-signup">Create account</button>
          <button class="btn-text" id="go-signin">I already have one</button>
        </div>
      </div>`;
    root.querySelector('#go-signup').addEventListener('click', () => navigate('#/signup'));
    root.querySelector('#go-signin').addEventListener('click', () => navigate('#/signin'));
    return;
  }

  const { appointments } = await api.appointments.list();

  root.innerHTML = `
    <div class="screen stack">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <h1>Together</h1>
        <button class="btn-text" id="create-toggle">+ New</button>
      </div>
      <p style="color:var(--text-dim)">Schedule a shared prayer session and send the invite link to anyone.</p>

      <form id="create-form" class="card stack" hidden>
        <div class="field"><label for="a-title">Title</label><input id="a-title" required placeholder="Sunday morning prayer" /></div>
        <div class="field"><label for="a-desc">What's this session for? (optional)</label><textarea id="a-desc"></textarea></div>
        <div class="field"><label for="a-start">Date &amp; time</label><input id="a-start" type="datetime-local" required /></div>
        <div class="field"><label for="a-duration">Duration (minutes)</label><input id="a-duration" type="number" value="30" min="5" /></div>
        <button class="btn btn-primary" type="submit">Create &amp; get invite link</button>
        <div id="invite-result"></div>
      </form>

      <div class="card">
        ${appointments.length ? appointments.map(rowFor).join('') : '<div class="empty-state">No prayer sessions yet.</div>'}
      </div>
    </div>`;

  function rowFor(a) {
    return `
      <div class="list-row">
        <div>
          <div>${escapeHtml(a.title)}</div>
          <div style="color:var(--text-dim);font-size:.85rem">${fmtDate(a.scheduledStart)} · hosted by ${escapeHtml(a.hostName)}</div>
        </div>
        <span class="pill ${a.status === 'live' ? 'pill-live' : ''}">${a.status}</span>
      </div>`;
  }

  root.querySelector('#create-toggle').addEventListener('click', () => {
    root.querySelector('#create-form').hidden = !root.querySelector('#create-form').hidden;
  });

  root.querySelector('#create-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const { appointment } = await api.appointments.create({
      title: root.querySelector('#a-title').value.trim(),
      description: root.querySelector('#a-desc').value.trim() || null,
      scheduledStart: new Date(root.querySelector('#a-start').value).toISOString(),
      durationMinutes: Number(root.querySelector('#a-duration').value) || 30,
    });
    root.querySelector('#invite-result').innerHTML = `
      <p>Share this link — anyone who opens it can see the session and join:</p>
      <div class="field"><input readonly value="${escapeHtml(appointment.inviteUrl)}" onclick="this.select()" /></div>`;
  });
}

/* ── Join via invite link ────────────────────────────────────────────── */

export async function renderJoin(root, hash) {
  const code = decodeURIComponent(hash.split('/').pop());
  const { appointment, agenda, myStatus } = await api.appointments.previewInvite(code);
  const signedIn = isSignedIn();

  root.innerHTML = `
    <div class="screen stack">
      <p class="eyebrow">You're invited</p>
      <h1>${escapeHtml(appointment.title)}</h1>
      <p style="color:var(--text-dim)">Hosted by ${escapeHtml(appointment.hostName)} · ${fmtDate(appointment.scheduledStart)} · ${appointment.durationMinutes} min</p>
      ${appointment.description ? `<p>${escapeHtml(appointment.description)}</p>` : ''}

      ${agenda.length ? `
        <div class="card">
          <p class="eyebrow">Prayer agenda</p>
          ${agenda.map((i) => `<div class="list-row"><div>${escapeHtml(i.title)}</div></div>`).join('')}
        </div>` : ''}

      ${signedIn ? `
        ${myStatus === 'accepted'
          ? '<div class="card">You\'re in — this is on your schedule.</div>'
          : '<button class="btn btn-primary" id="accept-btn">Accept &amp; add to my schedule</button>'}
      ` : `
        <div class="card">
          <p>Sign in or create a free account to add this to your schedule and get reminded when it's time.</p>
          <button class="btn btn-primary" id="signup-then-accept">Create account</button>
          <button class="btn-text" id="signin-then-accept">I already have an account</button>
        </div>
      `}
    </div>`;

  root.querySelector('#accept-btn')?.addEventListener('click', async (e) => {
    await api.appointments.acceptInvite(code);
    e.target.outerHTML = '<div class="card">You\'re in — this is on your schedule.</div>';
  });

  const goAuth = (hash) => {
    sessionStorage.setItem('proseuche_pending_invite', code);
    navigate(hash);
  };
  root.querySelector('#signup-then-accept')?.addEventListener('click', () => goAuth('#/signup'));
  root.querySelector('#signin-then-accept')?.addEventListener('click', () => goAuth('#/signin'));
}

/* ── Settings ─────────────────────────────────────────────────────────── */

export async function renderSettings(root) {
  const settings = await settingsStore.get();
  const profile = await profileStore.get();
  const syncStatus = await sync.status();

  root.innerHTML = `
    <div class="screen stack">
      <h1>Settings</h1>

      <div class="card stack">
        <p class="eyebrow">Account &amp; sync</p>
        ${profile.linked ? `
          <p>Signed in as <strong>${escapeHtml(profile.name)}</strong>. ${syncStatus.online ? 'Online' : 'Offline'} · last synced ${syncStatus.lastSyncAt ? fmtDate(syncStatus.lastSyncAt) : 'never'}.</p>
          <button class="btn btn-secondary" id="sync-now" ${syncStatus.online ? '' : 'disabled'}>Sync now</button>
          <button class="btn btn-danger" id="signout">Sign out</button>
        ` : `
          <p>You're using Proseuche fully offline right now — nothing is backed up yet.</p>
          <button class="btn btn-primary" id="go-signup">Create account to sync</button>
          <button class="btn-text" id="go-signin">I already have an account</button>
        `}
      </div>

      <div class="card">
        <div class="list-row" id="go-together" style="cursor:pointer">
          <div>Together — group prayer sessions</div>
          <span class="pill">online</span>
        </div>
      </div>

      <div class="card stack">
        <p class="eyebrow">Reminders</p>
        <div class="field">
          <label for="s-mode">Reminder mode</label>
          <select id="s-mode">
            <option value="FixedTimes" ${settings.reminderMode === 'FixedTimes' ? 'selected' : ''}>Fixed times</option>
            <option value="Interval" ${settings.reminderMode === 'Interval' ? 'selected' : ''}>Every few hours</option>
          </select>
        </div>
        <div class="field">
          <label for="s-times">Fixed times (comma-separated, 24h)</label>
          <input id="s-times" value="${settings.defaultPrayerTimes.join(', ')}" />
        </div>
        <div class="field">
          <label for="s-interval">Interval (hours)</label>
          <input id="s-interval" type="number" min="1" value="${settings.intervalHours}" />
        </div>
        <button class="btn btn-secondary" id="enable-notifications">Enable notifications</button>
        <button class="btn btn-primary" id="save-settings">Save</button>
      </div>
    </div>`;

  root.querySelector('#go-signup')?.addEventListener('click', () => navigate('#/signup'));
  root.querySelector('#go-signin')?.addEventListener('click', () => navigate('#/signin'));
  root.querySelector('#go-together').addEventListener('click', () => navigate('#/together'));
  root.querySelector('#sync-now')?.addEventListener('click', async (e) => {
    e.target.textContent = 'Syncing…';
    await sync.run();
    renderSettings(root);
  });
  root.querySelector('#signout')?.addEventListener('click', () => {
    clearSession();
    navigate('#/today');
  });
  root.querySelector('#enable-notifications')?.addEventListener('click', async (e) => {
    const result = await requestNotificationPermission();
    e.target.textContent = result === 'granted' ? 'Notifications on ✓' : 'Not enabled';
  });
  root.querySelector('#save-settings').addEventListener('click', async () => {
    await settingsStore.update({
      reminderMode: root.querySelector('#s-mode').value,
      defaultPrayerTimes: root.querySelector('#s-times').value.split(',').map((t) => t.trim()).filter(Boolean),
      intervalHours: Number(root.querySelector('#s-interval').value) || 2,
    });
  });
}
