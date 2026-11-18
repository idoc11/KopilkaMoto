// Чистая логика приложения: без DOM и localStorage, чтобы её можно было тестировать в Node.

export const STORAGE_KEY = 'moto-tracker-v1';
export const PREFS_KEY = 'kopilkamoto-prefs-v2';
export const CHAT_KEY = 'kopilkamoto-chat-v1';
export const RAW_PREFIX = 'moto-tracker-v1-raw-';
/** Сколько последних копий исходных данных хранить (каждая — полный объём данных). */
export const MAX_RAW_COPIES = 5;
export const SCHEMA_VERSION = 2;
export const BACKUP_VERSION = 7;
export const APP_NAMES = ['KopilkaMoto', 'moto-savings-tracker'];

export const DEFAULT_GOAL = 600000;
export const LEGACY_START = '2026-12-01';
export const LEGACY_DEADLINE = '2027-03-31';
export const DEFAULT_PLAN_MONTHS = 4;
export const MAX_AMOUNT = 1_000_000_000;
export const MAX_NOTE = 100;
export const MAX_HOURS_PER_ENTRY = 24;
export const MAX_HOURS_LEGACY = 744;
export const MAX_BACKUP_BYTES = 5 * 1024 * 1024;
export const AI_BUDGET_BYTES = 24_000;
export const AI_MAX_TRANSACTIONS = 80;
export const AI_MAX_MESSAGES = 12;
export const AI_MAX_QUESTION = 1000;
export const BACKUP_REMIND_DAYS = 14;
export const BACKUP_REMIND_CHANGES = 20;

export const KINDS = {
  delivery: { label: 'Доставка', income: true, search: 'доставка доход заработок' },
  other: { label: 'Другой доход', income: true, search: 'другой доход заработок' },
  spent: { label: 'Расход', income: false, search: 'расход трата' },
};

// ---------- Даты (локальные, формат YYYY-MM-DD) ----------

const pad = (n) => String(n).padStart(2, '0');

export function isoDate(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function todayIso(now = new Date()) {
  return isoDate(now);
}

export function parseIso(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function isValidIso(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = parseIso(s);
  return !Number.isNaN(d.getTime()) && isoDate(d) === s;
}

export function daysBetween(a, b) {
  return Math.round((parseIso(b) - parseIso(a)) / 86_400_000);
}

export function addDays(iso, n) {
  const d = parseIso(iso);
  d.setDate(d.getDate() + n);
  return isoDate(d);
}

export function addMonths(iso, n) {
  const d = parseIso(iso);
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + n);
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, last));
  return isoDate(d);
}

export function formatDate(iso) {
  return parseIso(iso).toLocaleDateString('ru-RU');
}

export function weekdayShort(iso) {
  return parseIso(iso).toLocaleDateString('ru-RU', { weekday: 'short' });
}

// ---------- Деньги ----------

export const roundMoney = (n) => Math.round((Number(n) || 0) * 100) / 100;

export function formatRub(n) {
  return roundMoney(n).toLocaleString('ru-RU', { maximumFractionDigits: 2 }) + ' ₽';
}

/** Число для поля ввода: «600 000», «1 500,5». parseAmount читает его обратно. */
export function formatNumber(n) {
  return roundMoney(n).toLocaleString('ru-RU', { maximumFractionDigits: 2 });
}

export function formatSigned(n) {
  const v = roundMoney(n);
  return (v < 0 ? '−' : '+') + formatRub(Math.abs(v));
}

/** Короткая подпись для графика: 950, 2,5к, 1,2М. Знак показывает цвет столбца. */
export function formatCompact(n) {
  const v = Math.abs(roundMoney(n));
  const sign = n < 0 ? '−' : '';
  const short = (x) => x.toLocaleString('ru-RU', { maximumFractionDigits: x < 10 ? 1 : 0 });
  if (v < 1000) return sign + Math.round(v);
  if (v < 1e6) return sign + short(v / 1000) + 'к';
  return sign + short(v / 1e6) + 'М';
}

