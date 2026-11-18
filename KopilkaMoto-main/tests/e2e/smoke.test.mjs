import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { setup, open, configured, entry, today, shift } from './helpers.mjs';

// Обход собранного сайта (как на GitHub Pages): все разделы, темы и размеры экрана.
// Ловит ошибки JS, нарушения CSP, неудачные и 4xx/5xx-запросы, горизонтальную прокрутку.
test('собранный сайт: нет ошибок на всех разделах, темах и экранах', async () => {
  execFileSync('node', ['scripts/build.mjs', 'smoke'], { stdio: 'ignore' });
  const env = await setup({ root: '_site' });
  const data = configured(
    {
      a: entry(today(), 3000, 'delivery', { hours: 6, note: 'Смена' }),
      b: entry(shift(-1), 800, 'spent', { note: 'Шлем' }),
      c: entry(shift(-3), 1200, 'other'),
    },
    { start: 50000 },
  );
  const problems = [];
  const viewports = [
    { width: 320, height: 640 },
    { width: 390, height: 844 },
    { width: 768, height: 1024 },
    { width: 1280, height: 800 },
  ];
  for (const viewport of viewports) {
    for (const colorScheme of ['light', 'dark']) {
      const ctx = await env.context({
        viewport,
        colorScheme,
        reducedMotion: 'no-preference',
        serviceWorkers: 'allow',
      });
      ctx.on('requestfailed', (r) => problems.push(`requestfailed ${r.url()} ${r.failure()?.errorText}`));
      ctx.on('response', (r) => r.status() >= 400 && problems.push(`HTTP ${r.status()} ${r.url()}`));
      const page = await open(ctx, env.base, { storage: data });
      await page.evaluate(() =>
        document.addEventListener('securitypolicyviolation', (e) =>
          console.error(`CSP: ${e.violatedDirective} ${e.blockedURI}`),
        ),
      );
      for (const p of ['home', 'add', 'history', 'ai', 'settings']) {
        await page.click(`[data-nav=${p}]`);
        await page.waitForTimeout(80);
        const wide = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
        if (wide) problems.push(`горизонтальная прокрутка: ${p} ${viewport.width}px ${colorScheme}`);
      }
      // шрифт и иконки реально загрузились
      const fontOk = await page.evaluate(async () => {
        await document.fonts.ready;
        return document.fonts.check('20px "Russo One"', 'Копилка');
      });
      if (!fontOk) problems.push(`шрифт Russo One не загрузился (${viewport.width}px)`);
      problems.push(...page.errors.map((e) => `${viewport.width}px ${colorScheme}: ${e}`));
      await ctx.close();
    }
  }
  await env.close();
  assert.deepEqual(problems, []);
});
