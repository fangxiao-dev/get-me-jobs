const STOP_TEXT_PATTERNS = [
  { reason: 'captcha', pattern: /captcha/i },
  { reason: 'security_checkpoint', pattern: /security verification|checkpoint|verify your identity/i },
  { reason: 'access_restricted', pattern: /access restricted|rate limit|temporarily restricted/i }
];

export async function detectStopCondition(page) {
  const url = page.url();
  if (/\/login|\/checkpoint|\/uas\/login/.test(url)) {
    return { reason: 'login_required', url };
  }

  const hasLoginForm = await page.locator('input[name="session_key"], form[action*="login"]').count();
  if (hasLoginForm > 0) {
    return { reason: 'login_required', url };
  }

  const bodyText = await page.locator('body').innerText({ timeout: 2000 }).catch(() => '');
  for (const { reason, pattern } of STOP_TEXT_PATTERNS) {
    if (pattern.test(bodyText)) return { reason, url };
  }

  return null;
}
