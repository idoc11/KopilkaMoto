import { test } from 'node:test';
import assert from 'node:assert/strict';
import { periodRange, periodReport, reportText } from '../../js/report.js';

const T = '2026-11-12'; // четверг
const e = (date, amount, kind = 'delivery', hours = 0) => ({ date, amount, kind, hours, note: '', ts: 1 });
const fd = (iso) => iso.split('-').reverse().join('.');

test('границы недели и месяца и такого же отрезка прошлого периода', () => {
  assert.deepEqual(periodRange('week', T), {
    from: '2026-11-09',
    to: T,
    prevFrom: '2026-11-02',
    prevTo: '2026-11-05',
  });
  assert.deepEqual(periodRange('month', T), {
    from: '2026-11-01',
    to: T,
    prevFrom: '2026-10-01',
    prevTo: '2026-10-12',
  });
  // 31 марта → в феврале всего 28 дней
  assert.equal(periodRange('month', '2026-03-31').prevTo, '2026-02-28');
  // январь сравнивается с декабрём прошлого года
  assert.equal(periodRange('month', '2026-01-10').prevFrom, '2025-12-01');
  // воскресенье — вся неделя целиком
  assert.equal(periodRange('week', '2026-11-15').prevTo, '2026-11-08');
});

const sample = {
  a: e('2026-11-09', 3000, 'delivery', 8),
  b: e('2026-11-09', 1000, 'delivery', 2),
  c: e('2026-11-11', 2000, 'delivery', 0),
  d: e('2026-11-10', 500, 'other'),
  s: e('2026-11-10', 700, 'spent'),
  p1: e('2026-11-02', 2000, 'delivery', 4),
  p2: e('2026-11-04', 300, 'spent'),
  late: e('2026-11-06', 9999, 'delivery'), // вне сравнимого отрезка прошлой недели
  future: e('2026-11-13', 9999, 'delivery'),
};

test('итоги недели: доход, расходы, смены, часы, сравнение', () => {
  const r = periodReport(sample, T, 'week');
  assert.equal(r.income, 6500);
  assert.equal(r.spent, 700);
  assert.equal(r.net, 5800);
  assert.equal(r.shifts, 2);
  assert.equal(r.avgShift, 3000);
  assert.equal(r.hours, 10);
  assert.equal(r.perHour, 400);
  assert.deepEqual(r.best, { date: '2026-11-09', amount: 4000 });
  assert.equal(r.prev.net, 1700);
  assert.equal(r.deltaNet, 4100);
  assert.equal(r.empty, false);
});

test('пустой период и период без часов', () => {
  const r = periodReport({}, T, 'month');
  assert.equal(r.empty, true);
  assert.equal(r.avgShift, null);
  assert.equal(reportText(r, fd), 'Итоги месяца: пока нет записей.');
  const noHours = periodReport({ a: e('2026-11-10', 1000) }, T, 'week');
  assert.equal(noHours.perHour, null);
});

test('текст итога', () => {
  const t = reportText(periodReport(sample, T, 'week'), fd);
  const lines = t.replaceAll(' ', ' ').split('\n');
  assert.equal(lines[0], 'Итоги недели (09.11.2026 — 12.11.2026)');
  assert.match(lines[1], /^Доход: 6 500 ₽, расходы: 700 ₽, итого: \+5 800 ₽\.$/);
  assert.match(lines[2], /^Смен: 2 смены, в среднем 3 000 ₽, 10 ч, ≈ 400 ₽ в час\.$/);
  assert.match(lines[3], /^Лучшая смена — понедельник: 4 000 ₽\.$/);
  assert.match(lines[4], /^К прошлому периоду: \+4 100 ₽\.$/);
  // одна смена — «лучшая» не пишем; без прошлого периода — сравнения нет
  const one = reportText(periodReport({ a: e('2026-11-10', 1000) }, T, 'week'), fd).split('\n');
  assert.equal(one.length, 3);
  // ровно столько же
  const same = reportText(
    periodReport({ a: e('2026-11-10', 1000), b: e('2026-11-03', 1000) }, T, 'week'),
    fd,
  );
  assert.match(same, /Столько же, сколько в прошлом периоде\./);
  // минус
  const neg = reportText(periodReport({ s: e('2026-11-10', 400, 'spent') }, T, 'month'), fd);
  assert.match(neg.replaceAll(' ', ' '), /итого: −400 ₽/);
});
