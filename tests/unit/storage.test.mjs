import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore, normalizePrefs } from '../../js/storage.js';
import { STORAGE_KEY, RAW_PREFIX, MAX_RAW_COPIES } from '../../js/core.js';

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

test('копий исходных данных не больше лимита — старые удаляются, хранилище не переполняется', () => {
  const s = fakeStorage();
  let t = Date.UTC(2026, 10, 1);
  const store = createStore(s, { now: () => new Date((t += 60_000)) });
  for (let i = 0; i < 9; i++) store.preserveRaw(`{"copy":${i}}`);
  const keys = store.rawKeys();
  assert.equal(keys.length, MAX_RAW_COPIES);
  // остались самые свежие
  assert.equal(s.getItem(keys.at(-1)), '{"copy":8}');
  assert.equal(s.getItem(keys[0]), `{"copy":${9 - MAX_RAW_COPIES}}`);
});

test('при переполнении хранилища освобождает место за счёт старых копий и повторяет запись', () => {
  const s = fakeStorage({ [RAW_PREFIX + '2026-01-01']: 'old-1', [RAW_PREFIX + '2026-01-02']: 'old-2' });
  const realSet = s.setItem;
  let failOnce = true;
  s.setItem = (k, v) => {
    if (failOnce && k.startsWith(RAW_PREFIX)) {
      failOnce = false;
      throw new Error('QuotaExceededError');
    }
    realSet(k, v);
  };
  const store = createStore(s, { now });
  const key = store.preserveRaw('fresh');
  assert.ok(key, 'копия сохранена со второй попытки');
  assert.equal(s.getItem(key), 'fresh');
  assert.equal(s.getItem(RAW_PREFIX + '2026-01-01'), null, 'самая старая копия удалена');
  assert.equal(s.getItem(RAW_PREFIX + '2026-01-02'), 'old-2');
});

test('повреждённые настройки и чат не ломают запуск', () => {
  const s = fakeStorage({ 'kopilkamoto-prefs-v2': '{oops', 'kopilkamoto-chat-v1': '{"not":"array"}' });
  const store = createStore(s, { now });
  assert.equal(store.loadPrefs().theme, 'auto');
  assert.deepEqual(store.loadChat(), []);
  s.setItem('kopilkamoto-chat-v1', 'oops');
  assert.deepEqual(store.loadChat(), []);
});

test('замок: дата включения сохраняется, без замка обнуляется', () => {
  assert.equal(normalizePrefs({ lock: true, lockSince: 123 }).lockSince, 123);
  assert.ok(normalizePrefs({ lock: true }).lockSince > 0);
  assert.deepEqual(
    [normalizePrefs({ lock: 'yes', lockSince: 5 }).lock, normalizePrefs({ lockSince: 5 }).lockSince],
    [false, 0],
  );
});

test('removeRaw удаляет только копии; недоступное хранилище не роняет приложение', () => {
  const s = fakeStorage({ [STORAGE_KEY]: '{}', [RAW_PREFIX + 'a']: 'x' });
  const store = createStore(s, { now });
  store.removeRaw(STORAGE_KEY);
  assert.equal(s.getItem(STORAGE_KEY), '{}', 'основные данные удалить нельзя');
  store.removeRaw(RAW_PREFIX + 'a');
  assert.equal(s.getItem(RAW_PREFIX + 'a'), null);

  const broken = {
    get length() {
      throw new Error('SecurityError');
    },
    key: () => null,
    getItem() {
      throw new Error('SecurityError');
    },
    setItem() {
      throw new Error('SecurityError');
    },
    removeItem() {
      throw new Error('SecurityError');
    },
  };
  const b = createStore(broken, { now });
  assert.equal(b.load().isNew, true);
  assert.deepEqual(b.rawKeys(), []);
  assert.equal(b.savePrefs({ theme: 'dark' }), false);
  assert.equal(b.saveChat([]), false);
  b.removeRaw(RAW_PREFIX + 'x');
});
