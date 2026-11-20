// «Когда выгоднее работать»: средняя смена по дням недели за последние 8 недель.
// Чистые функции без DOM; смена — день с доходом от «Доставки».
import { addDays } from './core.js';

export { addDays };

export const WINDOW_DAYS = 56;
export const MIN_SHIFTS = 8;
export const MIN_PER_DAY = 2;
export const WEEKDAYS_SHORT = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
export const WEEKDAYS_FULL = [
  'понедельник',
  'вторник',
  'среда',
  'четверг',
  'пятница',
  'суббота',
  'воскресенье',
];

/** День недели с понедельника (0) по воскресенье (6) для даты ГГГГ-ММ-ДД. */
export function weekdayIndex(iso) {
  return (new Date(`${iso}T00:00:00Z`).getUTCDay() + 6) % 7;
}

/**
 * Статистика по дням недели за последние 56 дней (включая сегодня).
 * best / worst — индексы дней с ≥ 2 смен, у которых средняя смена выше / ниже всего; null, если сравнивать не с чем.
 */
export function weekdayStats(entries, today) {
  const from = addDays(today, -(WINDOW_DAYS - 1));
  const perDate = new Map();
  for (const x of Object.values(entries)) {
    if (x.kind !== 'delivery' || x.date < from || x.date > today) continue;
    const d = perDate.get(x.date) ?? { amount: 0, hours: 0 };
    d.amount += x.amount;
    d.hours += x.hours || 0;
    perDate.set(x.date, d);
  }
  const days = WEEKDAYS_SHORT.map((label, i) => ({
    index: i,
    label,
    full: WEEKDAYS_FULL[i],
    shifts: 0,
    total: 0,
    avg: null,
    hours: 0,
    perHour: null,
    _hAmount: 0,
  }));
  for (const [date, d] of perDate) {
    const day = days[weekdayIndex(date)];
    day.shifts += 1;
    day.total += d.amount;
    if (d.hours > 0) {
      day.hours += d.hours;
      day._hAmount += d.amount;
    }
  }
  for (const day of days) {
    if (day.shifts) day.avg = day.total / day.shifts;
    if (day.hours > 0) day.perHour = day._hAmount / day.hours;
    delete day._hAmount;
  }
  const shiftDays = perDate.size;
  const enough = shiftDays >= MIN_SHIFTS;
  let best = null;
  let worst = null;
  const pool = enough ? days.filter((d) => d.shifts >= MIN_PER_DAY) : [];
  if (pool.length >= 2) {
    const hi = pool.reduce((m, d) => (d.avg > m.avg ? d : m));
    const lo = pool.reduce((m, d) => (d.avg < m.avg ? d : m));
    if (hi.avg > lo.avg) {
      best = hi.index;
      worst = lo.index;
    }
  }
  return { from, shiftDays, enough, days, best, worst };
}

/** Короткая сводка для помощника; null, если выводов пока нет. */
export function insightsForAi(entries, today) {
  const s = weekdayStats(entries, today);
  if (s.best === null) return null;
  const b = s.days[s.best];
  const w = s.days[s.worst];
  return {
    bestWeekday: b.full,
    bestAvgShift: Math.round(b.avg),
    worstWeekday: w.full,
    worstAvgShift: Math.round(w.avg),
  };
}
