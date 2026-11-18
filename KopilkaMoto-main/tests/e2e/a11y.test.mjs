import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { AxeBuilder } from '@axe-core/playwright';
import { setup, open, configured, entry, today, shift } from './helpers.mjs';

let env;
before(async () => (env = await setup()));
after(() => env.close());

const data = configured(
  {
    a: entry(today(), 3000, 'delivery', { hours: 6, note: 'Смена' }),
    b: entry(shift(-1), 800, 'spent', { note: 'Шлем' }),
    c: entry(shift(-2), 1200, 'other'),
  },
  { start: 1000 },
);

for (const theme of ['light', 'dark']) {
  for (const page of ['home', 'add', 'history', 'ai', 'settings']) {
    test(`axe: ${page}, тема ${theme} — без нарушений WCAG 2.1 AA`, async () => {
      const ctx = await env.context({ colorScheme: theme });
      const p = await open(ctx, env.base, { storage: data, hash: '#' + page });
      const res = await new AxeBuilder({ page: p })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze();
      const issues = res.violations.map(
        (v) =>
          `${v.id}: ${v.nodes
            .map((n) => n.target.join(' '))
            .slice(0, 3)
            .join(', ')}`,
      );
      assert.deepEqual(issues, []);
      await ctx.close();
    });
  }
}

test('онбординг доступен', async () => {
  const ctx = await env.context();
  const p = await open(ctx, env.base);
  const res = await new AxeBuilder({ page: p }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  assert.deepEqual(
    res.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`),
    [],
  );
  await ctx.close();
});

test('узкий экран 320px: нигде нет горизонтальной прокрутки и вылезающих элементов', async () => {
  const ctx = await env.context({ viewport: { width: 320, height: 640 } });
  for (const page of ['home', 'add', 'history', 'ai', 'settings']) {
    const p = await open(ctx, env.base, { storage: data, hash: '#' + page });
    const overflow = await p.evaluate(() => {
      const w = document.documentElement.clientWidth;
      const bad = [...document.querySelectorAll('.page:not([hidden]) *')]
        .filter((el) => el.getClientRects().length && el.getBoundingClientRect().right > w + 0.5)
        .map((el) => el.id || el.className || el.tagName);
      return { scroll: document.documentElement.scrollWidth > w, bad: bad.slice(0, 5) };
    });
    assert.deepEqual(overflow, { scroll: false, bad: [] }, page);
    await p.close();
  }
  await ctx.close();
});
