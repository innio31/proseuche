const routes = new Map();
const PARAM_PREFIXES = ['#/join/', '#/bible/']; // routes with a trailing param, matched by prefix

export function registerRoute(hash, renderFn) {
  routes.set(hash, renderFn);
}

export function navigate(hash) {
  if (window.location.hash === hash) {
    render();
  } else {
    window.location.hash = hash;
  }
}

function matchBase(hash) {
  for (const prefix of PARAM_PREFIXES) {
    if (hash.startsWith(prefix)) return prefix;
  }
  return hash;
}

async function render() {
  const hash = window.location.hash || '#/today';
  const base = matchBase(hash);
  const renderFn = routes.get(base) || routes.get('#/today');
  const app = document.getElementById('screen');
  app.innerHTML = '<div class="empty-state">Loading…</div>';

  try {
    await renderFn(app, hash);
  } catch (err) {
    app.innerHTML = `<div class="empty-state">Something went wrong loading this screen.<div class="error-text">${escapeHtml(err.message)}</div></div>`;
  }

  const navHash = base === '#/join/' ? null : (base.startsWith('#/bible') ? '#/bible' : base);
  document.querySelectorAll('.bottom-nav a').forEach((a) => {
    a.classList.toggle('active', a.getAttribute('href') === navHash);
  });
  document.getElementById('bottom-nav-wrap').style.display = base === '#/join/' ? 'none' : 'flex';
}

export function escapeHtml(str = '') {
  return String(str)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

export function startRouter() {
  window.addEventListener('hashchange', render);
  render();
}
