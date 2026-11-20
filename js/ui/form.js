// Форма новой записи и правки: тип, проверка полей, замок до цели.
import * as core from '../core.js';
import { $ } from '../dom.js';
import { haptic } from '../motion.js';
import { app, cloneState, commit, today, ui } from './context.js';
import { confirmDialog, toast } from './notify.js';
import { go } from './router.js';

export function setKind(kind) {
  ui.kind = kind;
  for (const b of $('kinds').querySelectorAll('[data-kind]')) {
    b.setAttribute('aria-pressed', String(b.dataset.kind === kind));
  }
  $('hoursWrap').hidden = kind !== 'delivery';
  $('quickAmounts').hidden = kind === 'spent';
  $('presetChips').hidden = kind !== 'spent' || !app.prefs.presets.length;
}

function clearFormErrors() {
  $('formError').hidden = true;
  for (const id of ['amount', 'date', 'hours']) $(id).removeAttribute('aria-invalid');
}

function formError(fieldId, text) {
  const field = $(fieldId);
  field.setAttribute('aria-invalid', 'true');
  const err = $('formError');
  err.textContent = text;
  err.hidden = false;
  field.focus();
}

export function prepareForm() {
  const t = today();
  const date = $('date');
  date.max = t;
  // Автоматическую дату обновляем (приложение могло быть открыто с вечера), выбранную вручную — не трогаем.
  if (!ui.editingId && (!date.value || date.value === ui.autoDate)) {
    date.value = t;
    ui.autoDate = t;
  }
}

export function resetForm(kind = 'delivery') {
  ui.editingId = null;
  $('entryForm').reset();
  $('date').value = today();
  ui.autoDate = today();
  $('date').max = today();
  $('h-add').textContent = 'Новая запись';
  $('saveEntry').textContent = 'Сохранить';
  $('cancelEntry').hidden = true;
  clearFormErrors();
  setKind(kind);
}

export function openAdd(kind) {
  resetForm(kind);
  go('add');
}

/** Замок до цели: подтверждение расхода с задержкой. Без замка — сразу true. */
export async function confirmSpend(amount) {
  if (!app.prefs.lock) return true;
  const left = Math.max(0, app.state.settings.goal - core.balance(app.state));
  const delay = core.delayDays(app.state, amount, today());
  const lines = [
    `До мотоцикла не хватает ${core.formatRub(left)}.`,
    delay ? `Этот расход отодвинет покупку примерно на ${delay} дн.` : '',
    'Если это не срочно — лучше отложить.',
  ].filter(Boolean);
  return confirmDialog({
    title: `Взять ${core.formatRub(amount)} из копилки?`,
    text: lines.join('\n'),
    ok: 'Всё равно записать',
    danger: true,
    delay: 3,
  });
}

export async function submitEntry(ev) {
  ev.preventDefault();
  clearFormErrors();
  const t = today();
  const editing = ui.editingId;
  const original = editing ? app.state.entries[editing] : null;
  if (editing && !original) {
    toast('Эта запись уже удалена');
    resetForm();
    return;
  }
  const amount = core.parseAmount($('amount').value);
  if (!(amount >= 1 && amount <= core.MAX_AMOUNT)) {
    return formError('amount', 'Введи сумму от 1 до 1 000 000 000 ₽ (например, 1500 или 1500,50).');
  }
  const date = $('date').value || t;
  if (!core.isValidIso(date)) return formError('date', 'Проверь дату операции.');
  if (date > t && !(original && original.date === date)) {
    return formError('date', 'Дата не может быть в будущем.');
  }
  let hours = 0;
  if (ui.kind === 'delivery') {
    hours = core.parseHours($('hours').value);
    if (!(hours >= 0 && hours <= core.MAX_HOURS_PER_ENTRY)) {
      return formError('hours', 'Часы работы — от 0 до 24, например 7:30 или 7,5.');
    }
  }
  if (ui.kind === 'spent' && !editing && !(await confirmSpend(amount))) return;
  const id = editing || core.newEntryId();
  const next = cloneState();
  next.entries[id] = {
    date,
    amount: core.roundMoney(amount),
    hours: Math.round(hours * 100) / 100,
    kind: ui.kind,
    note: $('note').value.trim().slice(0, core.MAX_NOTE),
    ts: original ? original.ts : Date.now(),
  };
  if (!commit(next)) return;
  resetForm();
  ui.flashId = id;
  haptic();
  toast(editing ? 'Изменения сохранены' : 'Записано');
  go('home', { replace: true });
}
