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
  assert.equal(a.items.find((i) => i.title === '10%').done, true);
  assert.equal(a.next.title, 'Четверть');
  assert.equal(a.next.hint, 'не хватает 15\u00a0000\u00a0₽');
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
  assert.equal(core.formatCompact(1500), '1,5к');
  assert.equal(core.formatCompact(-800), '−800');
  assert.equal(core.formatCompact(25400), '25к');
  assert.equal(core.formatCompact(1250000), '1,3М');
});

test('темп и прогноз даты покупки', () => {
  // 10 дней записей по 1000 ₽: окно 10 дней → 1000 ₽/день
  const entries = {};
  for (let i = 0; i < 10; i++) entries['d' + i] = e(core.addDays(T, -i), 1000);
  const s = st(entries, { goal: 20000, deadline: '2026-11-30' });
  assert.equal(core.savingPace(s.entries, T), 1000);
  const f = core.forecast(s, T);
  assert.deepEqual([f.status, f.days, f.date], ['ok', 10, '2026-11-25']);
  assert.equal(f.lateDays, -5);
  assert.match(core.forecastText(f), /раньше срока/);
  // одна запись — окно минимум 7 дней
  assert.equal(core.savingPace({ a: e(T, 700) }, T), 100);
  // будущие даты не учитываются
  assert.equal(core.savingPace({ a: e('2030-01-01', 700) }, T), null);
  assert.equal(core.forecast(st({}), T).status, 'no-data');
  assert.equal(core.forecast(st({ a: e(T, 100), b: e(T, 500, 'spent') }), T).status, 'no-progress');
  assert.equal(core.forecast(st({ a: e(T, 200000) }), T).status, 'done');
});

test('оба прогноза: последние 30 дней и весь период плана', () => {
  const entries = {
    old: e('2026-11-02', 10000),
    beforePlan: e('2026-10-20', 50000),
    expense: e('2026-11-10', 2000, 'spent'),
  };
  const s = st(entries, { goal: 100000, startDate: '2026-11-01', deadline: '2027-03-31' });
  assert.equal(core.savingPaceOverall(s.entries, s.settings.startDate, T), 8000 / 15);
  const both = core.forecastBoth(s, T);
  assert.equal(both.recent.status, 'ok');
  assert.equal(both.overall.status, 'ok');
  assert.match(core.forecastBothText(s, T), /За последние 30 дней/);
  assert.match(core.forecastBothText(s, T), /За весь период накопления/);
  // два прогноза — две строки (настоящий перенос, а не символы «\n»)
  const lines = core.forecastBothText(s, T).split('\n');
  // в строке прогноза есть сам темп в рублях в день и понятный вывод про срок
  assert.match(
    lines[0],
    /^За последние 30 дней копишь ≈ [\d\s\u00a0]+\u00a0₽ в день — цель будет \d\d\.\d\d\.\d{4}, на \d+ дн\. (позже|раньше) срока\.$/,
  );
  assert.match(lines[1], /^За весь период накопления копишь ≈ /);
  assert.equal(lines.length, 2);
  assert.ok(lines[0].startsWith('За последние 30 дней') && lines[1].startsWith('За весь период'));
  assert.doesNotMatch(core.forecastBothText(s, T), /\\n/);
  const beforeStart = core.forecastBoth(st({}, { startDate: '2026-12-01' }), T);
  assert.equal(beforeStart.overall.status, 'not-started');
});

test('замок: задержка покупки и подсчёт расходов', () => {
  const entries = {};
  for (let i = 0; i < 10; i++) entries['d' + i] = e(core.addDays(T, -i), 1000, 'delivery', { ts: 100 + i });
  const s = st(entries);
  assert.equal(core.delayDays(s, 2500, T), 3);
  assert.equal(core.delayDays(st({}), 2500, T), null);
  const w = core.withdrawals(
    {
      a: e(T, 300, 'spent', { ts: 50 }),
      b: e(T, 200, 'spent', { ts: 200 }),
      c: e(T, 999, 'delivery', { ts: 300 }),
    },
    100,
  );
  assert.deepEqual(w, { count: 1, sum: 200 });
  assert.deepEqual(core.withdrawals({ a: e(T, 1, 'spent') }, 0), { count: 0, sum: 0 });
});

test('прогноз: долгий простой — отдельное сообщение, а не «расходы съели доходы»', () => {
  const idle = st({ a: e('2026-09-01', 5000) }, { goal: 100000 });
  const f = core.forecast(idle, T);
  assert.equal(f.status, 'stale');
  assert.match(core.forecastText(f), /записей не было/);
  assert.doesNotMatch(core.forecastText(f), /расходы/);
  // настоящий перевес расходов по-прежнему распознаётся
  const losing = core.forecast(st({ a: e(T, 100), b: e(T, 500, 'spent') }), T);
  assert.equal(losing.status, 'no-progress');
  assert.match(core.forecastText(losing), /расходы/);
  // при простое замок не обещает сдвиг покупки
  assert.equal(core.delayDays(idle, 1000, T), null);
});

test('CSV: копейки через запятую — русский Excel читает их как числа', () => {
  const csv = core.buildCsv({
    a: e(T, 1500.5, 'delivery', { hours: 7.5 }),
    b: e(T, 99.25, 'spent', { ts: 2 }),
  });
  const lines = csv.slice(1).split('\r\n');
  assert.ok(lines.includes('"2026-11-15";"Доставка";"1500,5";"7,5";""'), lines.join('\n'));
  assert.ok(lines.includes('"2026-11-15";"Расход";"-99,25";"0";""'), lines.join('\n'));
});

