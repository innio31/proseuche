import { api, setSession, clearSession, isSignedIn } from './api.js';
import { profile as profileStore, settings as settingsStore, categories as categoriesStore,
         prayerPoints as prayerPointsStore, journal as journalStore, prayerBank as prayerBankStore,
         bible as bibleStore, sync } from './store.js';
import { navigate, escapeHtml } from './router.js';
import { requestNotificationPermission } from './reminders.js';
import { canPromptInstall, promptInstall, isStandalone, isIOS } from './install.js';

function fmtDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

/* ── Auth ────────────────────────────────────────────────────────────── */

export function renderSignIn(root) {
  root.innerHTML = `
    <div class="screen stack">
      <div>
        <p class="eyebrow">Sync &amp; group prayer</p>
        <h1>Welcome back</h1>
        <p style="color:var(--text-dim)">Your personal prayer points already work offline without an account. Sign in to back them up and use Together.</p>
      </div>
      <form id="signin-form" class="stack">
        <div class="field"><label for="email">Email</label><input id="email" type="email" required autocomplete="email" placeholder="you@example.com" /></div>
        <div class="field"><label for="password">Password</label><input id="password" type="password" required autocomplete="current-password" placeholder="••••••••" /></div>
        <button class="btn btn-primary" type="submit">Sign in</button>
        <div class="error-text" id="signin-error" hidden></div>
      </form>
      <button class="btn-text" id="go-signup">New here? Create an account</button>
      <button class="btn-ghost" id="go-back">Not now</button>
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
        <div class="field"><label for="email">Email</label><input id="email" type="email" required autocomplete="email" placeholder="you@example.com" /></div>
        <div class="field"><label for="password">Password</label><input id="password" type="password" required minlength="8" autocomplete="new-password" placeholder="min 8 characters" /></div>
        <button class="btn btn-primary" type="submit">Create account</button>
        <div class="error-text" id="signup-error" hidden></div>
      </form>
      <button class="btn-text" id="go-signin">Already have an account? Sign in</button>
      <button class="btn-ghost" id="go-back">Not now</button>
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
  const allPoints = await prayerPointsStore.list();
  const focus = await prayerPointsStore.random();
  const prayedCount = allPoints.filter(p => p.isPrayedToday).length;
  const totalCount = allPoints.length;

  let upcoming = [];
  if (isSignedIn()) {
    try {
      const { appointments } = await api.appointments.list();
      upcoming = appointments.filter((a) => a.status !== 'completed' && a.status !== 'cancelled').slice(0, 3);
    } catch { /* non-fatal on the home screen */ }
  }

  root.innerHTML = `
    <div class="screen stack">
      <div>
        <p class="eyebrow">${greeting()}</p>
        <h1>${escapeHtml(profile.name || 'Friend')}</h1>
        ${totalCount > 0 ? `<small>${prayedCount} of ${totalCount} prayed today</small>` : ''}
      </div>

      ${totalCount > 0 ? `
        <div class="progress-ring">
          <svg width="48" height="48" viewBox="0 0 48 48">
            <circle class="ring-bg" cx="24" cy="24" r="20" />
            <circle class="ring-fg" cx="24" cy="24" r="20" 
              stroke-dasharray="${2 * Math.PI * 20}" 
              stroke-dashoffset="${2 * Math.PI * 20 * (1 - prayedCount / totalCount)}" />
          </svg>
          <div>
            <strong>${Math.round(prayedCount / totalCount * 100)}%</strong>
            <span style="color:var(--text-dim);font-size:.85rem;display:block">prayer progress</span>
          </div>
        </div>
      ` : ''}

      <div class="card card-glow">
        <p class="eyebrow">Today's focus</p>
        ${focus ? `
          <h3>${escapeHtml(focus.title)}</h3>
          ${focus.scripture ? `<div class="scripture">${escapeHtml(focus.scripture)}</div>` : ''}
          ${focus.prayerText ? `<p>${escapeHtml(focus.prayerText)}</p>` : ''}
          <button class="btn btn-primary" id="mark-prayed">✝ Mark as prayed</button>
        ` : `
          <div class="empty-state">
            <span class="empty-icon">🕊️</span>
            <h3>All prayed up</h3>
            <p>You've prayed through everything for today, or you haven't added any prayer points yet.</p>
            <button class="btn btn-secondary" id="go-add">Add a prayer point</button>
          </div>
        `}
      </div>

      ${upcoming.length ? `
        <div>
          <h3>📅 Coming up</h3>
          <div class="card">
            ${upcoming.map((a) => `
              <div class="list-row">
                <div>
                  <div><strong>${escapeHtml(a.title)}</strong></div>
                  <div style="color:var(--text-dim);font-size:.85rem">${fmtDate(a.scheduledStart)}</div>
                </div>
                <span class="pill ${a.status === 'live' ? 'pill-live' : ''}">${a.status}</span>
              </div>
            `).join('')}
          </div>
        </div>
      ` : `
        ${isSignedIn() ? `<div class="card"><p style="color:var(--text-dim);margin:0">No upcoming group sessions. <a href="#/together">Create one →</a></p></div>` : ''}
      `}
    </div>`;

  root.querySelector('#mark-prayed')?.addEventListener('click', async (e) => {
    e.target.disabled = true;
    e.target.textContent = 'Marked ✓';
    await prayerPointsStore.markPrayed(focus.clientId);
    setTimeout(() => renderToday(root), 500);
  });
  root.querySelector('#go-add')?.addEventListener('click', () => navigate('#/prayers'));
}

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning ☀️';
  if (h < 17) return 'Good afternoon 🌤️';
  return 'Good evening 🌙';
}

/* ── Prayer points ────────────────────────────────────────────────────── */

export async function renderPrayers(root) {
  const list = await prayerPointsStore.list();

  root.innerHTML = `
    <div class="screen stack">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <h1>Prayer points</h1>
        <button class="btn btn-primary btn-sm" id="add-toggle" style="width:auto">+ Add</button>
      </div>

      <form id="add-form" class="card stack" hidden>
        <div class="field"><label for="pp-title">Title</label><input id="pp-title" required placeholder="What are you praying about?" /></div>
        <div class="field"><label for="pp-scripture">Scripture (optional)</label><input id="pp-scripture" placeholder="e.g. Philippians 4:6" /></div>
        <div class="field"><label for="pp-text">Prayer (optional)</label><textarea id="pp-text" placeholder="Write your prayer here..." rows="3"></textarea></div>
        <button class="btn btn-primary" type="submit">Save prayer point</button>
      </form>

      <p style="color:var(--text-dim);font-size:.85rem">📖 Want a head start? <a href="#/prayer-bank">Browse the prayer bank</a> and import ready-made prayers.</p>

      <div class="card" id="pp-list">
        ${list.length ? list.map(rowFor).join('') : `
          <div class="empty-state">
            <span class="empty-icon">📝</span>
            <h3>No prayer points yet</h3>
            <p>Add your first one above, or import from the prayer bank.</p>
          </div>
        `}
      </div>
    </div>`;

  function rowFor(p) {
    return `
      <div class="list-row">
        <div>
          <div><strong>${escapeHtml(p.title)}</strong></div>
          ${p.scripture ? `<div style="color:var(--text-dim);font-size:.85rem">📖 ${escapeHtml(p.scripture)}</div>` : ''}
        </div>
        <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
          ${p.isPrayedToday ? '<span class="pill pill-live">✓ prayed</span>' : `<button class="btn-text btn-sm" data-mark="${p.clientId}" style="padding:4px 8px">Mark prayed</button>`}
          <button class="btn-ghost btn-sm" data-journal="${p.clientId}" data-title="${escapeHtml(p.title)}" style="padding:4px 8px;font-size:.8rem">✍️</button>
        </div>
      </div>`;
  }

  root.querySelector('#add-toggle').addEventListener('click', () => {
    const form = root.querySelector('#add-form');
    form.hidden = !form.hidden;
    if (!form.hidden) form.querySelector('#pp-title').focus();
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
      <div class="screen stack">
        <h1>Prayer bank</h1>
        <div class="card">
          <div class="empty-state">
            <span class="empty-icon">📡</span>
            <h3>Connect to download</h3>
            <p>The prayer bank needs to be downloaded once while you're online.</p>
            ${navigator.onLine ? '<button class="btn btn-primary" id="retry-bank">Retry</button>' : '<p style="color:var(--text-faint)">Please connect to the internet and try again.</p>'}
          </div>
        </div>
      </div>`;
    root.querySelector('#retry-bank')?.addEventListener('click', () => renderPrayerBank(root));
    return;
  }

  root.innerHTML = `
    <div class="screen stack">
      <h1>📖 Prayer bank</h1>
      <p style="color:var(--text-dim)">Import ready-made prayers into your own list. Works offline once downloaded.</p>
      <div class="card" id="bank-list">
        ${bank.PrayerCategories.map((c, i) => `
          <div class="list-row">
            <div>
              <div><strong>${escapeHtml(c.Name)}</strong></div>
              <div style="color:var(--text-dim);font-size:.8rem">${c.Prayers.length} prayers</div>
            </div>
            <button class="btn btn-secondary btn-sm" style="width:auto;padding:6px 14px" data-import="${escapeHtml(c.Name)}">Import all</button>
          </div>
        `).join('')}
      </div>
    </div>`;

  root.querySelectorAll('[data-import]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const original = btn.textContent;
      btn.textContent = '⏳ Importing...';
      btn.disabled = true;
      try {
        const count = await prayerBankStore.import(btn.dataset.import, null);
        btn.textContent = `✅ ${count} imported`;
        btn.style.borderColor = 'var(--live)';
      } catch (err) {
        btn.textContent = '❌ Failed';
        btn.disabled = false;
      }
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
        <h1>📓 Journal</h1>
        <button class="btn btn-primary btn-sm" id="add-toggle" style="width:auto">+ Entry</button>
      </div>

      <form id="add-form" class="card stack" ${prefillId ? '' : 'hidden'}>
        ${prefillTitle ? `<h3>📝 ${escapeHtml(decodeURIComponent(prefillTitle))}</h3>` : ''}
        <div class="field">
          <label for="j-point">Prayer point</label>
          <select id="j-point" required>
            <option value="">Choose one</option>
            ${points.map((p) => `<option value="${p.clientId}" ${p.clientId === prefillId ? 'selected' : ''}>${escapeHtml(p.title)}</option>`).join('')}
          </select>
        </div>
        <div class="field"><label for="j-notes">What happened / what you sense God saying</label><textarea id="j-notes" rows="3"></textarea></div>
        <div class="field"><label for="j-duration">Minutes spent</label><input id="j-duration" type="number" min="0" value="5" /></div>
        <button class="btn btn-primary" type="submit">Save entry</button>
      </form>

      <div class="card">
        ${entries.length ? entries.map((e) => `
          <div class="list-row">
            <div>
              <div><strong>${escapeHtml(e.prayerPointTitle)}</strong></div>
              <div style="color:var(--text-dim);font-size:.85rem">${fmtDate(e.date)} · ${e.durationMinutes} min</div>
              ${e.notes ? `<p style="margin-top:6px;color:var(--text-dim)">${escapeHtml(e.notes)}</p>` : ''}
            </div>
          </div>
        `).join('') : `
          <div class="empty-state">
            <span class="empty-icon">📓</span>
            <h3>No journal entries</h3>
            <p>Journal your prayer journey as you go.</p>
          </div>
        `}
      </div>
    </div>`;

  root.querySelector('#add-toggle').addEventListener('click', () => {
    const form = root.querySelector('#add-form');
    form.hidden = !form.hidden;
    if (!form.hidden) form.querySelector('#j-point').focus();
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
        <h1>📖 Bible</h1>
        <div class="card">
          <div class="empty-state">
            <span class="empty-icon">📜</span>
            <h3>Download the Bible</h3>
            <p>Download the King James Version once (about 1–2 MB) to read it offline.</p>
            <button class="btn btn-primary" id="dl-bible" ${navigator.onLine ? '' : 'disabled'}>${navigator.onLine ? '⬇ Download Bible' : 'Connect to the internet to download'}</button>
            <div class="error-text" id="dl-error" hidden></div>
          </div>
        </div>
      </div>`;
    root.querySelector('#dl-bible')?.addEventListener('click', async (e) => {
      e.target.disabled = true;
      e.target.textContent = '⏳ Downloading...';
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
        <h1>📖 Bible</h1>
        <div class="card">
          ${books.map((b) => `<div class="list-row" data-book="${b.id}" style="cursor:pointer"><div><strong>${escapeHtml(b.name)}</strong></div><span class="pill">${b.chapterCount} ch</span></div>`).join('')}
        </div>
      </div>`;
    root.querySelectorAll('[data-book]').forEach((row) => {
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
        <button class="btn-ghost" id="back" style="padding:4px 0">‹ Books</button>
        <h1>${escapeHtml(book.name)}</h1>
        <div class="card" style="display:flex;flex-wrap:wrap;gap:8px">
          ${chapters.map((c) => `<button class="btn btn-secondary btn-sm" style="width:auto;padding:8px 14px" data-chapter="${c}">${c}</button>`).join('')}
        </div>
      </div>`;
    root.querySelector('#back').addEventListener('click', () => navigate('#/bible'));
    root.querySelectorAll('[data-chapter]').forEach((btn) => {
      btn.addEventListener('click', () => navigate(`#/bible/${bookId}/${btn.dataset.chapter}`));
    });
    return;
  }

  const data = await bibleStore.getChapter(bookId, chapter);
  if (!data || !data.verses) {
    root.innerHTML = `<div class="screen"><div class="empty-state"><span class="empty-icon">📖</span><h3>Chapter not found</h3></div></div>`;
    return;
  }
  root.innerHTML = `
    <div class="screen stack">
      <button class="btn-ghost" id="back" style="padding:4px 0">‹ ${escapeHtml(data.book)}</button>
      <h1>${escapeHtml(data.book)} ${chapter}</h1>
      <div class="card">
        ${Object.entries(data.verses).map(([num, text]) => `<p><strong style="color:var(--accent-soft)">${num}</strong> ${escapeHtml(text)}</p>`).join('')}
      </div>
    </div>`;
  root.querySelector('#back').addEventListener('click', () => navigate(`#/bible/${bookId}`));
}

/* ── Together (appointments) ─────────────────────────────────────────── */

export async function renderTogether(root) {
  if (!isSignedIn()) {
    root.innerHTML = `
      <div class="screen stack">
        <h1>👥 Together</h1>
        <div class="card">
          <div class="empty-state">
            <span class="empty-icon">👥</span>
            <h3>Sign in to join group prayer</h3>
            <p>Together is for scheduling shared prayer sessions with others — it needs an account.</p>
            <button class="btn btn-primary" id="go-signup">Create account</button>
            <button class="btn-text" id="go-signin">I already have one</button>
          </div>
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
        <h1>👥 Together</h1>
        <button class="btn btn-primary btn-sm" id="create-toggle" style="width:auto">+ New</button>
      </div>
      <p style="color:var(--text-dim)">Schedule a shared prayer session and send the invite link to anyone.</p>

      <form id="create-form" class="card stack" hidden>
        <div class="field"><label for="a-title">Title</label><input id="a-title" required placeholder="Sunday morning prayer" /></div>
        <div class="field"><label for="a-desc">What's this session for? (optional)</label><textarea id="a-desc" rows="2"></textarea></div>
        <div class="field"><label for="a-start">Date &amp; time</label><input id="a-start" type="datetime-local" required /></div>
        <div class="field"><label for="a-duration">Duration (minutes)</label><input id="a-duration" type="number" value="30" min="5" /></div>
        <button class="btn btn-primary" type="submit">Create &amp; get invite link</button>
        <div id="invite-result"></div>
      </form>

      <div class="card">
        ${appointments.length ? appointments.map(rowFor).join('') : `
          <div class="empty-state">
            <span class="empty-icon">📅</span>
            <h3>No sessions yet</h3>
            <p>Create your first group prayer session above.</p>
          </div>
        `}
      </div>
    </div>`;

  function rowFor(a) {
    return `
      <div class="list-row">
        <div>
          <div><strong>${escapeHtml(a.title)}</strong></div>
          <div style="color:var(--text-dim);font-size:.85rem">${fmtDate(a.scheduledStart)} · ${escapeHtml(a.hostName)}</div>
        </div>
        <span class="pill ${a.status === 'live' ? 'pill-live' : ''}">${a.status}</span>
      </div>`;
  }

  root.querySelector('#create-toggle').addEventListener('click', () => {
    const form = root.querySelector('#create-form');
    form.hidden = !form.hidden;
    if (!form.hidden) form.querySelector('#a-title').focus();
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
      <div class="card" style="margin-top:12px">
        <p style="font-weight:600;margin:0">🔗 Share this invite link:</p>
        <div class="field"><input readonly value="${escapeHtml(appointment.inviteUrl)}" onclick="this.select()" style="cursor:pointer" /></div>
        <small>Anyone with this link can see the session and join.</small>
      </div>`;
  });
}

/* ── Join via invite link ────────────────────────────────────────────── */

export async function renderJoin(root, hash) {
  const code = decodeURIComponent(hash.split('/').pop());
  const { appointment, agenda, myStatus } = await api.appointments.previewInvite(code);
  const signedIn = isSignedIn();

  root.innerHTML = `
    <div class="screen stack">
      <p class="eyebrow">📨 You're invited</p>
      <h1>${escapeHtml(appointment.title)}</h1>
      <p style="color:var(--text-dim)">Hosted by <strong>${escapeHtml(appointment.hostName)}</strong> · ${fmtDate(appointment.scheduledStart)} · ${appointment.durationMinutes} min</p>
      ${appointment.description ? `<p>${escapeHtml(appointment.description)}</p>` : ''}

      ${agenda.length ? `
        <div class="card">
          <p class="eyebrow">📋 Prayer agenda</p>
          ${agenda.map((i) => `<div class="list-row"><div>${escapeHtml(i.title)}</div></div>`).join('')}
        </div>` : ''}

      ${signedIn ? `
        ${myStatus === 'accepted'
          ? '<div class="card card-glow" style="text-align:center"><span style="font-size:2rem">✅</span><h3 style="margin:8px 0 0">You\'re in!</h3><p style="color:var(--text-dim);margin:0">This session is on your schedule.</p></div>'
          : '<button class="btn btn-primary" id="accept-btn">✅ Accept &amp; add to my schedule</button>'}
      ` : `
        <div class="card">
          <div class="empty-state">
            <span class="empty-icon">🔐</span>
            <h3>Sign in to join</h3>
            <p>Create a free account or sign in to add this to your schedule.</p>
            <button class="btn btn-primary" id="signup-then-accept">Create account</button>
            <button class="btn-text" id="signin-then-accept">I already have an account</button>
          </div>
        </div>
      `}
    </div>`;

  root.querySelector('#accept-btn')?.addEventListener('click', async (e) => {
    await api.appointments.acceptInvite(code);
    renderJoin(root, hash);
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

  const savedTheme = localStorage.getItem('proseuche_theme') || 'system';

  root.innerHTML = `
    <div class="screen stack">
      <h1>⚙️ Settings</h1>

      <div class="card stack">
        <p class="eyebrow">👤 Account &amp; sync</p>
        ${profile.linked ? `
          <p>Signed in as <strong>${escapeHtml(profile.name)}</strong></p>
          <p style="color:var(--text-dim);font-size:.85rem">${syncStatus.online ? '🟢 Online' : '🔴 Offline'} · last synced ${syncStatus.lastSyncAt ? fmtDate(syncStatus.lastSyncAt) : 'never'}</p>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <button class="btn btn-secondary btn-sm" id="sync-now" style="width:auto" ${syncStatus.online ? '' : 'disabled'}>🔄 Sync now</button>
            <button class="btn btn-danger btn-sm" id="signout" style="width:auto">Sign out</button>
          </div>
        ` : `
          <p>You're using Proseuche fully offline right now — nothing is backed up yet.</p>
          <button class="btn btn-primary" id="go-signup">Create account to sync</button>
          <button class="btn-text" id="go-signin">I already have an account</button>
        `}
      </div>

      <div class="card">
        <div class="list-row" id="go-together" style="cursor:pointer">
          <div>👥 Together — group prayer sessions</div>
          <span class="pill pill-accent">online</span>
        </div>
      </div>

      <div class="card stack">
        <p class="eyebrow">🎨 Appearance</p>
        <div class="field">
          <label for="theme-select">Theme</label>
          <select id="theme-select">
            <option value="system" ${savedTheme === 'system' ? 'selected' : ''}>🌓 System default</option>
            <option value="light" ${savedTheme === 'light' ? 'selected' : ''}>☀️ Light</option>
            <option value="dark" ${savedTheme === 'dark' ? 'selected' : ''}>🌙 Dark</option>
          </select>
        </div>
      </div>

      ${!isStandalone() ? `
        <div class="card">
          <p class="eyebrow">📱 Install</p>
          ${isIOS()
            ? '<p style="margin:0">Tap the Share icon in Safari, then "Add to Home Screen".</p>'
            : `<p style="margin:0">Install Proseuche on this device for quick, full-screen access.</p><button class="btn btn-secondary btn-sm" id="install-app" style="width:auto;margin-top:8px" ${canPromptInstall() ? '' : 'disabled'}>${canPromptInstall() ? '📲 Install app' : 'Not available yet — keep browsing, then try again'}</button>`}
        </div>
      ` : ''}

      <div class="card stack">
        <p class="eyebrow">🔔 Reminders</p>
        <div class="field">
          <label for="s-mode">Reminder mode</label>
          <select id="s-mode">
            <option value="FixedTimes" ${settings.reminderMode === 'FixedTimes' ? 'selected' : ''}>Fixed times</option>
            <option value="Interval" ${settings.reminderMode === 'Interval' ? 'selected' : ''}>Every few hours</option>
          </select>
        </div>
        <div class="field">
          <label for="s-times">Fixed times (comma-separated, 24h)</label>
          <input id="s-times" value="${settings.defaultPrayerTimes.join(', ')}" placeholder="06:00, 12:00, 18:00" />
        </div>
        <div class="field">
          <label for="s-interval">Interval (hours)</label>
          <input id="s-interval" type="number" min="1" value="${settings.intervalHours}" />
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn btn-secondary btn-sm" id="enable-notifications" style="width:auto">🔔 Enable notifications</button>
          <button class="btn btn-primary btn-sm" id="save-settings" style="width:auto">💾 Save</button>
        </div>
      </div>
    </div>`;

  root.querySelector('#go-signup')?.addEventListener('click', () => navigate('#/signup'));
  root.querySelector('#go-signin')?.addEventListener('click', () => navigate('#/signin'));
  root.querySelector('#go-together').addEventListener('click', () => navigate('#/together'));
  root.querySelector('#install-app')?.addEventListener('click', async (e) => {
    const outcome = await promptInstall();
    if (outcome === 'accepted') e.target.textContent = '✅ Installed!';
  });
  root.querySelector('#sync-now')?.addEventListener('click', async (e) => {
    e.target.textContent = '⏳ Syncing...';
    await sync.run();
    renderSettings(root);
  });
  root.querySelector('#signout')?.addEventListener('click', () => {
    clearSession();
    navigate('#/today');
  });
  root.querySelector('#enable-notifications')?.addEventListener('click', async (e) => {
    const result = await requestNotificationPermission();
    e.target.textContent = result === 'granted' ? '✅ Notifications on' : '❌ Not enabled';
    e.target.disabled = true;
  });
  root.querySelector('#save-settings').addEventListener('click', async () => {
    const theme = root.querySelector('#theme-select').value;
    localStorage.setItem('proseuche_theme', theme);
    if (theme === 'system') {
      document.documentElement.removeAttribute('data-theme');
    } else {
      document.documentElement.setAttribute('data-theme', theme);
    }

    await settingsStore.update({
      reminderMode: root.querySelector('#s-mode').value,
      defaultPrayerTimes: root.querySelector('#s-times').value.split(',').map((t) => t.trim()).filter(Boolean),
      intervalHours: Number(root.querySelector('#s-interval').value) || 2,
    });
    const btn = root.querySelector('#save-settings');
    btn.textContent = '✅ Saved!';
    setTimeout(() => { btn.textContent = '💾 Save'; }, 1500);
  });
}