/** Разбирает сумму из поля ввода: «1 500», «1500,50», «1500.5». Возвращает NaN при ошибке. */
export function parseAmount(input) {
  const s = String(input ?? '')
    .replace(/[\s\u00a0\u202f]/g, '')
    .replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return NaN;
  return Number(s);
}

/**
 * Разбирает часы работы: «7:30», «7 ч 30 мин», «45 мин», «7,5», «7.5», «8». Пусто — 0, ошибка — NaN.
 * Точка и запятая — всегда дробь часа (7.30 = 7,3 ч); минуты пишутся через двоеточие или «мин».
 */
export function parseHours(input) {
  const s = String(input ?? '')
    .trim()
    .toLowerCase();
  if (s === '') return 0;
  let m = /^(\d{1,2}):([0-5]\d)$/.exec(s);
  if (m) return Number(m[1]) + Number(m[2]) / 60;
  m = /^(?:(\d{1,2})\s*ч(?:ас\S*)?)?\s*(?:(\d{1,2})\s*м(?:ин\S*)?)?$/.exec(s);
  if (m && (m[1] || m[2])) {
    const min = Number(m[2] || 0);
    return min < 60 ? Number(m[1] || 0) + min / 60 : NaN;
  }
  const d = s.replace(',', '.');
  return /^\d+(\.\d+)?$/.test(d) ? Number(d) : NaN;
}

const splitHours = (h) => {
  const total = Math.round(h * 60);
  return [Math.floor(total / 60), total % 60];
};

/** «7 ч 30 мин», «8 ч», «45 мин». */
export function formatHours(h) {
  const [hh, mm] = splitHours(h);
  return [hh && `${hh} ч`, mm && `${mm} мин`].filter(Boolean).join(' ') || '0 ч';
}

/** Значение для поля ввода: «7:30» или «8». */
export function hoursInputValue(h) {
  if (!h) return '';
  const [hh, mm] = splitHours(h);
  return mm ? `${hh}:${String(mm).padStart(2, '0')}` : String(hh);
}

// ---------- Нормализация и миграция данных ----------

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/**
 * Проверяет одну операцию. Будущие даты допустимы (их запрещает только форма ввода),
 * некорректные часы обнуляются, а не приводят к потере записи.
 */
export function normalizeEntry(id, e) {
  if (typeof id !== 'string' || !id || id.length > 120) return { error: 'некорректный идентификатор' };
  if (!isPlainObject(e)) return { error: 'запись не является объектом' };
  if (typeof e.kind !== 'string' || !Object.hasOwn(KINDS, e.kind))
    return { error: 'неизвестный тип операции' };
  if (!isValidIso(e.date)) return { error: 'некорректная дата' };
  const amount = roundMoney(e.amount);
  if (!Number.isFinite(Number(e.amount)) || amount <= 0 || amount > MAX_AMOUNT) {
    return { error: 'некорректная сумма' };
  }
  let hours = Number(e.hours);
  if (e.kind !== 'delivery' || !Number.isFinite(hours) || hours < 0 || hours > MAX_HOURS_LEGACY) hours = 0;
  const ts = Number(e.ts);
  return {
    entry: {
      date: e.date,
      amount,
      hours: Math.round(hours * 100) / 100,
      kind: e.kind,
      note: typeof e.note === 'string' ? e.note.slice(0, MAX_NOTE) : '',
      ts: Number.isFinite(ts) && ts > 0 ? ts : parseIso(e.date).getTime(),
    },
  };
}

export function normalizeEntries(source) {
  const entries = Object.create(null);
  const rejected = [];
  if (!isPlainObject(source)) return { entries, rejected };
  for (const [id, e] of Object.entries(source)) {
    const r = normalizeEntry(id, e);
    if (r.entry) entries[id] = r.entry;
    else rejected.push({ id, reason: r.error });
  }
  return { entries, rejected };
}

export function defaultSettings(today) {
  return {
    goal: DEFAULT_GOAL,
    start: 0,
    startDate: today,
    deadline: addMonths(today, DEFAULT_PLAN_MONTHS),
  };
}

/**
 * Приводит настройки к корректному виду. Для старых данных без дат используются даты
 * исходного плана, чтобы у существующих пользователей ничего не поменялось.
 */
