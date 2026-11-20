import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as ins from '../../js/insights.js';

const T = '2026-11-15'; // воскресенье; окно 56 дней = ровно 8 недель, начиная с понедельника 2026-09-21
const MON0 = '2026-09-21';
const e = (date, amount, kind = 'delivery', hours = 0) => ({ date, amount, kind, hours, note: '', ts: 1 });
const at = (week, dow) => ins.addDays(MON0, week * 7 + dow); // dow: 0 = понедельник

/** Пятницы — 4000 за 8 ч, вторники — 2000 за 8 ч (по 8 недель), 2 субботы по 3000, один понедельник на 9000. */
function sample() {
  const x = {};
  for (let w = 0; w < 8; w++) {
    x['f' + w] = e(at(w, 4), 4000, 'delivery', 8);
    x['t' + w] = e(at(w, 1), 2000, 'delivery', 8);
  }
  x.s1 = e(at(1, 5), 3000);
  x.s2 = e(at(4, 5), 3000);
  x.m = e(at(2, 0), 9000);
  x.old = e(ins.addDays(MON0, -70), 99999); // вне окна
  x.other = e(at(3, 2), 5000, 'other'); // не доставка
  x.spent = e(at(3, 3), 700, 'spent');
  return x;
}

test('по дням недели: смены, средняя смена, доход в час, лучший и худший день', () => {
  const s = ins.weekdayStats(sample(), T);
  assert.equal(s.shiftDays, 19);
  assert.equal(s.enough, true);
  const [mon, tue, , , fri, sat, sun] = s.days;
  assert.deepEqual([mon.shifts, mon.avg], [1, 9000]);
  assert.deepEqual([tue.shifts, tue.avg, tue.perHour], [8, 2000, 250]);
  assert.deepEqual([fri.shifts, fri.avg, fri.perHour], [8, 4000, 500]);
  assert.deepEqual([sat.shifts, sat.avg, sat.perHour], [2, 3000, null]);
  assert.deepEqual([sun.shifts, sun.avg], [0, null]);
  // понедельник с одной сменой — слишком мало данных, чтобы считать его лучшим
  assert.equal(s.best, 4);
  assert.equal(s.worst, 1);
});

test('две доставки за день — одна смена; доход в час — только по дням с часами', () => {
  const x = {
    a: e('2026-11-13', 1000, 'delivery', 2),
    b: e('2026-11-13', 3000, 'delivery', 4),
    c: e('2026-11-06', 5000),
  };
  const s = ins.weekdayStats(x, T);
  const fri = s.days[4];
  assert.equal(fri.shifts, 2);
  assert.equal(fri.avg, 4500); // (4000 + 5000) / 2
  assert.equal(fri.perHour, 4000 / 6); // часы есть только у первой пятницы
});

test('мало смен — выводов нет; один день с достаточными данными — тоже', () => {
  const few = ins.weekdayStats({ a: e(at(0, 4), 1000), b: e(at(1, 4), 1000), c: e(at(2, 4), 1000) }, T);
  assert.equal(few.enough, false);
  assert.equal(few.best, null);
  assert.equal(few.shiftDays, 3);
  const onlyFridays = {};
  for (let w = 0; w < 8; w++) onlyFridays['f' + w] = e(at(w, 4), 4000);
  const s = ins.weekdayStats(onlyFridays, T);
  assert.equal(s.enough, true);
  assert.equal(s.best, null, 'сравнивать не с чем');
  assert.equal(s.worst, null);
  assert.equal(ins.weekdayStats({}, T).shiftDays, 0);
  // будущие записи не считаются
  assert.equal(ins.weekdayStats({ a: e(ins.addDays(T, 3), 1000) }, T).shiftDays, 0);
});

test('одинаковые средние не дают «лучший = худший»', () => {
  const x = {};
  for (let w = 0; w < 4; w++) {
    x['f' + w] = e(at(w, 4), 3000);
    x['t' + w] = e(at(w, 1), 3000);
  }
  const s = ins.weekdayStats(x, T);
  assert.equal(s.enough, true);
  assert.equal(s.best, null);
});

test('названия дней и сводка для AI', () => {
  assert.equal(ins.WEEKDAYS_SHORT.length, 7);
  assert.equal(ins.WEEKDAYS_FULL[4], 'пятница');
  assert.deepEqual(ins.insightsForAi(sample(), T), {
    bestWeekday: 'пятница',
    bestAvgShift: 4000,
    worstWeekday: 'вторник',
    worstAvgShift: 2000,
  });
  assert.deepEqual(ins.insightsForAi({}, T), null);
});
