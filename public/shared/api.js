// public/shared/api.js
// Shared across all 3 frontends: handles the JWT token, attaches it to
// every request, and centralizes fetch error handling.

const Auth = {
  TOKEN_KEY: 'sgp_token',
  USER_KEY: 'sgp_user',

  setSession(token, user) {
    sessionStorage.setItem(this.TOKEN_KEY, token);
    sessionStorage.setItem(this.USER_KEY, JSON.stringify(user));
  },
  getToken() {
    return sessionStorage.getItem(this.TOKEN_KEY);
  },
  getUser() {
    const raw = sessionStorage.getItem(this.USER_KEY);
    return raw ? JSON.parse(raw) : null;
  },
  clearSession() {
    sessionStorage.removeItem(this.TOKEN_KEY);
    sessionStorage.removeItem(this.USER_KEY);
  },
  isLoggedIn() {
    return !!this.getToken();
  }
};

// Wrapper around fetch that adds the Authorization header and
// throws a clean Error with the server's message on failure.
async function apiCall(path, { method = 'GET', body = null } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  const token = Auth.getToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const response = await fetch(path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  let data;
  try {
    data = await response.json();
  } catch {
    data = {};
  }

  if (!response.ok) {
    if (response.status === 401) {
      // Session expired/invalid — clear it so the UI doesn't loop on stale auth
      Auth.clearSession();
    }
    throw new Error(data.error || `Request failed (${response.status})`);
  }

  return data;
}

function showToast(message, isError = false) {
  let toast = document.getElementById('sgpToast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'sgpToast';
    toast.className = 'toast';
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.className = 'toast show' + (isError ? ' error' : '');
  clearTimeout(toast._hideTimer);
  toast._hideTimer = setTimeout(() => toast.classList.remove('show'), 3200);
}