export function normalizeSettings(source, today, { legacy = false } = {}) {
  const s = isPlainObject(source) ? source : {};
  const fixes = [];
  const goal = Number(s.goal);
  const start = Number(s.start);
  const startDate = isValidIso(s.startDate) ? s.startDate : legacy ? LEGACY_START : today;
  let deadline = isValidIso(s.deadline)
    ? s.deadline
    : legacy
      ? LEGACY_DEADLINE
      : addMonths(startDate, DEFAULT_PLAN_MONTHS);
  if (deadline <= startDate) {
    deadline = addMonths(startDate, DEFAULT_PLAN_MONTHS);
    fixes.push('Дата цели была раньше даты начала — срок сдвинут на 4 месяца после начала.');
  }
  return {
    settings: {
      goal: Number.isFinite(goal) && goal >= 1 && goal <= MAX_AMOUNT ? roundMoney(goal) : DEFAULT_GOAL,
      start: Number.isFinite(start) && start >= 0 && start <= MAX_AMOUNT ? roundMoney(start) : 0,
      startDate,
      deadline,
    },
    fixes,
  };
}

/**
 * Превращает содержимое хранилища (уже разобранный JSON или null) в текущее состояние.
 * Возвращает список отброшенных записей — вызывающий код обязан сохранить исходные данные.
 */
export function migrateState(raw, today) {
  if (!isPlainObject(raw) || (!raw.entries && !raw.settings)) {
    return {
      state: {
        schemaVersion: SCHEMA_VERSION,
        entries: Object.create(null),
        settings: defaultSettings(today),
      },
      rejected: [],
      fixes: [],
      isNew: true,
    };
  }
  const legacy = !raw.schemaVersion;
  const { entries, rejected } = normalizeEntries(raw.entries);
  const { settings, fixes } = normalizeSettings(raw.settings, today, { legacy });
  return { state: { schemaVersion: SCHEMA_VERSION, entries, settings }, rejected, fixes, isNew: false };
}

export function serializeState(state) {
  return JSON.stringify({ schemaVersion: SCHEMA_VERSION, entries: state.entries, settings: state.settings });
}

export function newEntryId(now = Date.now(), rand = Math.random) {
  return 'e' + now.toString(36) + rand().toString(36).slice(2, 8);
}

// ---------- Расчёты ----------

export const signedAmount = (e) => (KINDS[e.kind].income ? Math.abs(e.amount) : -Math.abs(e.amount));

export function balance(state) {
  return roundMoney(
    Object.values(state.entries).reduce((sum, e) => sum + signedAmount(e), state.settings.start),
  );
}

/** Единый порядок операций: новые сверху, при равной дате — по времени добавления. */
export function sortEntries(entries) {
  return Object.entries(entries).sort(
    ([ia, a], [ib, b]) => b.date.localeCompare(a.date) || b.ts - a.ts || ib.localeCompare(ia),
  );
}

export function planAt(settings, date) {
  const span = Math.max(1, daysBetween(settings.startDate, settings.deadline));
  const elapsed = Math.max(0, Math.min(span, daysBetween(settings.startDate, date)));
  return settings.start + (settings.goal - settings.start) * (elapsed / span);
}

