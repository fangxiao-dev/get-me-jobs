import fs from 'node:fs';

export function normalizeSameSite(value) {
  const key = String(value ?? 'lax').toLowerCase();
  if (key === 'strict') return 'Strict';
  if (key === 'none' || key === 'no_restriction') return 'None';
  return 'Lax';
}

export function normalizeCookie(cookie) {
  if (!cookie?.name || !cookie?.domain) {
    throw new Error('Cookie must include name and domain');
  }
  return {
    name: String(cookie.name),
    value: String(cookie.value ?? ''),
    domain: String(cookie.domain),
    path: cookie.path ? String(cookie.path) : '/',
    expires: Number.isFinite(cookie.expirationDate) ? cookie.expirationDate : -1,
    secure: Boolean(cookie.secure),
    httpOnly: Boolean(cookie.httpOnly),
    sameSite: normalizeSameSite(cookie.sameSite)
  };
}

export function loadCookies(cookiesPath) {
  const parsed = JSON.parse(fs.readFileSync(cookiesPath, 'utf8'));
  if (!Array.isArray(parsed)) {
    throw new Error('Cookie file must contain a JSON array');
  }
  return parsed.map(normalizeCookie);
}

export function summarizeCookies(cookies) {
  return {
    count: cookies.length,
    cookies: cookies.map((cookie) => ({
      name: cookie.name,
      domain: cookie.domain,
      value: '<redacted>'
    }))
  };
}
