import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { AxeBuilder } from '@axe-core/playwright';
import { setup, open, configured, entry, shift } from './helpers.mjs';

let env;
before(async () => (env = await setup()));
after(() => env.close());

/** Пятницы — 4000 за 8 ч, вторники — 2000 за 8 ч, субботы — 3000: не зависит от того, какой сегодня день. */
function weeks() {
  const en = {};
  for (let d = 0; d < 56; d++) {
    const day = new Date(Date.now() - d * 864e5).getDay();
    const [amount, hours] = day === 5 ? [4000, 8] : day === 2 ? [2000, 8] : day === 6 ? [3000, 0] : [0, 0];
    if (amount) en['e' + d] = entry(shift(-d), amount, 'delivery', { hours, ts: d + 2 });
  }
  return configured(en, { goal: 100000, startDate: shift(-60), deadline: shift(120) });
}

test('«когда выгоднее работать»: лучший и слабый день, строки по дням недели', async () => {
  const ctx = await env.context();
  const page = await open(ctx, env.base, { storage: weeks() });
  assert.equal((await page.textContent('#insightsBadge')).trim(), 'Пт');
  await page.click('#insightsCard summary');
  const lead = await page.textContent('#insightsLead');
  assert.match(lead, /Лучший день — пятница: в среднем 4\s000\s₽ за смену, ≈ 500\s₽ в час \(8 смен\)/);
  assert.match(lead, /Слабее всего — вторник: 2\s000\s₽/);
  assert.equal(await page.locator('#insightsList li').count(), 7);
  assert.equal(await page.locator('#insightsList li.best .spend-label').textContent(), 'Пт');
  assert.equal(await page.locator('#insightsList li.worst .spend-label').textContent(), 'Вт');
  assert.match(await page.locator('#insightsList li').first().textContent(), /Пн\s*нет смен/);
  assert.deepEqual(page.errors, []);
  await ctx.close();
});

test('«когда выгоднее работать»: пустые состояния', async () => {
  const ctx = await env.context();
  let page = await open(ctx, env.base, { storage: configured() });
  assert.match(await page.textContent('#insightsLead'), /Пока нет смен/);
  assert.equal(await page.isHidden('#insightsBadge'), true);
  await page.close();
  const few = configured({ a: entry(shift(-1), 1000), b: entry(shift(-2), 1000) });
  page = await open(ctx, env.base, { storage: few });
  assert.match(await page.textContent('#insightsLead'), /Нужно хотя бы 8 смен.*сейчас 2/);
  await ctx.close();
});

for (const theme of ['light', 'dark']) {
  test(`axe: «когда выгоднее работать» раскрыт, тема ${theme}`, async () => {
    const ctx = await env.context({ colorScheme: theme });
    const page = await open(ctx, env.base, { storage: weeks() });
    await page.click('#insightsCard summary');
    const res = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
    assert.deepEqual(
      res.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(' ')}`),
      [],
    );
    await ctx.close();
  });
}

test('календарь смен: клетки закрашены по сменам, сводка и подпись', async () => {
  const ctx = await env.context();
  const page = await open(ctx, env.base, { storage: weeks() });
  assert.equal(await page.locator('#calendarGrid .cal-cell').count(), 84);
  assert.ok((await page.locator('#calendarGrid .cal-cell.l4').count()) >= 8);
  assert.equal(await page.locator('#calendarGrid .cal-cell.now').count(), 1);
  assert.match(
    await page.getAttribute('#calendarGrid', 'aria-label'),
    /Календарь смен за 12 недель: \d+ смен/,
  );
  assert.match(await page.textContent('#calendarSummary'), /За 12 недель — \d+ смен/);
  await page.close();
  const empty = await open(ctx, env.base, { storage: configured() });
  assert.match(await empty.textContent('#calendarSummary'), /Смен за 12 недель пока нет/);
  assert.match(await empty.getAttribute('#calendarGrid', 'aria-label'), /смен пока нет/);
  await ctx.close();
});
