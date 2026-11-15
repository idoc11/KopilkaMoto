import { chromium } from 'playwright';
import { startServer } from '../../scripts/serve.mjs';

export const TODAY = new Date();
export const iso = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const today = () => iso(new Date());
export const shift = (days) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return iso(d);
};

/** Запускает сервер и браузер; возвращает функции для создания контекстов и страниц. */
export async function setup({ root = '.' } = {}) {
  const overrides = new Map();
  const server = await startServer(root, 0, overrides);
  const base = `http://127.0.0.1:${server.address().port}/`;
  const browser = await chromium.launch();
  return {
    base,
    overrides,
    browser,
    async context(opts = {}) {
      return browser.newContext({
        viewport: { width: 390, height: 844 },
        serviceWorkers: 'block',
        acceptDownloads: true,
        ...opts,
      });
    },
    async close() {
      await browser.close();
      server.close();
    },
  };
}

/** Открывает приложение, собирая ошибки страницы и нарушения CSP. */
export async function open(ctx, base, { storage, hash = '' } = {}) {
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') page.errors.push(m.text());
  });
  if (storage) {
    await page.addInitScript((data) => {
      if (sessionStorage.getItem('__seeded')) return;
      sessionStorage.setItem('__seeded', '1');
      for (const [k, v] of Object.entries(data))
        localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v));
    }, storage);
  }
  await page.goto(base + hash);
  await page.waitForSelector('html[data-ready]');
  return page;
}

export const entry = (date, amount, kind = 'delivery', extra = {}) => ({
  date,
  amount,
  kind,
  hours: 0,
  note: '',
  ts: Date.now(),
  ...extra,
});

export const configured = (entries = {}, settings = {}) => ({
  'moto-tracker-v1': {
    schemaVersion: 2,
    entries,
    settings: { goal: 600000, start: 0, startDate: shift(-30), deadline: shift(90), ...settings },
  },
});

export const stored = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('moto-tracker-v1')));

export async function addEntry(page, { kind = 'delivery', amount, hours, note, date } = {}) {
  await page.click('nav [data-nav=add]');
  await page.click(`#kinds [data-kind=${kind}]`);
  await page.fill('#amount', String(amount));
  if (hours !== undefined) await page.fill('#hours', String(hours));
  if (note !== undefined) await page.fill('#note', note);
  if (date !== undefined) await page.fill('#date', date);
  await page.click('#saveEntry');
}
