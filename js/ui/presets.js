// Частые расходы: кнопки на главной и в форме, настройка списка.
import * as core from '../core.js';
import { $, h } from '../dom.js';
import { haptic } from '../motion.js';
import { app, cloneState, commit, savePrefs, today, ui } from './context.js';
import { confirmSpend } from './form.js';
import { toast } from './notify.js';
import { renderAll } from './router.js';

const presetLabel = (p) => `${p.note} −${core.formatRub(p.amount)}`;

export function renderPresets() {
  const list = app.prefs.presets;
  $('presetsHome').hidden = !list.length;
  $('quickSpend').replaceChildren(
    ...list.map((p) =>
      h('button', {
        className: 'btn small preset',
        type: 'button',
        text: presetLabel(p),
        'aria-label': `Записать расход: ${p.note}, ${core.formatRub(p.amount)}`,
        onClick: () => recordPreset(p),
      }),
    ),
  );
  $('presetChips').replaceChildren(
    ...list.map((p) =>
      h('button', {
        className: 'btn small preset',
        type: 'button',
        text: presetLabel(p),
        'aria-label': `Подставить: ${p.note}, ${core.formatRub(p.amount)}`,
        onClick: () => {
          $('amount').value = core.formatNumber(p.amount);
          $('note').value = p.note;
          $('amount').removeAttribute('aria-invalid');
        },
      }),
    ),
  );
  $('presetChips').hidden = ui.kind !== 'spent' || !list.length;
  $('presetList').replaceChildren(
    ...(list.length
      ? list.map((p, i) =>
          h(
            'li',
            {},
            h('span', { text: `${p.note} — ${core.formatRub(p.amount)}` }),
            h('button', {
              className: 'btn small ghost',
              type: 'button',
              text: 'Удалить',
              'aria-label': `Удалить частый расход ${p.note}`,
              onClick: () => {
                app.prefs.presets = app.prefs.presets.filter((_, j) => j !== i);
                savePrefs();
                renderPresets();
              },
            }),
          ),
        )
      : [h('li', { className: 'empty', text: 'Пока пусто. Добавь первый ниже.' })]),
  );
}

async function recordPreset(p) {
  if (!(await confirmSpend(p.amount))) return;
  const id = core.newEntryId();
  const next = cloneState();
  next.entries[id] = {
    date: today(),
    amount: p.amount,
    hours: 0,
    kind: 'spent',
    note: p.note,
    ts: Date.now(),
  };
  if (!commit(next)) return;
  ui.flashId = id;
  haptic();
  renderAll();
  toast(`Записано: ${presetLabel(p)}`, {
    action: 'Отменить',
    onAction: () => {
      if (!app.state.entries[id]) return;
      const back = cloneState();
      delete back.entries[id];
      if (commit(back)) {
        renderAll();
        toast('Расход отменён');
      }
    },
  });
}

export function submitPreset(ev) {
  ev.preventDefault();
  const err = $('presetError');
  err.hidden = true;
  const note = $('presetName').value.trim();
  const amount = core.parseAmount($('presetAmount').value);
  let msg = '';
  if (!note) msg = 'Напиши название, например «Электричка».';
  else if (!(amount >= 1 && amount <= core.MAX_AMOUNT)) msg = 'Сумма — от 1 ₽, например 100 или 99,50.';
  else if (app.prefs.presets.some((p) => p.note.toLowerCase() === note.toLowerCase()))
    msg = 'Такой уже есть.';
  else if (app.prefs.presets.length >= core.MAX_PRESETS)
    msg = `Можно не больше ${core.MAX_PRESETS} частых расходов.`;
  if (msg) {
    err.textContent = msg;
    err.hidden = false;
    return;
  }
  app.prefs.presets = core.normalizePresets([...app.prefs.presets, { note, amount }]);
  savePrefs();
  $('presetForm').reset();
  renderPresets();
  toast(`Добавлено: ${note}`);
}
