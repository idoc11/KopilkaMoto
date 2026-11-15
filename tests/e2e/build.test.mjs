import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { setup, open } from './helpers.mjs';

test('собранный сайт (_site) работает и не содержит лишних файлов', async () => {
  execFileSync('node', ['scripts/build.mjs', 'e2e'], { stdio: 'ignore' });
  const env = await setup({ root: '_site' });
  const ctx = await env.context({ serviceWorkers: 'allow' });
  const page = await open(ctx, env.base);
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 15000 });
  assert.deepEqual(await page.evaluate(() => caches.keys()), ['kopilkamoto-v8-e2e']);
  for (const path of ['README.md', 'worker/ai-worker.js', 'package.json', 'tests/unit/core.test.mjs']) {
    const r = await page.request.get(env.base + path);
    assert.equal(r.status(), 404, path);
  }
  assert.deepEqual(page.errors, []);
  await env.close();
});
