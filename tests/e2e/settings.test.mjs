import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { setup, open, configured, entry, today, shift, stored } from './helpers.mjs';

let env;
before(async () => (env = await setup()));
after(() => env.close());

const settingsPage = (ctx, storage = configured()) => open(ctx, env.base, { storage, hash: '#settings' });
const prefsOf = (page) =>
  page.evaluate(() => JSON.parse(localStorage.getItem('kopilkamoto-prefs-v2') || '{}'));

test('цель и сроки: сохранение, проверка полей', async () => {
  const ctx = await env.context();
  const page = await settingsPage(ctx);
  const save = () => page.click('#settingsForm button[type=submit]');
  const error = () => page.textContent('#settingsError');

  await page.fill('#goalInput', '0');
  await save();
  assert.match(await error(), /Цель — от 1/);
  await page.fill('#goalInput', '700 000');
  await page.fill('#startInput', '2000000000');
  await save();
  assert.match(await error(), /Уже отложенная сумма/);
  await page.fill('#startInput', '20 000');
  await page.fill('#startDateInput', '');
  await save();
  assert.match(await error(), /обе даты/);

  const start = shift(-10);
  const deadline = shift(100);
  await page.fill('#startDateInput', start);
  await page.fill('#deadlineInput', deadline);
  await save();
  assert.equal(await page.isVisible('#settingsError'), false);
  assert.match(await page.textContent('#toastText'), /Цель и сроки сохранены/);
  assert.deepEqual((await stored(page)).settings, { goal: 700000, start: 20000, startDate: start, deadline });
  await page.click('[data-nav=home]');
  assert.match(await page.textContent('#goalText'), /из 700\s000/);
  assert.match(await page.textContent('#total'), /20\s000/);
  await ctx.close();
});