test('часы: формат 7:30, «7 ч 30 мин» и дроби', () => {
  const cases = {
    '7:30': 7.5,
    '7:05': 7 + 5 / 60,
    '0:45': 0.75,
    '12:00': 12,
    ' 8:15 ': 8.25,
    '7.30': 7.3, // точка — это дробь, а не минуты
    '7,5': 7.5,
    8: 8,
    '7 ч 30 мин': 7.5,
    '7ч30м': 7.5,
    '7 ч': 7,
    '45 мин': 0.75,
    '': 0,
  };
  for (const [input, want] of Object.entries(cases)) {
    assert.ok(
      Math.abs(core.parseHours(input) - want) < 1e-9,
      `${JSON.stringify(input)} → ${core.parseHours(input)}`,
    );
  }
  for (const bad of ['7:60', '7:5', '7:', ':30', '7:30:00', 'abc', '-1', '7 ч 75 мин']) {
    assert.ok(Number.isNaN(core.parseHours(bad)), `${JSON.stringify(bad)} должно быть ошибкой`);
  }
});

test('часы: показ «7 ч 30 мин» и обратное преобразование для поля ввода', () => {
  assert.equal(core.formatHours(7.5), '7 ч 30 мин');
  assert.equal(core.formatHours(8), '8 ч');
  assert.equal(core.formatHours(0.75), '45 мин');
  assert.equal(core.hoursInputValue(7.5), '7:30');
  assert.equal(core.hoursInputValue(8), '8');
  assert.equal(core.hoursInputValue(0), '');
  // каждая минута переживает округление при сохранении (до сотых часа)
  for (let m = 0; m < 60; m++) {
    const stored = Math.round(core.parseHours(`7:${String(m).padStart(2, '0')}`) * 100) / 100;
    assert.equal(core.hoursInputValue(stored), m ? `7:${String(m).padStart(2, '0')}` : '7');
  }
});

test('частые расходы: значения по умолчанию, проверка, дубли, лимит', () => {
  assert.deepEqual(core.normalizePresets(undefined), [
    { note: 'Электричка', amount: 100 },
    { note: 'Еда', amount: 400 },
  ]);
  assert.deepEqual(core.normalizePresets([]), [], 'пользователь удалил все — не возвращаем стандартные');
  assert.deepEqual(
    core.normalizePresets([
      { note: '  Бензин ', amount: '1500.5' },
      { note: 'бензин', amount: 10 },
      { note: '', amount: 10 },
      { note: 'Ноль', amount: 0 },
      { note: 'x'.repeat(50), amount: 1 },
      null,
    ]),
    [
      { note: 'Бензин', amount: 1500.5 },
      { note: 'x'.repeat(core.MAX_PRESET_NAME), amount: 1 },
    ],
  );
  const many = Array.from({ length: 20 }, (_, i) => ({ note: 'P' + i, amount: 1 }));
  assert.equal(core.normalizePresets(many).length, core.MAX_PRESETS);
});

test('резервная копия переносит частые расходы, замок и тему', () => {
  const s = st({ a: e(T, 100) });
  const prefs = {
    presets: [{ note: 'Бензин', amount: 1500 }],
    lock: true,
    theme: 'dark',
    apiUrl: 'https://secret.example/',
  };
  const json = JSON.stringify(core.buildBackup(s, new Date(), prefs));
  assert.doesNotMatch(json, /secret\.example/, 'адрес прокси в копию не попадает');
  const back = core.parseBackup(json, T);
  assert.deepEqual(back.preferences, {
    presets: [{ note: 'Бензин', amount: 1500 }],
    lock: true,
    theme: 'dark',
  });
  // старые копии без настроек — текущие настройки не трогаем
  assert.equal(core.parseBackup(JSON.stringify(core.buildBackup(s)), T).preferences, null);
  // мусор в настройках копии отбрасывается
  const junk = { ...core.buildBackup(s), preferences: { presets: 'x', lock: 'yes', theme: 'neon' } };
  assert.deepEqual(core.parseBackup(JSON.stringify(junk), T).preferences, {
    presets: [],
    lock: false,
    theme: 'auto',
  });
});

test('куда ушли деньги: расходы месяца по комментарию, крупные сверху, остальное в конце', () => {
  const entries = {
    a: e(T, 400, 'spent', { note: 'Еда' }),
    b: e('2026-11-03', 400, 'spent', { note: ' еда ' }),
    c: e(T, 100, 'spent', { note: 'Электричка' }),
    d: e(T, 1500, 'spent', { note: 'Бензин' }),
    f: e(T, 50, 'spent', { note: '' }),
    g: e(T, 30, 'spent', { note: 'Жвачка' }),
    h: e(T, 20, 'spent', { note: 'Вода' }),
    old: e('2026-10-31', 9999, 'spent', { note: 'Еда' }),
    inc: e(T, 5000),
  };
  const r = core.spendingBreakdown(entries, T, 4);
  assert.deepEqual(
    r.items.map((x) => [x.label, x.amount]),
    [
      ['Бензин', 1500],
      ['Еда', 800],
      ['Электричка', 100],
      ['Без комментария', 50],
      ['Остальное', 50],
    ],
  );
  assert.equal(r.total, 2500);
  assert.equal(r.items[0].share, 0.6);
  assert.deepEqual(core.spendingBreakdown({ inc: e(T, 1) }, T).items, []);
});
