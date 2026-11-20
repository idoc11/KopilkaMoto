// «Итоги»: неделя или месяц с начала периода по сегодня и сравнение с таким же отрезком прошлого периода.
// Чистые функции без DOM; смена — день с доходом от «Доставки».
import { addDays, formatHours, formatRub } from './core.js';
import { WEEKDAYS_FULL, weekdayIndex } from './insights.js';

const daysInMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate(); // m: 1..12
const monthStartOf = (iso) => `${iso.slice(0, 8)}01`;

function prevMonthStart(iso) {
  const y = Number(iso.slice(0, 4));
  const m = Number(iso.slice(5, 7));
  return m === 1 ? `${y - 1}-12-01` : `${y}-${String(m - 1).padStart(2, '0')}-01`;
}

/** Границы периода и такого же по длине отрезка прошлого периода. */
export function periodRange(kind, today) {
  if (kind === 'month') {
    const from = monthStartOf(today);
    const days = Number(today.slice(8, 10));
    const prevFrom = prevMonthStart(today);
    const prevLen = daysInMonth(Number(prevFrom.slice(0, 4)), Number(prevFrom.slice(5, 7)));
    return { from, to: today, prevFrom, prevTo: addDays(prevFrom, Math.min(days, prevLen) - 1) };
  }
  const from = addDays(today, -weekdayIndex(today));
  const days = weekdayIndex(today) + 1;
  const prevFrom = addDays(from, -7);
  return { from, to: today, prevFrom, prevTo: addDays(prevFrom, days - 1) };
}

function totals(entries, from, to) {
  const shiftDays = new Map();
  let income = 0;
  let spent = 0;
  let hours = 0;
  let hoursIncome = 0;
  for (const x of Object.values(entries)) {
    if (x.date < from || x.date > to) continue;
    if (x.kind === 'spent') {
      spent += x.amount;
      continue;
    }
    income += x.amount;
    if (x.kind === 'delivery') {
      shiftDays.set(x.date, (shiftDays.get(x.date) ?? 0) + x.amount);
      if (x.hours > 0) {
        hours += x.hours;
        hoursIncome += x.amount;
      }
    }
  }
  const shifts = shiftDays.size;
  const delivery = [...shiftDays.values()].reduce((s, v) => s + v, 0);
  let best = null;
  for (const [date, amount] of shiftDays) if (!best || amount > best.amount) best = { date, amount };
  return {
    income,
    spent,
    net: income - spent,
    shifts,
    hours,
    avgShift: shifts ? delivery / shifts : null,
    perHour: hours > 0 ? hoursIncome / hours : null,
    best,
  };
}

/** Итоги периода: kind — 'week' | 'month'. */
export function periodReport(entries, today, kind = 'week') {
  const r = periodRange(kind, today);
  const cur = totals(entries, r.from, r.to);
  const prev = totals(entries, r.prevFrom, r.prevTo);
  const empty = cur.income === 0 && cur.spent === 0;
  return { kind, ...r, ...cur, prev, deltaNet: cur.net - prev.net, empty };
}

const word = (n, a, b, c) => {
  const k = n % 100;
  const l = n % 10;
  return k >= 11 && k <= 14 ? c : l === 1 ? a : l >= 2 && l <= 4 ? b : c;
};

const signed = (n) => (n < 0 ? '−' : n > 0 ? '+' : '') + formatRub(Math.abs(n));

/** Текст итога для копирования и отправки. */
export function reportText(rep, fmtDate) {
  const title = rep.kind === 'month' ? 'Итоги месяца' : 'Итоги недели';
  if (rep.empty) return `${title}: пока нет записей.`;
  const lines = [`${title} (${fmtDate(rep.from)} — ${fmtDate(rep.to)})`];
  lines.push(`Доход: ${formatRub(rep.income)}, расходы: ${formatRub(rep.spent)}, итого: ${signed(rep.net)}.`);
  if (rep.shifts) {
    let s = `Смен: ${rep.shifts} ${word(rep.shifts, 'смена', 'смены', 'смен')}, в среднем ${formatRub(Math.round(rep.avgShift))}`;
    if (rep.hours > 0) s += `, ${formatHours(rep.hours)}, ≈ ${formatRub(Math.round(rep.perHour))} в час`;
    lines.push(`${s}.`);
  }
  if (rep.best && rep.shifts > 1) {
    lines.push(
      `Лучшая смена — ${WEEKDAYS_FULL[weekdayIndex(rep.best.date)]}: ${formatRub(rep.best.amount)}.`,
    );
  }
  if (rep.prev.income || rep.prev.spent) {
    const d = Math.round(rep.deltaNet);
    lines.push(
      d === 0
        ? 'Столько же, сколько в прошлом периоде.'
        : `К прошлому периоду: ${d > 0 ? '+' : '−'}${formatRub(Math.abs(d))}.`,
    );
  }
  return lines.join('\n');
}
