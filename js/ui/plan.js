// Блок «План на неделю»: сколько смен нужно, прогресс недели и калькулятор «что если».
import * as core from '../core.js';
import { $ } from '../dom.js';
import { MAX_SHIFTS_PER_WEEK, shiftsWord, weekProgress, weeklyPlan, whatIf } from '../plan.js';
import { app, today, ui } from './context.js';

const fmtShifts = (n) => `${n} ${shiftsWord(n)}`;
const fmtPerWeek = (n) => (Math.round(n * 10) / 10).toLocaleString('ru-RU', { maximumFractionDigits: 1 });

const verdict = (lateDays) =>
  lateDays > 0
    ? `на ${lateDays} дн. позже срока`
    : lateDays < 0
      ? `на ${-lateDays} дн. раньше срока`
      : 'ровно в срок';

/** Результат «что если» для n смен в неделю. */
function whatIfText(n) {
  const f = whatIf(app.state, today(), n);
  switch (f.status) {
    case 'ok':
      return `Тогда цель будет ${core.formatDate(f.date)} — ${verdict(f.lateDays)}.`;
    case 'no-progress':
      return `При такой работе расходы съедают доходы — цель не приближается.`;
    case 'too-far':
      return 'Больше 20 лет — слишком далеко.';
    default:
      return '';
  }
}

function showWhatIf(n) {
  $('planShiftsOut').textContent = fmtShifts(n);
  $('planShifts').setAttribute('aria-valuetext', `${fmtShifts(n)} в неделю`);
  $('planResult').textContent = whatIfText(n);
}

export function renderPlan() {
  const t = today();
  const p = weeklyPlan(app.state, t);
  const lead = $('planLead');
  const hasDetails = p.status === 'ok' || p.status === 'too-much';
  $('planWeek').hidden = true;
  $('planWhatIf').hidden = !hasDetails;

  switch (p.status) {
    case 'done':
      lead.textContent = 'Цель набрана — планировать больше нечего.';
      return;
    case 'no-shifts':
      lead.textContent =
        'Запиши смены через «Доход» → «Доставка» — и я посчитаю, сколько смен в неделю нужно до цели.';
      return;
    case 'before':
      lead.textContent = `План начинается ${core.formatDate(p.startDate)}.`;
      return;
    case 'after':
      lead.textContent = 'Срок прошёл. Передвинь дату цели в настройках — и я пересчитаю план.';
      return;
    default:
  }

  const avg = core.formatRub(Math.round(p.avgShift));
  const current = fmtPerWeek(p.currentShiftsPerWeek);
  if (p.status === 'too-much') {
    lead.textContent = `Чтобы успеть к сроку, нужно больше ${MAX_SHIFTS_PER_WEEK} смен в неделю — это нереально. Передвинь дату цели в настройках или сократи траты. Типичная смена — ${avg}.`;
  } else if (p.neededRounded === 0) {
    lead.textContent = `Прочих доходов хватает — по плану можно без смен. Типичная смена — ${avg}.`;
  } else if (p.enough) {
    lead.textContent = `Ты успеваешь: сейчас ≈ ${current} смен в неделю при нужных ${p.neededRounded}. Типичная смена — ${avg}.`;
  } else {
    lead.textContent = `Чтобы успеть к сроку, нужно ≈ ${fmtShifts(p.neededRounded)} в неделю — сейчас у тебя ≈ ${current}. Типичная смена — ${avg}.`;
  }

  const w = weekProgress(app.state, t);
  if (w.target !== null) {
    $('planWeek').hidden = false;
    $('planWeekText').textContent =
      `Эта неделя: ${fmtShifts(w.shifts)} · ${core.formatSigned(w.net)} из ≈ ${core.formatRub(Math.round(w.target))} по плану`;
    $('planWeekBar').value = Math.round(w.pct);
  }

  // ползунок: пока человек его не трогал, стоит на нынешнем темпе
  const auto = Math.max(0, Math.min(MAX_SHIFTS_PER_WEEK, Math.round(p.currentShiftsPerWeek)));
  const n = ui.planShifts ?? auto;
  $('planShifts').value = String(n);
  showWhatIf(n);
}

export function bindPlan() {
  $('planShifts').addEventListener('input', (e) => {
    ui.planShifts = Number(e.target.value);
    showWhatIf(ui.planShifts);
  });
}
