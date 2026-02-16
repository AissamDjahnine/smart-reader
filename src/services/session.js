const TOKEN_KEY = 'ariadne_jwt';
const USER_KEY = 'ariadne_user';

export const getToken = () => {
  if (typeof window === 'undefined') return '';
  return window.localStorage.getItem(TOKEN_KEY) || '';
};

export const setSession = ({ token, user }) => {
  if (typeof window === 'undefined') return;
  if (token) {
    window.localStorage.setItem(TOKEN_KEY, token);
  }
  if (user) {
    window.localStorage.setItem(USER_KEY, JSON.stringify(user));
  }
};

export const clearSession = () => {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(TOKEN_KEY);
  window.localStorage.removeItem(USER_KEY);
};

export const getCurrentUser = () => {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(USER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};

export const hasSession = () => Boolean(getToken());
