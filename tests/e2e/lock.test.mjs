import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, open, entry, configured, shift, stored } from './helpers.mjs';

let env;
before(async () => (env = await setup()));
after(() => env.close());

function tenDays() {
  const entries = {};
  for (let i = 0; i < 10; i++) entries['d' + i] = entry(shift(-i), 1000, 'delivery', { ts: 1000 + i });
  return entries;
}

test('прогноз даты покупки на главной', async () => {
  const ctx = await env.context();
  const page = await open(ctx, env.base, { storage: configured(tenDays(), { goal: 20000 }) });
  assert.match(
    await page.textContent('#forecast'),
    /копишь ≈ [\d\s]+₽ в день — цель будет \d\d\.\d\d\.\d{4}/,
  );
  const empty = await open(ctx, env.base, { storage: configured() });
  assert.match(await empty.textContent('#forecast'), /после первых записей/);
  await ctx.close();
});

test('замок до цели: подтверждение с задержкой, отмена и счётчик расходов', async () => {
  const ctx = await env.context();
  const page = await open(ctx, env.base, { storage: configured(tenDays()), hash: '#settings' });
  await page.check('#lockToggle');
  assert.equal(
    (await page.evaluate(() => JSON.parse(localStorage.getItem('kopilkamoto-prefs-v2')))).lock,
    true,
  );

  await page.click('[data-nav=home]');
  assert.match(await page.textContent('#lockInfo'), /ничего не брали/);

  await page.click('[data-add=spent]');
  await page.fill('#amount', '2500');
  await page.click('#saveEntry');
  await page.waitForSelector('#dialog[open]');
  assert.match(await page.textContent('#dialogText'), /отодвинет покупку примерно на 3 дн\./);
  assert.equal(await page.isDisabled('#dialogOk'), true, 'подтвердить сразу нельзя');
  await page.click('#dialogCancel');
  assert.equal(Object.keys((await stored(page)).entries).length, 10, 'отмена ничего не записывает');

  await page.click('#saveEntry');
  await page.waitForSelector('#dialogOk:not([disabled])', { timeout: 5000 });
  await page.click('#dialogOk');
  await page.waitForFunction(() => location.hash === '#home');
  assert.match(await page.textContent('#lockInfo'), /брали 1 раз на 2\s500\s₽/);

  // Доход замок не трогает
  await page.click('[data-add=delivery]');
  await page.fill('#amount', '100');
  await page.click('#saveEntry');
  assert.equal(await page.isVisible('#dialog'), false);
  assert.deepEqual(page.errors, []);
  await ctx.close();
});
