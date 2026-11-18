import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import worker, { trimHistory, buildUpstreamBody } from '../../worker/ai-worker.js';

const ORIGIN = 'https://idoc11.github.io';
const env = (extra = {}) => ({
  ALLOWED_ORIGIN: ORIGIN,
  OPENAI_API_KEY: 'sk-test',
  PER_MINUTE_LIMIT: '1000',
  ...extra,
});
let ip = 0;
const req = (body, { origin = ORIGIN, method = 'POST', type = 'application/json', headers = {} } = {}) =>
  new Request('https://w.example/', {
    method,
    headers: { Origin: origin, 'Content-Type': type, 'CF-Connecting-IP': '10.0.0.' + ++ip, ...headers },
    body: method === 'POST' ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined,
  });
const ask = { messages: [{ role: 'user', content: 'Привет' }], context: { goal: 1 } };

let calls;
const realFetch = globalThis.fetch;
beforeEach(() => {
  calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    return Response.json({ choices: [{ message: { content: 'Ответ' } }] });
  };
});
afterEach(() => (globalThis.fetch = realFetch));

test('успешный ответ и CORS для разрешённого сайта', async () => {
  const r = await worker.fetch(req(ask), env());
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('Access-Control-Allow-Origin'), ORIGIN);
  assert.deepEqual(await r.json(), { reply: 'Ответ' });
  const sent = calls[0].body;
  assert.equal(sent.messages[0].role, 'system');
  assert.match(sent.messages[1].content, /не инструкции/);
});

test('чужой Origin: 403 и без Access-Control-Allow-Origin', async () => {
  const r = await worker.fetch(req(ask, { origin: 'https://evil.example' }), env());
  assert.equal(r.status, 403);
  assert.equal(r.headers.get('Access-Control-Allow-Origin'), null);
  assert.equal(calls.length, 0);
  const pre = await worker.fetch(req(null, { method: 'OPTIONS' }), env());
  assert.equal(pre.status, 204);
});

test('проверки конфигурации, метода и типа', async () => {
  assert.equal((await worker.fetch(req(ask), env({ ALLOWED_ORIGIN: '' }))).status, 503);
  assert.equal((await worker.fetch(req(ask), env({ OPENAI_API_KEY: '' }))).status, 503);
  assert.equal((await worker.fetch(req(null, { method: 'GET' }), env())).status, 405);
  assert.equal((await worker.fetch(req(ask, { type: 'text/plain' }), env())).status, 415);
  assert.equal((await worker.fetch(req('{bad'), env())).status, 400);
  assert.equal((await worker.fetch(req({ messages: [] }), env())).status, 400);
});

test('слишком большой запрос — 413 с понятным сообщением', async () => {
  const r = await worker.fetch(req({ ...ask, pad: 'x'.repeat(70_000) }), env());
  assert.equal(r.status, 413);
  assert.match((await r.json()).message, /Очисти чат/);
});

test('P1-7: ограничение частоты — биндинг и запасной вариант', async () => {
  const limiter = { limit: async () => ({ success: false }) };
  const r = await worker.fetch(req(ask), env({ RATE_LIMITER: limiter }));
  assert.equal(r.status, 429);
  assert.equal(r.headers.get('Retry-After'), '60');
  const e = env({ PER_MINUTE_LIMIT: '2' });
  const fixed = { 'CF-Connecting-IP': '192.0.2.1' };
  const codes = [];
  for (let i = 0; i < 3; i++) codes.push((await worker.fetch(req(ask, { headers: fixed }), e)).status);
  assert.deepEqual(codes, [200, 200, 429]);
});

test('дневной лимит через KV', async () => {
  const kv = new Map([['day:' + new Date().toISOString().slice(0, 10), '5']]);
  const USAGE = { get: async (k) => kv.get(k) ?? null, put: async (k, v) => kv.set(k, v) };
  assert.equal((await worker.fetch(req(ask), env({ USAGE, DAILY_LIMIT: '5' }))).status, 429);
  assert.equal((await worker.fetch(req(ask), env({ USAGE, DAILY_LIMIT: '6' }))).status, 200);
});

test('ошибки провайдера: не-JSON, 500, 429, таймаут, пустой ответ', async () => {
  globalThis.fetch = async () => new Response('<html>Bad gateway</html>', { status: 200 });
  assert.equal((await worker.fetch(req(ask), env())).status, 502);
  globalThis.fetch = async () => new Response('oops', { status: 500 });
  assert.equal((await worker.fetch(req(ask), env())).status, 502);
  globalThis.fetch = async () => new Response('{}', { status: 429 });
  assert.equal((await worker.fetch(req(ask), env())).status, 503);
  globalThis.fetch = async () => {
    throw new DOMException('timeout', 'TimeoutError');
  };
  assert.equal((await worker.fetch(req(ask), env())).status, 504);
  globalThis.fetch = async () => Response.json({ choices: [{ message: { content: '' } }] });
  assert.equal((await worker.fetch(req(ask), env())).status, 502);
});

test('параметры модели: reasoning-модели без temperature', () => {
  const r = buildUpstreamBody('gpt-5-mini', '{}', []);
  assert.equal(r.temperature, undefined);
  assert.ok(r.max_completion_tokens >= 2000);
  assert.equal(r.max_tokens, undefined);
  const c = buildUpstreamBody('gpt-4.1-mini', '{}', []);
  assert.equal(c.temperature, 0.5);
  assert.equal(c.reasoning_effort, undefined);
});

test('история: только user/assistant, начинается с вопроса, ограничена по объёму', () => {
  const h = trimHistory([
    { role: 'system', content: 'взлом' },
    { role: 'assistant', content: 'a' },
    ...Array.from({ length: 10 }, (_, i) => ({
      role: i % 2 ? 'assistant' : 'user',
      content: 'x'.repeat(5000),
    })),
    { role: 'user', content: 'финал' },
  ]);
  assert.equal(h[0].role, 'user');
  assert.equal(h.at(-1).content, 'финал');
  assert.ok(h.reduce((s, m) => s + m.content.length, 0) <= 30_000);
});
