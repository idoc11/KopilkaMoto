import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as plan from '../../js/plan.js';

const T = '2026-11-15'; // воскресенье
const st = (entries = {}, settings = {}) => ({
  schemaVersion: 2,
  entries,
  settings: { goal: 100000, start: 0, startDate: '2026-10-01', deadline: '2026-12-15', ...settings },
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
const day = (n) => plan.addDays(T, -n);

/** 8 смен по 3000 за последние 28 дней, 4 траты по 500, старая смена 40 дней назад (задаёт окно в 28 дней). */
function sample(settings) {
  const entries = { old: e(day(40), 1000) };
  [1, 3, 5, 8, 10, 12, 15, 20].forEach((n, i) => (entries['s' + i] = e(day(n), 3000)));
  [2, 6, 9, 14].forEach((n, i) => (entries['x' + i] = e(day(n), 500, 'spent')));
  return st(entries, settings);
}

test('типичная смена, темп и расходы по последним 4 неделям', () => {
  const s = plan.shiftStats(sample().entries, T);
  assert.equal(s.span, 28);
  assert.equal(s.shifts, 8);
  assert.equal(s.avgShift, 3000);
  assert.equal(s.shiftsPerWeek, 2);
  assert.ok(Math.abs(s.baselinePerDay - -2000 / 28) < 1e-9);
});

test('смена — это день с доходом от доставки: две доставки за день = одна смена', () => {
  const s = plan.shiftStats({ a: e(day(1), 1000), b: e(day(1), 2000), c: e(day(2), 3000) }, T);
  assert.equal(s.shifts, 2);
  assert.equal(s.avgShift, 3000);
});

test('мало истории: окно не меньше недели и не больше 28 дней; будущие записи не считаются', () => {
  assert.equal(plan.shiftStats({ a: e(day(1), 500) }, T).span, 7);
  assert.equal(plan.shiftStats({ a: e(day(10), 500) }, T).span, 11);
  assert.equal(plan.shiftStats({ a: e(plan.addDays(T, 5), 500) }, T), null);
  assert.equal(plan.shiftStats({}, T), null);
});

test('сколько смен в неделю нужно, чтобы успеть к сроку', () => {
  const p = plan.weeklyPlan(sample(), T);
  assert.equal(p.status, 'ok');
  assert.equal(p.neededRounded, 6);
  assert.ok(Math.abs(p.neededShiftsPerWeek - 5.9624) < 1e-3, String(p.neededShiftsPerWeek));
  assert.equal(p.currentShiftsPerWeek, 2);
  assert.equal(p.enough, false);
  assert.equal(p.avgShift, 3000);
});

test('план: цель набрана, нет данных о сменах, ещё не начался, срок прошёл, нужно больше 7 смен', () => {
  assert.equal(plan.weeklyPlan(sample({ goal: 20000 }), T).status, 'done');
  assert.equal(plan.weeklyPlan(st({ a: e(day(1), 500, 'other') }), T).status, 'no-shifts');
  assert.equal(plan.weeklyPlan(st(), T).status, 'no-shifts');
  assert.equal(
    plan.weeklyPlan(sample({ startDate: '2026-12-01', deadline: '2027-03-01' }), T).status,
    'before',
  );
  assert.equal(plan.weeklyPlan(sample({ deadline: '2026-11-01' }), T).status, 'after');
  const rush = plan.weeklyPlan(sample({ deadline: plan.addDays(T, 5) }), T);
  assert.equal(rush.status, 'too-much');
  assert.ok(rush.neededShiftsPerWeek > 7);
  // хватает: темп уже выше нужного
  const easy = plan.weeklyPlan(sample({ goal: 30000, deadline: '2027-06-01' }), T);
  assert.equal(easy.status, 'ok');
  assert.equal(easy.enough, true);
  assert.equal(easy.neededRounded, 1); // траты в «фоне» всё равно требуют хотя бы одной смены
  // фон в плюсе (прочие доходы больше расходов) — смены не нужны вовсе
  const rich = plan.weeklyPlan(st({ a: e(day(1), 3000), o: e(day(2), 90000, 'other') }, { goal: 150000 }), T);
  assert.equal(rich.status, 'ok');
  assert.equal(rich.neededRounded, 0);
});

test('что если: прогноз даты при заданном числе смен в неделю', () => {
  const s = sample();
  const full = plan.whatIf(s, T, 7);
  assert.equal(full.status, 'ok');
  assert.equal(full.days, 27);
  assert.equal(full.date, '2026-12-12');
  assert.equal(full.lateDays, -3);
  const few = plan.whatIf(s, T, 2);
  assert.equal(few.status, 'ok');
  assert.ok(few.days >= 98 && few.days <= 99, String(few.days));
  assert.ok(few.lateDays > 0);
  assert.equal(plan.whatIf(s, T, 0).status, 'no-progress'); // без смен расходы съедают всё
  assert.equal(plan.whatIf(st(), T, 3).status, 'no-shifts');
  assert.equal(plan.whatIf(sample({ goal: 20000 }), T, 3).status, 'done');
});

test('неделя (с понедельника): смены, чистый итог и доля плана', () => {
  const entries = {
    mon: e('2026-11-09', 3000),
    sat: e('2026-11-14', 3000),
    spent: e('2026-11-13', 500, 'spent'),
    prev: e('2026-11-08', 9999), // воскресенье прошлой недели — не в счёт
  };
  const w = plan.weekProgress(st(entries), T);
  assert.equal(w.weekStart, '2026-11-09');
  assert.equal(w.shifts, 2);
  assert.equal(w.net, 5500);
  assert.ok(w.target > 0);
  assert.ok(Math.abs(w.pct - Math.min(100, (5500 / w.target) * 100)) < 1e-9);
  assert.equal(plan.weekProgress(st(), T).net, 0);
  // понедельник: неделя начинается сегодня
  assert.equal(plan.weekProgress(st(), '2026-11-16').weekStart, '2026-11-16');
  // без плана (срок прошёл) цели недели нет
  assert.equal(plan.weekProgress(st({}, { deadline: '2026-11-01' }), T).target, null);
});

test('склонение «смена»', () => {
  const f = (n) => plan.shiftsWord(n);
  assert.deepEqual([1, 2, 4, 5, 11, 12, 21, 22, 25].map(f), [
    'смена',
    'смены',
    'смены',
    'смен',
    'смен',
    'смен',
    'смена',
    'смены',
    'смен',
  ]);
});

test('сводка плана для AI: компактная, с округлением', () => {
  const ai = plan.planForAi(sample(), T);
  assert.deepEqual(ai, {
    status: 'ok',
    neededShiftsPerWeek: 6,
    currentShiftsPerWeek: 2,
    typicalShiftIncome: 3000,
  });
  assert.deepEqual(plan.planForAi(st(), T), { status: 'no-shifts' });
  assert.deepEqual(plan.planForAi(sample({ goal: 20000 }), T), { status: 'done' });
});
