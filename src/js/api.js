// Talks to the Proseuche Node/Express API.
// Base URL: same-origin in prod isn't possible (frontend is on Netlify, API is on
// impactdigitalacademy.com.ng), so this is always an absolute cross-origin URL.

export const API_BASE = window.PROSEUCHE_API_BASE || 'https://impactdigitalacademy.com.ng/proseuche';

const TOKEN_KEY = 'proseuche_token';
const USER_KEY = 'proseuche_user';

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function getUser() {
  const raw = localStorage.getItem(USER_KEY);
  return raw ? JSON.parse(raw) : null;
}

export function setSession(token, user) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function clearSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

export function isSignedIn() {
  return !!getToken();
}

async function request(path, { method = 'GET', body, auth = true } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (auth && getToken()) headers.Authorization = `Bearer ${getToken()}`;

  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (res.status === 204) return null;

  let data;
  try {
    data = await res.json();
  } catch {
    data = null;
  }

  if (!res.ok) {
    if (res.status === 401) clearSession();
    throw new Error(data?.error || `Request failed (${res.status})`);
  }
  return data;
}

export const api = {
  auth: {
    signup: (email, password, name) => request('/auth/signup', { method: 'POST', body: { email, password, name }, auth: false }),
    login: (email, password) => request('/auth/login', { method: 'POST', body: { email, password }, auth: false }),
    me: () => request('/auth/me'),
  },
  categories: {
    list: () => request('/categories'),
    create: (data) => request('/categories', { method: 'POST', body: data }),
    update: (id, data) => request(`/categories/${id}`, { method: 'PUT', body: data }),
  },
  prayerPoints: {
    list: (categoryId) => request(`/prayer-points${categoryId ? `?categoryId=${categoryId}` : ''}`),
    random: () => request('/prayer-points/random'),
    create: (data) => request('/prayer-points', { method: 'POST', body: data }),
    update: (id, data) => request(`/prayer-points/${id}`, { method: 'PUT', body: data }),
    markPrayed: (id) => request(`/prayer-points/${id}/mark-prayed`, { method: 'POST' }),
    remove: (id) => request(`/prayer-points/${id}`, { method: 'DELETE' }),
  },
  journal: {
    list: () => request('/journal'),
    create: (data) => request('/journal', { method: 'POST', body: data }),
  },
  settings: {
    get: () => request('/settings'),
    update: (data) => request('/settings', { method: 'PUT', body: data }),
  },
  prayerBank: {
    get: () => request('/prayer-bank', { auth: false }),
    import: (data) => request('/prayer-bank/import', { method: 'POST', body: data }),
  },
  appointments: {
    list: () => request('/appointments'),
    create: (data) => request('/appointments', { method: 'POST', body: data }),
    previewInvite: (code) => request(`/appointments/invite/${code}`, { auth: !!getToken() }),
    acceptInvite: (code) => request(`/appointments/invite/${code}/accept`, { method: 'POST' }),
    declineInvite: (code) => request(`/appointments/invite/${code}/decline`, { method: 'POST' }),
    start: (id) => request(`/appointments/${id}/start`, { method: 'POST' }),
    end: (id) => request(`/appointments/${id}/end`, { method: 'POST' }),
    join: (id) => request(`/appointments/${id}/join`, { method: 'POST' }),
  },
};