export function computeSummary(state, today) {
  const { settings } = state;
  const total = balance(state);
  const left = Math.max(0, roundMoney(settings.goal - total));
  const pct = Math.max(0, Math.min(100, (total / settings.goal) * 100));
  const from = today < settings.startDate ? settings.startDate : today;
  const remainingDays = Math.max(0, daysBetween(from, settings.deadline) + 1);

  let phase;
  if (total >= settings.goal) phase = 'done';
  else if (today > settings.deadline) phase = 'after';
  else if (today < settings.startDate) phase = 'before';
  else phase = 'active';

  // Цель по дням обновляется на лету в зависимости от остатка суммы и оставшихся дней
  const perDay = phase === 'done' ? 0 : phase === 'after' || !remainingDays ? null : left / remainingDays;

  // Заработок в час на основе всех записей доставки, где указаны часы (> 0)
  const deliveries = Object.values(state.entries).filter((e) => e.kind === 'delivery' && e.hours > 0);
  const hours = deliveries.reduce((s, e) => s + e.hours, 0);
  const earned = deliveries.reduce((s, e) => s + e.amount, 0);
  const perHour = hours ? earned / hours : null;

  const diff = total - planAt(settings, today);
  let status;
  if (phase === 'done') status = { tone: 'good', text: 'Сумма набрана. Можно ехать за мотоциклом.' };
  else if (phase === 'before')
    status = { tone: 'neutral', text: `План начинается ${formatDate(settings.startDate)}.` };
  else if (phase === 'after') status = { tone: 'warn', text: `Срок прошёл, не хватает ${formatRub(left)}.` };
  else if (diff >= 0) status = { tone: 'good', text: `Впереди графика на ${formatRub(diff)}` };
  else status = { tone: 'warn', text: `Отстаёшь от графика на ${formatRub(-diff)}` };

  const daysLeftText =
    phase === 'done' ? 'Цель!' : phase === 'after' ? 'Срок прошёл' : `${remainingDays} дн.`;

  return { total, left, pct, perDay, perHour, remainingDays, daysLeftText, phase, diff, status };
}

export function weekSeries(entries, today) {
  const list = Object.values(entries);
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const date = addDays(today, -i);
    const value = roundMoney(list.filter((e) => e.date === date).reduce((s, e) => s + signedAmount(e), 0));
    days.push({ date, value, weekday: weekdayShort(date) });
  }
  return { days, total: roundMoney(days.reduce((s, d) => s + d.value, 0)) };
}

export function monthSummary(entries, today) {
  const prefix = today.slice(0, 7);
  let income = 0;
  let spent = 0;
  for (const e of Object.values(entries)) {
    if (!e.date.startsWith(prefix)) continue;
    if (KINDS[e.kind].income) income += e.amount;
    else spent += e.amount;
  }
  return { income: roundMoney(income), spent: roundMoney(spent), net: roundMoney(income - spent) };
}

export function incomeStreak(entries, today) {
  const days = new Set(
    Object.values(entries)
      .filter((e) => KINDS[e.kind].income)
      .map((e) => e.date),
  );
  let check = days.has(today) ? today : addDays(today, -1);
  let streak = 0;
  while (days.has(check)) {
    streak++;
    check = addDays(check, -1);
  }
  return { streak, activeDays: days.size };
}

export function achievements(state, today) {
  const { streak, activeDays } = incomeStreak(state.entries, today);
  const pct = Math.max(0, (balance(state) / state.settings.goal) * 100);
  const count = Object.keys(state.entries).length;
  const money = (p) => formatRub(Math.max(0, (state.settings.goal * p) / 100 - balance(state)));
  const items = [
    { title: 'Первая запись', hint: 'добавь первую операцию', done: count >= 1 },
    { title: '10%', hint: `не хватает ${money(10)}`, done: pct >= 10 },
    { title: 'Четверть', hint: `не хватает ${money(25)}`, done: pct >= 25 },
    { title: 'Половина', hint: `не хватает ${money(50)}`, done: pct >= 50 },
    { title: '75%', hint: `не хватает ${money(75)}`, done: pct >= 75 },
    { title: 'Вся сумма', hint: `не хватает ${money(100)}`, done: pct >= 100 },
    { title: '7 дней с доходом', hint: `осталось ${Math.max(0, 7 - activeDays)} дн.`, done: activeDays >= 7 },
    { title: '10 записей', hint: `осталось ${Math.max(0, 10 - count)}`, done: count >= 10 },
    { title: '3 дня подряд', hint: 'доход три дня без пропуска', done: streak >= 3 },
  ];
  return { items, streak, next: items.find((i) => !i.done) || null };
}

export function filterHistory(sorted, { query = '', kind = 'all', period = 'all' } = {}, today) {
  const q = query.trim().toLowerCase();
  const monthStart = today.slice(0, 8) + '01';
  const cut = addDays(today, -29);
  return sorted.filter(([, e]) => {
    if (kind !== 'all' && e.kind !== kind) return false;
    if (period === 'month' && e.date < monthStart) return false;
    if (period === '30' && e.date < cut) return false;
    if (q && !`${e.note} ${KINDS[e.kind].search}`.toLowerCase().includes(q)) return false;
    return true;
  });
}

