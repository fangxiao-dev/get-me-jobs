import { chromium } from 'playwright';
import { loadCookies, summarizeCookies } from './cookies.mjs';

export async function createBrowserSession(input, logger = console) {
  const cookies = loadCookies(input.cookiesPath);
  logger.info('Loaded cookies', summarizeCookies(cookies));

  const browser = await chromium.launch({ headless: !input.headed });
  const context = await browser.newContext({
    userAgent: input.userAgent,
    viewport: { width: 1365, height: 900 },
    locale: 'en-US',
    timezoneId: Intl.DateTimeFormat().resolvedOptions().timeZone
  });
  await context.addCookies(cookies);
  const page = await context.newPage();

  return {
    browser,
    context,
    page,
    async close() {
      await browser.close();
    }
  };
}
