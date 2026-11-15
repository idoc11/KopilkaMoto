import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as core from '../../js/core.js';

const T = '2026-11-15';
const st = (entries = {}, settings = {}) => ({
  schemaVersion: 2,
  entries: Object.assign(Object.create(null), entries),
  settings: { goal: 100000, start: 0, startDate: '2026-11-01', deadline: '2026-12-01', ...settings },
});
const e = (date, amount, kind = 'delivery', extra = {}) => ({
  date,
  amount,
  kind,
  hours: 0,
  note: '',
  ts: 1,
  ...extra,
});

test('даты: валидация, разница, сложение месяцев', () => {
  assert.equal(core.isValidIso('2026-02-29'), false);
  assert.equal(core.isValidIso('2028-02-29'), true);
  assert.equal(core.isValidIso('2026-1-01'), false);
  assert.equal(core.daysBetween('2026-03-28', '2026-03-31'), 3); // переход на летнее время не ломает счёт
  assert.equal(core.addMonths('2026-10-31', 4), '2027-02-28');
  assert.equal(core.addDays('2026-12-31', 1), '2027-01-01');
});

test('parseAmount принимает пробелы и запятую, отклоняет мусор', () => {
  assert.equal(core.parseAmount('1 500'), 1500);
  assert.equal(core.parseAmount('1500,5'), 1500.5);
  assert.equal(core.parseAmount('1\u00a0000.25'), 1000.25);
  assert.ok(Number.isNaN(core.parseAmount('1e5')));
  assert.ok(Number.isNaN(core.parseAmount('-5')));
  assert.ok(Number.isNaN(core.parseAmount('1,234')));
  assert.ok(Number.isNaN(core.parseAmount('')));
});

test('P0-1: будущие даты при загрузке не удаляются', () => {
  const { entries, rejected } = core.normalizeEntries({ a: e('2030-01-01', 100), b: e('2026-01-01', 50) });
  assert.deepEqual(Object.keys(entries), ['a', 'b']);
  assert.equal(rejected.length, 0);
});

test('нормализация: некорректные часы обнуляются, а не удаляют запись', () => {
  const { entries } = core.normalizeEntries({
    a: e(T, 100, 'delivery', { hours: 'abc' }),
    b: e(T, 5, 'spent', { hours: 8 }),
  });
  assert.equal(entries.a.hours, 0);
  assert.equal(entries.b.hours, 0);
});

test('нормализация: битые записи попадают в rejected с причиной', () => {
  const { entries, rejected } = core.normalizeEntries({
    ok: e(T, 1),
    badDate: e('2026-13-01', 1),
    badKind: e(T, 1, 'gift'),
    arrKind: { ...e(T, 1), kind: ['delivery'] },
    zero: e(T, 0),
    neg: e(T, -5),
    str: 'oops',
  });
  assert.deepEqual(Object.keys(entries), ['ok']);
  assert.equal(rejected.length, 6);
  assert.ok(rejected.every((r) => typeof r.reason === 'string'));
});

test('нормализация: дробные суммы старых версий сохраняются', () => {
  const { entries } = core.normalizeEntries({ a: e(T, 0.5), b: e(T, 1500.555) });
  assert.equal(entries.a.amount, 0.5);
  assert.equal(entries.b.amount, 1500.56);
});

test('__proto__ как идентификатор не ломает объект', () => {
  const src = JSON.parse(`{"__proto__": ${JSON.stringify(e(T, 10))}}`);
  const { entries } = core.normalizeEntries(src);
  assert.equal(entries['__proto__'].amount, 10);
  assert.equal(Object.getPrototypeOf(entries), null);
});

test('P1-10: старые данные без дат получают даты исходного плана, новые — от сегодняшнего дня', () => {
  const legacy = core.migrateState({ entries: {}, settings: { goal: 600000, start: 0 } }, T);
  assert.equal(legacy.state.settings.startDate, core.LEGACY_START);
  assert.equal(legacy.state.settings.deadline, core.LEGACY_DEADLINE);
  assert.equal(legacy.isNew, false);
  const fresh = core.migrateState(null, '2027-06-10');
  assert.equal(fresh.isNew, true);
  assert.equal(fresh.state.settings.startDate, '2027-06-10');
  assert.equal(fresh.state.settings.deadline, '2027-10-10');
});

test('дата цели раньше начала исправляется с пояснением, а не молча', () => {
  const r = core.normalizeSettings({ goal: 1000, startDate: '2026-05-01', deadline: '2026-04-01' }, T);
  assert.equal(r.settings.startDate, '2026-05-01');
  assert.equal(r.settings.deadline, '2026-09-01');
  assert.equal(r.fixes.length, 1);
});

