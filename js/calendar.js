// «Календарь смен»: сетка последних недель, в клетке — доход от «Доставки» за день.
// Чистые функции без DOM.
import { addDays } from './core.js';
import { weekdayIndex } from './insights.js';

export const CALENDAR_WEEKS = 12;
export const LEVELS = 4;

/**
 * Сетка weeks[неделя][день с понедельника]; последняя неделя — текущая.
 * level: 0 — смены не было, 1..4 — доля дохода от самой удачной смены окна; future — день ещё не наступил.
 */
export function shiftCalendar(entries, today, weeks = CALENDAR_WEEKS) {
  const end = addDays(today, 6 - weekdayIndex(today));
  const start = addDays(end, -(weeks * 7 - 1));
  const perDate = new Map();
  for (const x of Object.values(entries)) {
    if (x.kind !== 'delivery' || x.date < start || x.date > today) continue;
    perDate.set(x.date, (perDate.get(x.date) ?? 0) + x.amount);
  }
  const max = Math.max(0, ...perDate.values());
  const grid = [];
  for (let w = 0; w < weeks; w++) {
    const col = [];
    for (let d = 0; d < 7; d++) {
      const date = addDays(start, w * 7 + d);
      const amount = perDate.get(date) ?? 0;
      const future = date > today;
      const level = amount > 0 && max > 0 ? Math.max(1, Math.ceil((amount / max) * LEVELS)) : 0;
      col.push({ date, amount, level, future, today: date === today });
    }
    grid.push(col);
  }
  return { start, end, weeks: grid, max, shifts: perDate.size };
}
