import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { startServer } from '../../scripts/serve.mjs';

// ---------- Покрытие JS (npm run test:e2e:coverage) ----------
// При заданной E2E_COVERAGE_DIR каждая страница собирает V8-покрытие с момента создания
// и сбрасывает его в файл при закрытии страницы, контекста или браузера.
const COVERAGE_DIR = process.env.E2E_COVERAGE_DIR;
let dumps = 0;

async function startCoverage(page) {
  if (!COVERAGE_DIR) return;
  page.__coverage = page.coverage.startJSCoverage({ resetOnNavigation: false }).catch(() => null);
  const close = page.close.bind(page);
  page.close = async (...args) => {
    await dumpCoverage(page);
    return close(...args);
  };
  // При перезагрузке и переходе V8 выбрасывает покрытие старого документа — сначала сбрасываем его в файл.
  for (const method of ['reload', 'goto', 'goBack']) {
    const original = page[method].bind(page);
    page[method] = async (...args) => {
      if (page.__coverage) {
        await dumpCoverage(page);
        page.__coverage = page.coverage.startJSCoverage({ resetOnNavigation: false }).catch(() => null);
        await page.__coverage;
      }
      return original(...args);
    };
  }
}

async function dumpCoverage(page) {
  if (!page.__coverage || page.isClosed()) return;
  const started = page.__coverage;
  page.__coverage = null;
  try {
    await started;
    const entries = await page.coverage.stopJSCoverage();
    const ours = entries.filter((e) => /\/js\/.+\.js$/.test(new URL(e.url).pathname));
    if (ours.length)
      writeFileSync(join(COVERAGE_DIR, `${process.pid}-${++dumps}.json`), JSON.stringify(ours));
  } catch {
    /* страница уже закрыта */
  }
}

/**
 * Сбросить покрытие в файл прямо сейчас. Нужно перед действием, после которого страница перезагрузится сама
 * (например, кнопка «Обновить»): покрытие старого документа V8 при этом теряет.
 */
export async function flushCoverage(page) {
  if (!COVERAGE_DIR || !page.__coverage) return;
  await dumpCoverage(page);
  page.__coverage = page.coverage.startJSCoverage({ resetOnNavigation: false }).catch(() => null);
  await page.__coverage;
}

async function dumpContext(ctx) {
  await Promise.all(ctx.pages().map(dumpCoverage));
}

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
      const ctx = await browser.newContext({
        viewport: { width: 390, height: 844 },
        serviceWorkers: 'block',
        acceptDownloads: true,
        // По умолчанию без анимаций — проверки детерминированы. Анимации проверяет motion.test.mjs.
        reducedMotion: 'reduce',
        ...opts,
      });
      if (COVERAGE_DIR) {
        ctx.on('page', startCoverage);
        const close = ctx.close.bind(ctx);
        ctx.close = async (...args) => {
          await dumpContext(ctx);
          return close(...args);
        };
      }
      return ctx;
    },
    async close() {
      if (COVERAGE_DIR) await Promise.all(browser.contexts().map(dumpContext));
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
  await page.__coverage; // покрытие должно начаться до загрузки скриптов
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
