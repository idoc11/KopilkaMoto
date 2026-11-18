import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, open, entry, configured, today } from './helpers.mjs';

const PROXY = 'https://proxy.example/';
let env;
before(async () => (env = await setup()));
after(() => env.close());

function withProxy(entries = {}) {
  return { ...configured(entries), 'kopilkamoto-prefs-v2': { theme: 'auto', apiUrl: PROXY } };
}

async function ask(page, text) {
  const before = await page.locator('#chat .bubble').count();
  await page.fill('#question', text);
  await page.click('#send');
  await page.waitForFunction(
    (n) => !document.querySelector('#chat .typing') && document.querySelectorAll('#chat .bubble').length >= n,
    before,
  );
}

test('P0-2: длинная переписка не ломает чат — запросы укладываются в бюджет', async () => {
  const ctx = await env.context();
  const entries = {};
  for (let i = 0; i < 80; i++)
    entries['k' + i] = entry(today(), 3000, 'delivery', {
      note: 'Смена в доставке, вечерний слот, бонус за погоду и пиковые часы',
      ts: i + 1,
    });
  const page = await open(ctx, env.base, { storage: withProxy(entries), hash: '#ai' });
  const sizes = [];
  const long = 'Ответ '.repeat(700);
  await page.route(PROXY + '**', (route) => {
    const body = route.request().postData();
    sizes.push(Buffer.byteLength(body));
    const parsed = JSON.parse(body);
    assert.equal(parsed.messages.at(-1).role, 'user');
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ reply: long }),
    });
  });
  for (let i = 0; i < 8; i++) await ask(page, 'Вопрос ' + i);
  assert.equal(sizes.length, 8);
  assert.ok(Math.max(...sizes) <= 24_000, sizes.join(','));
  assert.equal(await page.locator('#chat .bubble.error').count(), 0);
  await ctx.close();
});

test('ошибка прокси: понятный текст, вопрос возвращается в поле, история не портится', async () => {
  const ctx = await env.context();
  const page = await open(ctx, env.base, { storage: withProxy(), hash: '#ai' });
  await page.route(PROXY + '**', (route) =>
    route.fulfill({
      status: 429,
      contentType: 'application/json',
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({
        error: 'rate_limited',
        message: 'Слишком много вопросов подряд. Подожди минуту.',
      }),
    }),
  );
  await ask(page, 'Сколько смен до цели?');
  assert.match(await page.textContent('#chat .bubble.error'), /Подожди минуту/);
  assert.equal(await page.inputValue('#question'), 'Сколько смен до цели?');
  assert.equal(await page.evaluate(() => localStorage.getItem('kopilkamoto-chat-v1')), null);
  await page.unroute(PROXY + '**');
  await page.route(PROXY + '**', (route) => route.abort('connectionrefused'));
  await page.click('#send');
  await page.waitForSelector('#chat .bubble.error');
  assert.match(await page.textContent('#chat .bubble.error'), /Не удалось связаться/);
  await ctx.close();
});

test('P2-19: ответ в Markdown отображается безопасно, чат сохраняется и очищается', async () => {
  const ctx = await env.context();
  const page = await open(ctx, env.base, { storage: withProxy({ a: entry(today(), 100) }), hash: '#ai' });
  let body;
  await page.route(PROXY + '**', (route) => {
    body = JSON.parse(route.request().postData());
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({
        reply: '### План\n- Копи **2 000 ₽** в день\n- Без <img src=x onerror="window.pwned=1">',
      }),
    });
  });
  await ask(page, 'План?');
  assert.equal(await page.locator('#chat .bubble.ai strong').textContent(), '2 000 ₽');
  assert.equal(await page.locator('#chat .bubble.ai li').count(), 2);
  assert.equal(await page.locator('#chat img').count(), 0);
  assert.equal(await page.evaluate(() => window.pwned), undefined);
  assert.equal(body.context.today, today());
  assert.ok('deadline' in body.context && 'neededPerDay' in body.context);
  await page.reload();
  assert.equal(await page.locator('#chat .bubble.user').count(), 1);
  await page.click('#clearChat');
  await page.click('#dialogOk');
  await page.waitForFunction(() => !document.querySelector('#chat .bubble.user'));
  assert.deepEqual(page.errors, []);
  await ctx.close();
});

test('без адреса прокси — переход в настройки', async () => {
  const ctx = await env.context();
  const page = await open(ctx, env.base, { storage: configured(), hash: '#ai' });
  await page.fill('#question', 'Привет');
  await page.click('#send');
  assert.equal(await page.isVisible('#page-settings'), true);
  await ctx.close();
});
