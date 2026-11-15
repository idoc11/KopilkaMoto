import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, open, configured } from './helpers.mjs';

// Регрессионные тесты политики безопасности: защита от XSS должна держаться на механизме (CSP + Trusted Types),
// а не только на аккуратности кода.
let env;
before(async () => (env = await setup()));
after(() => env.close());

test('CSP: запись HTML-строк в DOM запрещена (Trusted Types)', async () => {
  const ctx = await env.context();
  const page = await open(ctx, env.base, { storage: configured() });
  const result = await page.evaluate(() => {
    const tryIt = (fn) => {
      try {
        fn();
        return 'allowed';
      } catch (e) {
        return e.name;
      }
    };
    const div = document.createElement('div');
    return {
      innerHTML: tryIt(() => (div.innerHTML = '<img src=x onerror="window.__pwned=1">')),
      insertAdjacentHTML: tryIt(() => div.insertAdjacentHTML('beforeend', '<b>x</b>')),
      outerHTML: tryIt(() => (document.createElement('span').outerHTML = '<b>x</b>')),
      scriptText: tryIt(() => (document.createElement('script').textContent = 'window.__pwned=1')),
      documentWrite: tryIt(() => document.write('<b>x</b>')),
    };
  });
  assert.deepEqual(result, {
    innerHTML: 'TypeError',
    insertAdjacentHTML: 'TypeError',
    outerHTML: 'TypeError',
    scriptText: 'TypeError',
    documentWrite: 'TypeError',
  });
  assert.equal(await page.evaluate(() => window.__pwned), undefined);
  await ctx.close();
});

test('CSP: инлайн-обработчики не выполняются, картинки только со своего сайта', async () => {
  const ctx = await env.context();
  const page = await open(ctx, env.base, { storage: configured() });
  const r = await page.evaluate(async () => {
    const violations = [];
    document.addEventListener('securitypolicyviolation', (e) => violations.push(e.effectiveDirective));
    // Инлайн-обработчик: Trusted Types не дают даже записать его в атрибут.
    let handler;
    try {
      document.createElement('button').setAttribute('onclick', 'window.__pwned = 1');
      handler = 'allowed';
    } catch (e) {
      handler = e.name;
    }
    const img = document.createElement('img');
    img.src = 'data:image/gif;base64,R0lGODlhAQABAAAAACw=';
    document.body.append(img);
    await new Promise((r) => setTimeout(r, 300));
    img.remove();
    return { handler, pwned: window.__pwned, violations: [...new Set(violations)].sort() };
  });
  assert.equal(r.handler, 'TypeError');
  assert.equal(r.pwned, undefined);
  assert.deepEqual(r.violations, ['img-src', 'require-trusted-types-for']);
  await ctx.close();
});

test('генератор DOM не создаёт ссылок javascript: и data:', async () => {
  const ctx = await env.context();
  const page = await open(ctx, env.base, { storage: configured() });
  const hrefs = await page.evaluate(async () => {
    const { h } = await import('./js/dom.js');
    const make = (href) => h('a', { href }).getAttribute('href');
    return [
      make('javascript:alert(1)'),
      make(' JaVaScRiPt:alert(1)'),
      make('data:text/html,<b>x</b>'),
      make('vbscript:x'),
      make('blob:' + location.origin + '/abc'),
      make('#home'),
      make('./x.json'),
      make('https://example.com/'),
    ];
  });
  assert.deepEqual(hrefs, [
    null,
    null,
    null,
    null,
    'blob:' + new URL(env.base).origin + '/abc',
    '#home',
    './x.json',
    'https://example.com/',
  ]);
  await ctx.close();
});

test('Trusted Types: единственная политика пропускает только адрес service worker', async () => {
  const ctx = await env.context({ serviceWorkers: 'allow' });
  const page = await open(ctx, env.base, { storage: configured() });
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 15000 });
  const r = await page.evaluate(async () => {
    const tryIt = (fn) => {
      try {
        fn();
        return 'allowed';
      } catch (e) {
        return e.name;
      }
    };
    const { serviceWorkerUrl } = await import('./js/dom.js');
    return {
      registered: Boolean(await navigator.serviceWorker.getRegistration()),
      sameUrlTwice: String(serviceWorkerUrl()) === './service-worker.js',
      otherPolicy: tryIt(() => trustedTypes.createPolicy('evil', { createHTML: (s) => s })),
      duplicatePolicy: tryIt(() => trustedTypes.createPolicy('kopilkamoto-sw', {})),
    };
  });
  assert.deepEqual(r, {
    registered: true,
    sameUrlTwice: true,
    otherPolicy: 'TypeError',
    duplicatePolicy: 'TypeError',
  });
  // В консоли — только сообщения о двух заблокированных нами попытках, других ошибок нет.
  assert.deepEqual(
    page.errors.filter((e) => !/TrustedTypePolicy named '(evil|kopilkamoto-sw)'/.test(e)),
    [],
  );
  await ctx.close();
});