export function totalsOf(list) {
  let income = 0;
  let spent = 0;
  for (const [, e] of list) {
    if (KINDS[e.kind].income) income += e.amount;
    else spent += e.amount;
  }
  return { income: roundMoney(income), spent: roundMoney(spent), net: roundMoney(income - spent) };
}

// ---------- Экспорт / импорт ----------

export function csvCell(v) {
  // Числа — с запятой: файл с разделителем «;» открывают в русском Excel, где точка делает число текстом.
  let s = typeof v === 'number' ? String(v).replace('.', ',') : String(v ?? '');
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return '"' + s.replace(/"/g, '""') + '"';
}

export function buildCsv(entries) {
  const rows = [['Дата', 'Тип', 'Сумма, RUB', 'Часы', 'Комментарий']];
  for (const [, e] of sortEntries(entries).reverse()) {
    rows.push([e.date, KINDS[e.kind].label, signedAmount(e), e.hours || 0, e.note || '']);
  }
  return '﻿' + rows.map((r) => r.map(csvCell).join(';')).join('\r\n');
}

const THEMES = ['auto', 'light', 'dark'];

/**
 * Резервная копия. Кроме данных переносит настройки, которые нужны на новом телефоне:
 * частые расходы, замок до цели, тему. Адрес прокси не включается.
 */
export function buildBackup(state, now = new Date(), prefs = null) {
  const backup = {
    app: 'KopilkaMoto',
    version: BACKUP_VERSION,
    schemaVersion: SCHEMA_VERSION,
    exportedAt: now.toISOString(),
    entries: state.entries,
    settings: state.settings,
  };
  if (prefs) backup.preferences = { presets: prefs.presets, lock: prefs.lock === true, theme: prefs.theme };
  return backup;
}

function parsePreferences(p) {
  if (!isPlainObject(p)) return null;
  return {
    presets: Array.isArray(p.presets) ? normalizePresets(p.presets) : [],
    lock: p.lock === true,
    theme: THEMES.includes(p.theme) ? p.theme : 'auto',
  };
}

export class BackupError extends Error {}

/** Разбирает файл резервной копии любой версии приложения. */
export function parseBackup(text, today) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new BackupError('Файл не является корректным JSON.');
  }
  if (!isPlainObject(data)) throw new BackupError('В файле нет данных KopilkaMoto.');
  if (data.app !== undefined && !APP_NAMES.includes(data.app)) {
    throw new BackupError('Это резервная копия другого приложения.');
  }
  if (!isPlainObject(data.entries) || !isPlainObject(data.settings)) {
    throw new BackupError('В копии нет операций или настроек.');
  }
  const { entries, rejected } = normalizeEntries(data.entries);
  const legacy = !data.schemaVersion && !data.settings.startDate;
  const { settings, fixes } = normalizeSettings(data.settings, today, { legacy });
  return {
    state: { schemaVersion: SCHEMA_VERSION, entries, settings },
    rejected,
    fixes,
    total: Object.keys(data.entries).length,
    preferences: parsePreferences(data.preferences),
  };
}

// ---------- Резервные копии: напоминание ----------

export function backupReminder(meta, entryCount, now = Date.now()) {
  if (!entryCount) return null;
  if (meta.snoozeUntil && now < meta.snoozeUntil) return null;
  const changes = meta.changesSinceBackup || 0;
  if (!meta.lastBackupAt) return changes >= 3 || entryCount >= 3 ? 'never' : null;
  const age = (now - meta.lastBackupAt) / 86_400_000;
  if (changes >= BACKUP_REMIND_CHANGES) return 'changes';
  if (age >= BACKUP_REMIND_DAYS && changes > 0) return 'age';
  return null;
}

// ---------- AI ----------

export const byteLength = (s) => new TextEncoder().encode(s).byteLength;

