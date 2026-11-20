// Первый запуск: вопрос про цель и срок.
import * as core from '../core.js';
import { $ } from '../dom.js';
import { app, cloneState, commit, loaded, today, ui } from './context.js';
import { renderHome } from './home.js';
import { toast } from './notify.js';

export function setupOnboarding() {
  ui.showOnboarding = loaded.isNew && !Object.keys(app.state.entries).length;
  $('obDeadline').value = app.state.settings.deadline;
  $('obDeadline').min = core.addDays(today(), 1);
  $('onboarding').addEventListener('submit', (ev) => {
    ev.preventDefault();
    const err = $('obError');
    err.hidden = true;
    const goal = core.parseAmount($('obGoal').value);
    const start = $('obStart').value.trim() ? core.parseAmount($('obStart').value) : 0;
    const deadline = $('obDeadline').value;
    let msg = '';
    if (!(goal >= 1 && goal <= core.MAX_AMOUNT)) msg = 'Укажи стоимость мотоцикла, например 600 000.';
    else if (!(start >= 0 && start <= core.MAX_AMOUNT)) msg = 'Проверь сумму, которая уже отложена.';
    else if (!core.isValidIso(deadline) || deadline <= today())
      msg = 'Дата покупки должна быть позже сегодняшней.';
    if (msg) {
      err.textContent = msg;
      err.hidden = false;
      return;
    }
    finishOnboarding({
      goal: core.roundMoney(goal),
      start: core.roundMoney(start),
      startDate: today(),
      deadline,
    });
  });
  $('obSkip').addEventListener('click', () => finishOnboarding(app.state.settings));
}

function finishOnboarding(settings) {
  const next = cloneState();
  next.settings = { ...settings };
  if (!commit(next, { change: false })) return;
  ui.showOnboarding = false;
  renderHome();
  toast('Цель сохранена');
}
