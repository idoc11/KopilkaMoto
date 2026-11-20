import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { AxeBuilder } from '@axe-core/playwright';
import { setup, open, configured, entry, shift } from './helpers.mjs';

let env;
before(async () => (env = await setup()));
after(() => env.close());

const data = () =>
  configured(
    {
      a: entry(shift(0), 3000, 'delivery', { hours: 8, ts: 2 }),
      b: entry(shift(0), 500, 'spent', { ts: 3 }),
    },
    { goal: 100000, startDate: shift(-30), deadline: shift(90) },
  );

const text = async (page) => (await page.textContent('#reportText')).replaceAll(' ', ' ');

test('итоги: неделя и месяц, переключение и копирование', async () => {
  const ctx = await env.context();
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write']);
  const page = await open(ctx, env.base, { storage: data() });
  assert.equal(await page.getAttribute('#reportWeek', 'aria-pressed'), 'true');
  let t = await text(page);
  assert.match(t, /^Итоги недели \(/);
  assert.match(t, /Доход: 3 000 ₽, расходы: 500 ₽, итого: \+2 500 ₽\./);
  assert.match(t, /Смен: 1 смена, в среднем 3 000 ₽, 8 ч, ≈ 375 ₽ в час\./);

  await page.click('#reportMonth');
  assert.equal(await page.getAttribute('#reportMonth', 'aria-pressed'), 'true');
  assert.equal(await page.getAttribute('#reportWeek', 'aria-pressed'), 'false');
  t = await text(page);
  assert.match(t, /^Итоги месяца \(/);
  assert.match(t, /Доход: 3 000 ₽/);

  await page.click('#reportCopy');
  await page.waitForFunction(() => document.querySelector('#toastText').textContent === 'Итог скопирован');
  assert.equal((await page.evaluate(() => navigator.clipboard.readText())).replaceAll(' ', ' '), t);

  // выбор периода не сбрасывается при перерисовке главной
  await page.click('[data-nav=history]');
  await page.click('[data-nav=home]');
  assert.match(await text(page), /^Итоги месяца/);
  assert.deepEqual(page.errors, []);
  await ctx.close();
});

test('итоги: пустое состояние и ошибка копирования', async () => {
  const ctx = await env.context();
  const page = await open(ctx, env.base, { storage: configured() });
  assert.equal((await text(page)).trim(), 'Итоги недели: пока нет записей.');
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: () => Promise.reject(new Error('no')) },
    });
  });
  await page.click('#reportCopy');
  await page.waitForFunction(() =>
    document.querySelector('#toastText').textContent.startsWith('Не удалось скопировать'),
  );
  await ctx.close();
});

for (const theme of ['light', 'dark']) {
  test(`axe: «Итоги», тема ${theme}`, async () => {
    const ctx = await env.context({ colorScheme: theme });
    const page = await open(ctx, env.base, { storage: data() });
    const res = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
    assert.deepEqual(
      res.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(' ')}`),
      [],
    );
    await ctx.close();
  });
}
