// План на неделю: сколько смен нужно, чтобы успеть к сроку, и калькулятор «что если».
// Чистые функции без DOM и хранилища; смена — день с доходом от «Доставки».
import {
  addDays,
  balance,
  computeSummary,
  daysBetween,
  forecastAtPace,
  parseIso,
  signedAmount,
} from './core.js';

export { addDays };

export const PLAN_WINDOW_DAYS = 28;
export const MIN_WINDOW_DAYS = 7;
export const MAX_SHIFTS_PER_WEEK = 7;

/** «смена», «смены», «смен» для числа n. */
export function shiftsWord(n) {
  const k = Math.abs(Math.round(n));
  const last = k % 10;
  const tens = k % 100;
  if (tens >= 11 && tens <= 14) return 'смен';
  if (last === 1) return 'смена';
  if (last >= 2 && last <= 4) return 'смены';
  return 'смен';
}

/**
 * Типичная смена и «фон» без смен по последним 4 неделям (при короткой истории — не меньше 7 дней).
 * baselinePerDay — чистый результат в день без смен: прочие доходы минус расходы (обычно отрицательный).
 */
export function shiftStats(entries, today) {
  const list = Object.values(entries).filter((x) => x.date <= today);
  if (!list.length) return null;
  const first = list.reduce((m, x) => (x.date < m ? x.date : m), today);
  const span = Math.min(PLAN_WINDOW_DAYS, Math.max(MIN_WINDOW_DAYS, daysBetween(first, today) + 1));
  const from = addDays(today, -(span - 1));
  const shiftDays = new Map();
  let other = 0;
  let spent = 0;
  for (const x of list) {
    if (x.date < from) continue;
    if (x.kind === 'delivery') shiftDays.set(x.date, (shiftDays.get(x.date) ?? 0) + x.amount);
    else if (x.kind === 'other') other += x.amount;
    else spent += x.amount;
  }
  const shifts = shiftDays.size;
  const income = [...shiftDays.values()].reduce((s, v) => s + v, 0);
  return {
    span,
    shifts,
    avgShift: shifts ? income / shifts : null,
    shiftsPerWeek: (shifts / span) * 7,
    baselinePerDay: (other - spent) / span,
  };
}

/** Сколько смен в неделю нужно, чтобы набрать цель к сроку при нынешних расходах. */
export function weeklyPlan(state, today) {
  const s = computeSummary(state, today);
  if (s.phase === 'done') return { status: 'done' };
  const st = shiftStats(state.entries, today);
  if (!st?.shifts) return { status: 'no-shifts' };
  if (s.phase === 'before') return { status: 'before', startDate: state.settings.startDate };
  if (s.phase === 'after') return { status: 'after', left: s.left };
  const neededShiftIncome = s.perDay - st.baselinePerDay;
  const neededShiftsPerWeek = Math.max(0, (neededShiftIncome * 7) / st.avgShift);
  const neededRounded = Math.max(0, Math.ceil(neededShiftsPerWeek - 1e-9)); // max убирает «минус ноль»
  return {
    status: neededRounded > MAX_SHIFTS_PER_WEEK ? 'too-much' : 'ok',
    neededPerDay: s.perDay,
    neededShiftsPerWeek,
    neededRounded,
    currentShiftsPerWeek: st.shiftsPerWeek,
    avgShift: st.avgShift,
    enough: st.shiftsPerWeek >= neededShiftsPerWeek - 0.05,
  };
}

/** Прогноз даты, если выходить shiftsPerWeek смен в неделю (смена и расходы — как в последние недели). */
export function whatIf(state, today, shiftsPerWeek) {
  const left = state.settings.goal - balance(state);
  if (left <= 0) return { status: 'done' };
  const st = shiftStats(state.entries, today);
  if (!st?.shifts) return { status: 'no-shifts' };
  const pace = st.baselinePerDay + (shiftsPerWeek * st.avgShift) / 7;
  return forecastAtPace(left, pace, today, state.settings.deadline);
}

/** Понедельник недели, в которую входит дата. */
function mondayOf(iso) {
  return addDays(iso, -((parseIso(iso).getDay() + 6) % 7));
}

/** Эта неделя (с понедельника): смены, чистый итог и доля плана на неделю. */
export function weekProgress(state, today) {
  const weekStart = mondayOf(today);
  const shiftDays = new Set();
  let net = 0;
  for (const x of Object.values(state.entries)) {
    if (x.date < weekStart || x.date > today) continue;
    net += signedAmount(x);
    if (x.kind === 'delivery') shiftDays.add(x.date);
  }
  const s = computeSummary(state, today);
  const target = s.phase === 'active' && s.perDay !== null ? s.perDay * 7 : null;
  return {
    weekStart,
    shifts: shiftDays.size,
    net,
    target,
    pct: target > 0 ? Math.max(0, Math.min(100, (net / target) * 100)) : null,
  };
}

/** Короткая сводка плана для AI-помощника (чтобы он мог ответить на «сколько смен нужно»). */
export function planForAi(state, today) {
  const p = weeklyPlan(state, today);
  if (p.status !== 'ok' && p.status !== 'too-much') return { status: p.status };
  const round1 = (n) => Math.round(n * 10) / 10;
  return {
    status: p.status,
    neededShiftsPerWeek: round1(p.neededShiftsPerWeek),
    currentShiftsPerWeek: round1(p.currentShiftsPerWeek),
    typicalShiftIncome: Math.round(p.avgShift),
  };
}
