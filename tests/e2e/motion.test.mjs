import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, open, entry, configured, today, shift, stored, addEntry } from './helpers.mjs';

let env;
before(async () => (env = await setup()));
after(() => env.close());

const motion = () => env.context({ reducedMotion: 'no-preference' });

test('сумма плавно досчитывает до точного значения, мотоцикл выезжает со старта', async () => {
  const ctx = await motion();
  const page = await open(ctx, env.base, { storage: configured({ a: entry(today(), 150000) }) });
  const early = await page.textContent('#total');
  await page.waitForFunction(() => document.querySelector('#total').textContent.startsWith('150'));
  assert.notEqual(early, await page.textContent('#total'), 'сумма должна меняться во время анимации');
  await page.waitForTimeout(700);
  assert.match(await page.textContent('#total'), /^150\s000\s₽$/);
  assert.equal(
    await page.evaluate(() => document.querySelector('#progress').style.getPropertyValue('--p')),
    '25%',
  );
  assert.equal(
    await page.evaluate(() => document.querySelector('#chart').classList.contains('animate')),
    true,
  );
  await ctx.close();
});

test('новая запись: дорога «едет», запись подсвечивается, новая отметка с тостом', async () => {
  const ctx = await motion();
  const page = await open(ctx, env.base, { storage: configured({ a: entry(shift(-1), 50000) }) });
  await addEntry(page, { amount: 20000 });
  assert.equal(
    await page.evaluate(() => document.querySelector('#progress').classList.contains('driving')),
    true,
  );
  assert.equal(await page.locator('#recent .entry.flash').count(), 1);
  assert.equal(await page.locator('#achievements .mark.fresh').count(), 1);
  await page.waitForFunction(() =>
    document.querySelector('#toastText').textContent.startsWith('Новая отметка: 10%'),
  );
  await ctx.close();
});

test('удаление анимируется и всё равно удаляет запись', async () => {
  const ctx = await motion();
  const page = await open(ctx, env.base, {
    storage: configured({ a: entry(today(), 100, 'delivery', { note: 'X' }) }),
  });
  await page.click('#recent [aria-label^="Удалить: X"]');
  assert.equal(await page.locator('#recent .entry.leaving').count(), 1);
  await page.waitForFunction(() => !document.querySelector('#recent .entry'));
  assert.deepEqual((await stored(page)).entries, {});
  await ctx.close();
});

test('с «уменьшить движение» анимаций нет, сумма сразу точная', async () => {
  const ctx = await env.context();
  const page = await open(ctx, env.base, { storage: configured({ a: entry(today(), 150000) }) });
  assert.match(await page.textContent('#total'), /^150\s000\s₽$/);
  assert.equal(
    await page.evaluate(() => document.querySelector('#chart').classList.contains('animate')),
    false,
  );
  await ctx.close();
});
