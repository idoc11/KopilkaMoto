import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shiftCalendar } from '../../js/calendar.js';

const T = '2026-11-15'; // воскресенье
const e = (date, amount, kind = 'delivery') => ({ date, amount, kind, hours: 0, note: '', ts: 1 });

test('сетка: 12 недель по 7 дней, последняя — текущая, начинается с понедельника', () => {
  const c = shiftCalendar({}, T);
  assert.equal(c.weeks.length, 12);
  assert.ok(c.weeks.every((w) => w.length === 7));
  assert.equal(c.start, '2026-08-24');
  assert.equal(c.end, T);
  assert.equal(c.weeks[11][6].date, T);
  assert.equal(c.weeks[11][6].today, true);
  assert.equal(c.shifts, 0);
  assert.equal(c.max, 0);
});

test('уровни по доле от лучшей смены; несколько доставок за день складываются', () => {
  const c = shiftCalendar(
    {
      a: e('2026-11-09', 1000),
      b: e('2026-11-10', 2000),
      c: e('2026-11-10', 2000),
      d: e('2026-11-11', 4000),
      x: e('2026-11-12', 9999, 'other'),
      y: e('2026-11-13', 500, 'spent'),
      old: e('2026-08-01', 99999),
    },
    T,
  );
  const w = c.weeks[11];
  assert.equal(c.max, 4000);
  assert.equal(c.shifts, 3);
  assert.deepEqual(
    w.slice(0, 4).map((x) => x.level),
    [1, 4, 4, 0],
  );
  assert.equal(w[4].level, 0);
});

test('будущие дни текущей недели помечены и пусты', () => {
  const c = shiftCalendar({ a: e('2026-11-11', 1000) }, '2026-11-11'); // среда
  const w = c.weeks[11];
  assert.deepEqual(
    w.map((x) => x.future),
    [false, false, false, true, true, true, true],
  );
  assert.equal(w[2].today, true);
  assert.equal(w[2].level, 4);
});
