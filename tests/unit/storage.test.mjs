import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore, normalizePrefs } from '../../js/storage.js';
import { STORAGE_KEY, RAW_PREFIX } from '../../js/core.js';

function fakeStorage(init = {}, { failWrites = false } = {}) {
  const m = new Map(Object.entries(init));
  return {
    map: m,
    get length() {
      return m.size;
    },
    key: (i) => [...m.keys()][i] ?? null,
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem(k, v) {
      if (failWrites) throw new Error('QuotaExceededError');
      m.set(k, String(v));
    },
    removeItem: (k) => m.delete(k),
  };
}
const now = () => new Date('2026-11-15T10:00:00Z');

test('P0-1: битые записи сохраняются в отдельный ключ до перезаписи', () => {
  const raw = JSON.stringify({
    entries: { a: { date: '2026-11-01', amount: 5, kind: 'delivery' }, b: { kind: '??' } },
    settings: {},
  });
  const s = fakeStorage({ [STORAGE_KEY]: raw });
  const store = createStore(s, { now });
  const r = store.load();
  assert.equal(r.rejected.length, 1);
  assert.ok(r.rawKey.startsWith(RAW_PREFIX));
  assert.equal(s.getItem(r.rawKey), raw);
  assert.deepEqual(Object.keys(JSON.parse(s.getItem(STORAGE_KEY)).entries), ['a']);
  // повторная загрузка не плодит копии
  store.load();
  assert.equal(store.rawKeys().length, 1);
});

test('повреждённый JSON не перезаписывается, исходник сохраняется', () => {
  const s = fakeStorage({ [STORAGE_KEY]: '{oops' });
  const r = createStore(s, { now }).load();
  assert.equal(r.corrupt, true);
  assert.equal(s.getItem(STORAGE_KEY), '{oops');
  assert.equal(s.getItem(r.rawKey), '{oops');
});

test('если копию сохранить не удалось — хранилище не перезаписывается', () => {
  const raw = JSON.stringify({ entries: { b: { kind: '??' } }, settings: {} });
  const s = fakeStorage({ [STORAGE_KEY]: raw }, { failWrites: true });
  const r = createStore(s, { now }).load();
  assert.equal(r.rawKey, null);
  assert.equal(s.getItem(STORAGE_KEY), raw);
});

test('save возвращает false при переполнении', () => {
  const store = createStore(fakeStorage({}, { failWrites: true }), { now });
  assert.equal(store.save(store.load().state), false);
});

test('пустое хранилище — новый пользователь', () => {
  const r = createStore(fakeStorage(), { now }).load();
  assert.equal(r.isNew, true);
  assert.equal(r.state.settings.startDate, '2026-11-15');
});

test('настройки: только https, тема по умолчанию', () => {
  assert.equal(normalizePrefs({ apiUrl: 'http://x.dev' }).apiUrl, '');
  assert.equal(normalizePrefs({ apiUrl: 'https://x.dev/' }).apiUrl, 'https://x.dev/');
  assert.equal(normalizePrefs({ theme: 'neon' }).theme, 'auto');
  assert.equal(normalizePrefs(null).changesSinceBackup, 0);
});

test('чат: фильтрация мусора и ограничение длины', () => {
  const s = fakeStorage();
  const store = createStore(s, { now });
  const msgs = Array.from({ length: 50 }, (_, i) => ({
    role: i % 2 ? 'assistant' : 'user',
    content: 'm' + i,
  }));
  store.saveChat([...msgs, { role: 'system', content: 'x' }]);
  const back = store.loadChat();
  assert.ok(back.length <= 40);
  assert.ok(back.every((m) => m.role !== 'system'));
});