export function buildAiContext(state, today) {
  const s = computeSummary(state, today);
  const month = monthSummary(state.entries, today);
  const sorted = sortEntries(state.entries);
  return {
    today,
    currency: 'RUB',
    goal: state.settings.goal,
    startBalance: state.settings.start,
    planStart: state.settings.startDate,
    deadline: state.settings.deadline,
    balance: s.total,
    remaining: s.left,
    progressPercent: Math.round(s.pct * 10) / 10,
    daysLeft: s.phase === 'after' ? 0 : s.remainingDays,
    neededPerDay: s.perDay === null ? null : Math.round(s.perDay),
    planDifference: Math.round(s.diff),
    incomePerHour: s.perHour === null ? null : Math.round(s.perHour),
    thisMonth: month,
    forecastDate: (() => {
      const f = forecast(state, today);
      return f.status === 'ok' ? f.date : null;
    })(),
    savingPacePerDay: (() => {
      const p = savingPace(state.entries, today);
      return p === null ? null : Math.round(p);
    })(),
    transactionsTotal: sorted.length,
    transactions: sorted.slice(0, AI_MAX_TRANSACTIONS).map(([, e]) => ({
      date: e.date,
      kind: e.kind,
      amount: e.amount,
      hours: e.hours || undefined,
      note: e.note || undefined,
    })),
  };
}

/**
 * Собирает тело запроса к прокси в пределах бюджета: сначала отбрасываются старые сообщения,
 * затем — самые старые операции. Последний вопрос пользователя сохраняется всегда.
 */
export function buildAiPayload(messages, context, budget = AI_BUDGET_BYTES) {
  let history = messages
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .slice(-AI_MAX_MESSAGES);
  const ctx = { ...context, transactions: [...(context.transactions || [])] };
  const encode = () => JSON.stringify({ messages: history, context: ctx });
  let json = encode();
  while (byteLength(json) > budget && history.length > 1) {
    history = history.slice(1);
    while (history.length > 1 && history[0].role !== 'user') history = history.slice(1);
    json = encode();
  }
  while (byteLength(json) > budget && ctx.transactions.length) {
    ctx.transactions = ctx.transactions.slice(0, Math.floor(ctx.transactions.length * 0.75));
    json = encode();
  }
  return { json, sentMessages: history.length, sentTransactions: ctx.transactions.length };
}

export function aiErrorMessage(status, serverMessage) {
  if (serverMessage) return serverMessage;
  if (status === 413) return 'Запрос слишком большой. Очисти чат и попробуй снова.';
  if (status === 429) return 'Слишком много запросов. Подожди минуту и попробуй снова.';
  if (status === 403)
    return 'Прокси не принимает запросы с этого сайта. Проверь ALLOWED_ORIGIN в настройках Worker.';
  if (status >= 500) return 'AI-сервис временно недоступен. Попробуй позже.';
  return `Прокси ответил ошибкой ${status}.`;
}

// ---------- Прогноз и замок ----------

export const FORECAST_WINDOW_DAYS = 30;
export const FORECAST_MIN_DAYS = 7;

/**
 * Темп накопления: чистый результат за последние 30 дней (или с начала записей, но не меньше 7 дней),
 * делённый на число дней. Возвращает рубли в день или null, если данных мало.
 */
function paceWindow(entries, today) {
  const list = Object.values(entries).filter((e) => e.date <= today);
  if (!list.length) return null;
  const first = list.reduce((m, e) => (e.date < m ? e.date : m), today);
  const span = Math.min(FORECAST_WINDOW_DAYS, Math.max(FORECAST_MIN_DAYS, daysBetween(first, today) + 1));
  const from = addDays(today, -(span - 1));
  const recent = list.filter((e) => e.date >= from);
  const net = recent.reduce((s, e) => s + signedAmount(e), 0);
  return { pace: net / span, span, count: recent.length };
}

export function savingPace(entries, today) {
  return paceWindow(entries, today)?.pace ?? null;
}

/** Прогноз даты, когда при текущем темпе наберётся цель. */
export function forecast(state, today) {
  const left = state.settings.goal - balance(state);
  if (left <= 0) return { status: 'done' };
  const win = paceWindow(state.entries, today);
  if (win === null) return { status: 'no-data' };
  // Ни одной записи в окне — это простой, а не перевес расходов.
  if (!win.count) return { status: 'stale', span: win.span };
  const { pace } = win;
  if (pace <= 0) return { status: 'no-progress', pace };
  const days = Math.ceil(left / pace);
  if (days > 365 * 20) return { status: 'too-far', pace };
  const date = addDays(today, days);
  return { status: 'ok', pace, days, date, lateDays: daysBetween(state.settings.deadline, date) };
}