test('balance учитывает стартовую сумму и расходы', () => {
  const s = st({ a: e(T, 1000), b: e(T, 300, 'spent'), c: e(T, 200, 'other') }, { start: 50 });
  assert.equal(core.balance(s), 950);
});

test('P2-15: единая сортировка — дата, затем время добавления', () => {
  const list = core.sortEntries({
    a: e(T, 1, 'delivery', { ts: 1 }),
    b: e(T, 1, 'delivery', { ts: 5 }),
    c: e('2026-11-14', 1),
  });
  assert.deepEqual(
    list.map(([id]) => id),
    ['b', 'a', 'c'],
  );
});

test('computeSummary: фазы плана и сумма в день', () => {
  const s = st({ a: e('2026-11-10', 30000) });
  const active = core.computeSummary(s, T);
  assert.equal(active.phase, 'active');
  assert.equal(active.left, 70000);
  assert.equal(active.remainingDays, 17);
  assert.ok(Math.abs(active.perDay - 70000 / 17) < 1e-9);
  assert.equal(active.status.tone, 'warn');
  assert.equal(core.computeSummary(s, '2026-12-05').phase, 'after');
  assert.equal(core.computeSummary(s, '2026-12-05').perDay, null);
  assert.equal(core.computeSummary(s, '2026-10-01').phase, 'before');
  assert.equal(core.computeSummary(st({ a: e(T, 100000) }), T).phase, 'done');
  const perHour = core.computeSummary(
    st({ a: e(T, 1000, 'delivery', { hours: 4 }), b: e(T, 999) }),
    T,
  ).perHour;
  assert.equal(perHour, 250);
});

test('weekSeries: ровно 7 последних дней, чистый результат', () => {
  const s = st({ a: e(T, 1000), b: e(T, 1500, 'spent'), c: e('2026-11-09', 300), old: e('2026-11-08', 999) });
  const { days, total } = core.weekSeries(s.entries, T);
  assert.equal(days.length, 7);
  assert.equal(days[0].date, '2026-11-09');
  assert.equal(days[6].value, -500);
  assert.equal(total, -200);
});

test('monthSummary и серия доходов', () => {
  const entries = {
    a: e(T, 100),
    b: e('2026-11-14', 50, 'other'),
    c: e('2026-11-13', 20),
    d: e('2026-10-31', 999),
    s: e(T, 30, 'spent'),
  };
  assert.deepEqual(core.monthSummary(entries, T), { income: 170, spent: 30, net: 140 });
  assert.equal(core.incomeStreak(entries, T).streak, 3);
  assert.equal(core.incomeStreak(entries, '2026-11-16').streak, 3); // сегодня ещё нет дохода — считаем со вчера
  assert.equal(core.incomeStreak(entries, '2026-11-17').streak, 0);
});

test('achievements: следующее достижение', () => {
  const a = core.achievements(st({ a: e(T, 10000) }), T);
  assert.equal(a.items.find((i) => i.title === '10% цели').done, true);
  assert.equal(a.next.title, 'Четверть пути');
});

test('P2-20: поиск «доход» находит и доставки', () => {
  const sorted = core.sortEntries({
    a: e(T, 1),
    b: e(T, 1, 'other'),
    c: e(T, 1, 'spent', { note: 'ремонт' }),
  });
  assert.equal(core.filterHistory(sorted, { query: 'доход' }, T).length, 2);
  assert.equal(core.filterHistory(sorted, { query: 'Ремонт' }, T).length, 1);
  assert.equal(core.filterHistory(sorted, { kind: 'spent' }, T).length, 1);
  const old = core.sortEntries({ a: e('2026-10-01', 1), b: e('2026-10-20', 1), c: e(T, 1) });
  assert.equal(core.filterHistory(old, { period: 'month' }, T).length, 1);
  assert.equal(core.filterHistory(old, { period: '30' }, T).length, 2);
});

test('CSV: защита от формул, кавычки, BOM, знак расхода', () => {
  const csv = core.buildCsv({
    a: e(T, 100, 'spent', { note: '=HYPERLINK("x")' }),
    b: e('2026-11-01', 5, 'delivery', { note: 'a"b' }),
  });
  assert.ok(csv.startsWith('﻿"Дата"'));
  const lines = csv.slice(1).split('\r\n');
  assert.equal(lines[1], '"2026-11-01";"Доставка";"5";"0";"a""b"');
  assert.equal(lines[2], '"2026-11-15";"Расход";"-100";"0";"\'=HYPERLINK(""x"")"');
});

