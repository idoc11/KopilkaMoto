import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { setup, open, configured, entry, today } from './helpers.mjs';

let env;
before(async () => (env = await setup()));
after(() => env.close());

const controlled = (page) =>
  page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 15000 });

test('P1-8: офлайн-запуск и обновление по кнопке', async () => {
  const ctx = await env.context({ serviceWorkers: 'allow' });
  const page = await open(ctx, env.base, { storage: configured({ a: entry(today(), 700) }) });
  await controlled(page);

  // Офлайн: приложение открывается из кеша, посторонние файлы не кешируются.
  await ctx.setOffline(true);
  await page.reload();
  await page.waitForSelector('html[data-ready]');
  assert.match(await page.textContent('#total'), /700/);
  const keys = await page.evaluate(async () => {
    const c = await caches.open((await caches.keys())[0]);
    return (await c.keys()).map((r) => new URL(r.url).pathname);
  });
  assert.ok(!keys.some((k) => /README|worker|package/.test(k)), keys.join());
  await ctx.setOffline(false);

  // Новая версия: появляется баннер, после нажатия страница перезагружается под новым SW.
  const sw = await readFile('service-worker.js', 'utf8');
  env.overrides.set('/service-worker.js', sw.replace("const BUILD = 'dev'", "const BUILD = 'next'"));
  await page.evaluate(async () => (await navigator.serviceWorker.getRegistration()).update());
  await page.waitForSelector('#updateBanner:not([hidden])', { timeout: 15000 });
  await Promise.all([page.waitForEvent('load'), page.click('#updateBtn')]);
  await page.waitForSelector('html[data-ready]');
  const cacheNames = await page.evaluate(() => caches.keys());
  assert.deepEqual(cacheNames, ['kopilkamoto-v8-next']);
  env.overrides.clear();
  assert.deepEqual(page.errors, []);
  await ctx.close();
});

test('переход со старой версии: старые кеши удаляются, новый SW активируется сразу', async () => {
  const ctx = await env.context({ serviceWorkers: 'allow' });
  const page = await ctx.newPage();
  await page.goto(env.base + 'manifest.webmanifest');
  await page.evaluate(async () => {
    await (await caches.open('kopilkamoto-v7')).put('./index.html', new Response('old'));
  });
  await page.goto(env.base);
  await controlled(page);
  await page.waitForFunction(async () => !(await caches.keys()).includes('kopilkamoto-v7'));
  await ctx.close();
});

test('манифест и иконки доступны и корректны', async () => {
  const m = JSON.parse(await readFile('manifest.webmanifest', 'utf8'));
  const purposes = m.icons.map((i) => i.purpose);
  assert.ok(purposes.includes('maskable') && !purposes.some((p) => p.includes(' ')));
  for (const size of ['192x192', '512x512'])
    assert.ok(m.icons.some((i) => i.sizes === size && i.type === 'image/png'));
  const ctx = await env.context();
  const page = await ctx.newPage();
  for (const i of [...m.icons, { src: './icons/apple-touch-icon.png' }]) {
    const r = await page.goto(new URL(i.src, env.base).href);
    assert.equal(r.status(), 200, i.src);
  }
  await ctx.close();
});