export function forecastText(f) {
  switch (f.status) {
    case 'done':
      return 'Сумма уже набрана.';
    case 'no-data':
      return 'Прогноз появится после первых записей.';
    case 'stale':
      return `За последние ${f.span} дней записей не было — прогноз появится после новых доходов.`;
    case 'no-progress':
      return 'За последние дни расходы съели доходы — при таком темпе цель не приближается.';
    case 'too-far':
      return 'При текущем темпе на цель уйдёт больше 20 лет.';
    default: {
      const when = formatDate(f.date);
      if (f.lateDays > 0) return `При текущем темпе — ${when}, на ${f.lateDays} дн. позже срока.`;
      if (f.lateDays < 0) return `При текущем темпе — ${when}, на ${-f.lateDays} дн. раньше срока.`;
      return `При текущем темпе — ${when}, ровно в срок.`;
    }
  }
}

/** На сколько дней расход отодвинет покупку при текущем темпе. null — темп неизвестен или нулевой. */
export function delayDays(state, amount, today) {
  const pace = savingPace(state.entries, today);
  if (!pace || pace <= 0) return null;
  return Math.max(1, Math.ceil(amount / pace));
}

/** Расходы с момента включения замка. */
export function withdrawals(entries, sinceTs) {
  if (!sinceTs) return { count: 0, sum: 0 };
  let count = 0;
  let sum = 0;
  for (const e of Object.values(entries)) {
    if (e.kind === 'spent' && e.ts >= sinceTs) {
      count++;
      sum += e.amount;
    }
  }
  return { count, sum: roundMoney(sum) };
}

// ---------- Частые расходы ----------

export const DEFAULT_PRESETS = [
  { note: 'Электричка', amount: 100 },
  { note: 'Еда', amount: 400 },
];
export const MAX_PRESETS = 8;
export const MAX_PRESET_NAME = 30;

/** Проверяет список частых расходов. Нет списка (старые настройки) — значения по умолчанию; пустой — пустой. */
export function normalizePresets(list) {
  if (!Array.isArray(list)) return DEFAULT_PRESETS.map((p) => ({ ...p }));
  const out = [];
  for (const p of list) {
    if (!p || typeof p !== 'object') continue;
    const note = typeof p.note === 'string' ? p.note.trim().slice(0, MAX_PRESET_NAME) : '';
    const amount = roundMoney(p.amount);
    if (!note || !(amount >= 1 && amount <= MAX_AMOUNT)) continue;
    if (out.some((x) => x.note.toLowerCase() === note.toLowerCase())) continue;
    out.push({ note, amount });
    if (out.length === MAX_PRESETS) break;
  }
  return out;
}

// ---------- Куда ушли деньги ----------

/** Расходы текущего месяца по комментарию (подпись — как в самой свежей записи): крупные сверху, хвост — в «Остальное». */
export function spendingBreakdown(entries, today, limit = 4) {
  const prefix = today.slice(0, 7);
  const groups = new Map();
  for (const e of sortEntries(entries)) {
    if (e[1].kind !== 'spent' || !e[1].date.startsWith(prefix)) continue;
    const label = e[1].note.trim() || 'Без комментария';
    const key = label.toLowerCase();
    const g = groups.get(key) || { label, amount: 0 };
    g.amount += e[1].amount;
    groups.set(key, g);
  }
  const sorted = [...groups.values()].sort((a, b) => b.amount - a.amount || a.label.localeCompare(b.label));
  const total = roundMoney(sorted.reduce((s, g) => s + g.amount, 0));
  const top = sorted.slice(0, limit);
  const rest = sorted.slice(limit).reduce((s, g) => s + g.amount, 0);
  if (rest > 0) top.push({ label: 'Остальное', amount: rest });
  return {
    total,
    items: top.map((g) => ({
      label: g.label,
      amount: roundMoney(g.amount),
      share: total ? g.amount / total : 0,
    })),
  };
}