test('резервная копия: туда и обратно, старые форматы, чужие файлы', () => {
  const s = st({ a: e(T, 100) });
  const back = core.parseBackup(JSON.stringify(core.buildBackup(s)), T);
  assert.deepEqual({ ...back.state.entries }, { ...s.entries });
  assert.deepEqual(back.state.settings, s.settings);
  const v1 = core.parseBackup(
    JSON.stringify({
      app: 'moto-savings-tracker',
      version: 1,
      entries: { x: e(T, 7) },
      settings: { goal: 5000, start: 0 },
    }),
    T,
  );
  assert.equal(v1.state.settings.deadline, core.LEGACY_DEADLINE);
  assert.equal(v1.total, 1);
  assert.throws(() => core.parseBackup('{"app":"other","entries":{},"settings":{}}', T), core.BackupError);
  assert.throws(() => core.parseBackup('not json', T), /JSON/);
  assert.throws(() => core.parseBackup('[]', T), core.BackupError);
  const partial = core.parseBackup(
    JSON.stringify({ entries: { a: e(T, 1), b: { kind: 'x' } }, settings: {} }),
    T,
  );
  assert.equal(partial.rejected.length, 1);
});

test('напоминание о копии', () => {
  const now = Date.UTC(2026, 10, 15);
  assert.equal(core.backupReminder({ changesSinceBackup: 0 }, 0, now), null);
  assert.equal(core.backupReminder({ changesSinceBackup: 3 }, 3, now), 'never');
  assert.equal(
    core.backupReminder({ lastBackupAt: now - 86400000, changesSinceBackup: 25 }, 30, now),
    'changes',
  );
  assert.equal(
    core.backupReminder({ lastBackupAt: now - 20 * 86400000, changesSinceBackup: 1 }, 30, now),
    'age',
  );
  assert.equal(
    core.backupReminder({ lastBackupAt: now - 20 * 86400000, changesSinceBackup: 0 }, 30, now),
    null,
  );
  assert.equal(core.backupReminder({ changesSinceBackup: 30, snoozeUntil: now + 1 }, 30, now), null);
});

test('P1-6: в AI уходят 80 самых свежих операций и поля плана', () => {
  const entries = {};
  for (let i = 0; i < 100; i++) entries['x' + i] = e(core.addDays(T, -i), 100, 'delivery', { ts: i });
  // вставляем в обратном порядке, чтобы порядок ключей не совпадал с датами
  const shuffled = Object.fromEntries(Object.entries(entries).reverse());
  const ctx = core.buildAiContext(st(shuffled), T);
  assert.equal(ctx.transactions.length, 80);
  assert.equal(ctx.transactions[0].date, T);
  assert.equal(ctx.transactions.at(-1).date, core.addDays(T, -79));
  assert.equal(ctx.transactionsTotal, 100);
  for (const k of ['today', 'deadline', 'planStart', 'neededPerDay', 'goal', 'balance'])
    assert.ok(k in ctx, k);
});

test('P0-2: тело запроса к AI не превышает бюджет при длинной переписке', () => {
  const long = 'Ответ '.repeat(1000);
  const messages = [];
  for (let i = 0; i < 20; i++)
    messages.push({ role: 'user', content: 'Вопрос ' + i }, { role: 'assistant', content: long });
  messages.push({ role: 'user', content: 'Последний вопрос' });
  const ctx = core.buildAiContext(
    st(
      Object.fromEntries(
        Array.from({ length: 80 }, (_, i) => ['k' + i, e(T, 1, 'delivery', { note: 'я'.repeat(100) })]),
      ),
    ),
    T,
  );
  const { json, sentMessages } = core.buildAiPayload(messages, ctx);
  assert.ok(core.byteLength(json) <= core.AI_BUDGET_BYTES, `size ${core.byteLength(json)}`);
  const body = JSON.parse(json);
  assert.equal(body.messages.at(-1).content, 'Последний вопрос');
  assert.equal(body.messages[0].role, 'user');
  assert.equal(sentMessages, body.messages.length);
});

test('aiErrorMessage: понятные тексты вместо «проверь CORS»', () => {
  assert.match(core.aiErrorMessage(413), /большой/);
  assert.match(core.aiErrorMessage(429), /много/);
  assert.equal(core.aiErrorMessage(400, 'Текст сервера'), 'Текст сервера');
});

test('форматирование денег', () => {
  assert.equal(core.formatRub(1500), '1\u00a0500\u00a0₽');
  assert.equal(core.formatRub(0.1 + 0.2), '0,3\u00a0₽');
  assert.equal(core.formatSigned(-20), '−20\u00a0₽');
  assert.equal(core.parseAmount(core.formatNumber(1234567.5)), 1234567.5);
  assert.equal(core.formatCompact(1500), '+1,5\u00a0тыс.');
});