test('адрес AI-прокси: сохранить https, отклонить мусор и http, отключить пустым', async () => {
  const ctx = await env.context();
  const page = await settingsPage(ctx);
  const submit = () => page.click('#apiForm button[type=submit]');
  const toast = () => page.textContent('#toastText');

  await page.fill('#apiUrl', 'это не адрес');
  await submit();
  assert.match(await toast(), /https:\/\//);
  assert.equal((await prefsOf(page)).apiUrl ?? '', '');

  await page.fill('#apiUrl', 'http://insecure.example');
  await submit();
  assert.match(await toast(), /https:\/\//);

  await page.fill('#apiUrl', '  https://proxy.example.workers.dev  ');
  await submit();
  assert.match(await toast(), /Адрес сохранён/);
  assert.equal((await prefsOf(page)).apiUrl, 'https://proxy.example.workers.dev/');
  assert.equal(await page.inputValue('#apiUrl'), 'https://proxy.example.workers.dev/');

  await page.fill('#apiUrl', '');
  await submit();
  assert.match(await toast(), /отключён/);
  assert.equal((await prefsOf(page)).apiUrl, '');
  await ctx.close();
});

test('подсказка о хранилище: «не будет удалять» и «может очистить»', async () => {
  for (const [persisted, expected] of [
    [true, /не будет удалять/],
    [false, /может очистить/],
  ]) {
    const ctx = await env.context();
    const page = await ctx.newPage();
    await page.addInitScript((value) => {
      Object.defineProperty(navigator, 'storage', {
        value: { persisted: async () => value, persist: async () => value },
        configurable: true,
      });
    }, persisted);
    await page.goto(env.base + '#settings');
    await page.waitForSelector('html[data-ready]');
    await page.waitForFunction(() =>
      /хранятся только/.test(document.querySelector('#storageInfo').textContent),
    );
    await page.waitForFunction(
      (re) => new RegExp(re).test(document.querySelector('#storageInfo').textContent),
      expected.source,
    );
    assert.match(await page.textContent('#storageInfo'), expected);
    await ctx.close();
  }
});

test('установка: подсказка для iPhone и для установленного приложения, кнопка «Установить»', async () => {
  // iPhone
  let ctx = await env.context({
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1',
  });
  let page = await settingsPage(ctx);
  assert.match(await page.textContent('#installHint'), /На iPhone/);
  await ctx.close();

  // уже установлено (display-mode: standalone)
  ctx = await env.context();
  page = await ctx.newPage();
  await page.addInitScript(() => {
    const original = window.matchMedia.bind(window);
    window.matchMedia = (q) =>
      q.includes('display-mode: standalone')
        ? { matches: true, media: q, addEventListener() {} }
        : original(q);
  });
  await page.goto(env.base + '#settings');
  await page.waitForSelector('html[data-ready]');
  assert.match(await page.textContent('#installHint'), /Приложение установлено/);
  await ctx.close();

  // обычный браузер: пока нет события — подсказка «как установить», с событием — кнопка
  ctx = await env.context();
  page = await settingsPage(ctx);
  assert.match(await page.textContent('#installHint'), /Установить приложение|Добавить на главный экран/);
  assert.equal(await page.isVisible('#install'), false);
  await page.evaluate(() => {
    const e = new Event('beforeinstallprompt', { cancelable: true });
    e.prompt = () => (window.__prompted = true);
    e.userChoice = Promise.resolve({ outcome: 'accepted' });
    window.dispatchEvent(e);
  });
  assert.equal(await page.isVisible('#install'), true);
  assert.equal(await page.textContent('#installHint'), '');
  await page.click('#install');
  await page.waitForFunction(() => document.querySelector('#install').hidden);
  assert.equal(await page.evaluate(() => window.__prompted), true);
  await page.evaluate(() => window.dispatchEvent(new Event('appinstalled')));
  assert.match(await page.textContent('#toastText'), /Приложение установлено/);
  assert.deepEqual(page.errors, []);
  await ctx.close();
});

test('сохранённые исходные данные: скачать и удалить', async () => {
  const ctx = await env.context();
  const page = await settingsPage(
    ctx,
    configured({ good: entry(today(), 100), bad: { kind: 'gift', amount: 'много' } }),
  );
  assert.equal(await page.isVisible('#rawCopies'), true);
  const [dl] = await Promise.all([
    page.waitForEvent('download'),
    page.click('#rawList button:has-text("Скачать")'),
  ]);
  assert.equal(JSON.parse(await readFile(await dl.path(), 'utf8')).entries.bad.kind, 'gift');

  await page.click('#rawList button:has-text("Удалить")');
  await page.waitForSelector('#dialog[open]');
  await page.click('#dialogCancel'); // передумал
  assert.equal(await page.locator('#rawList li').count(), 1);
  await page.click('#rawList button:has-text("Удалить")');
  await page.waitForSelector('#dialog[open]');
  await page.click('#dialogOk');
  await page.waitForFunction(() => document.querySelector('#rawCopies').hidden);
  assert.equal(
    await page.evaluate(() => Object.keys(localStorage).filter((k) => k.includes('-raw-')).length),
    0,
  );
  await ctx.close();
});

test('баннеры: напоминание о копии (изменения, давность), «вчера» в настройках', async () => {
  const day = 86_400_000;
  const prefs = (extra) => ({ 'kopilkamoto-prefs-v2': { theme: 'auto', ...extra } });
  const entries = { a: entry(today(), 1), b: entry(today(), 2), c: entry(today(), 3) };
  const ctx = await env.context();

  let page = await open(ctx, env.base, {
    storage: {
      ...configured(entries),
      ...prefs({ lastBackupAt: Date.now() - 2 * day, changesSinceBackup: 25 }),
    },
  });
  assert.match(await page.textContent('#backupBannerText'), /изменено 25 записей/);

  page = await open(ctx, env.base, {
    storage: {
      ...configured(entries),
      ...prefs({ lastBackupAt: Date.now() - 20 * day, changesSinceBackup: 2 }),
    },
  });
  assert.match(await page.textContent('#backupBannerText'), /20 дн\. назад/);

  page = await open(ctx, env.base, {
    storage: {
      ...configured(entries),
      ...prefs({ lastBackupAt: Date.now() - 1.5 * day, changesSinceBackup: 0 }),
    },
    hash: '#settings',
  });
  assert.match(await page.textContent('#backupInfo'), /вчера/);
  await ctx.close();
});

test('localStorage недоступен (приватный режим): предупреждение, приложение работает в памяти', async () => {
  const ctx = await env.context();
  const page = await ctx.newPage();
  await page.addInitScript(() => {
    Storage.prototype.setItem = () => {
      throw new DOMException('quota', 'QuotaExceededError');
    };
  });
  await page.goto(env.base);
  await page.waitForSelector('html[data-ready]');
  assert.equal(await page.isVisible('#storageBanner'), true);
  assert.equal(await page.isVisible('#backupBanner'), false);
  // записи работают в памяти страницы: ошибок нет, баннер заранее предупредил, что после закрытия они пропадут
  await page.click('#quickSpend .preset >> nth=0');
  assert.match(await page.textContent('#toastText'), /Записано: Электричка/);
  assert.equal(await page.locator('#recent .entry').count(), 1);
  await page.click('[data-nav=settings]');
  assert.match(await page.textContent('#storageInfo'), /недоступно/);
  await ctx.close();
});
