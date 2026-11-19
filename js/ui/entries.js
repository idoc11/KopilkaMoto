// Строка операции в списках; правка и удаление записи.
import * as core from '../core.js';
import { $, h, icon } from '../dom.js';
import { leave } from '../motion.js';
import { app, cloneState, commit, ui } from './context.js';
import { resetForm } from './form.js';
import { toast } from './notify.js';
import { go, renderAll } from './router.js';

function entryTitle(e) {
  return e.note || core.KINDS[e.kind].label;
}

export function entryItem(id, e) {
  const income = core.KINDS[e.kind].income;
  const sum = (income ? '+' : '−') + core.formatRub(e.amount);
  const sub = core.formatDate(e.date) + (e.hours ? ` · ${core.formatHours(e.hours)}` : '');
  const label = `${entryTitle(e)}, ${core.formatDate(e.date)}, ${sum}`;
  return h(
    'li',
    { className: 'entry' + (ui.flashId === id ? ' flash' : ''), dataset: { id } },
    h(
      'div',
      { className: 'desc' },
      h('p', { className: 'title', text: entryTitle(e) }),
      h('p', { className: 'sub', text: sub + (e.note ? ` · ${core.KINDS[e.kind].label}` : '') }),
    ),
    h('span', { className: 'sum ' + (income ? 'pos' : 'neg'), text: sum }),
    h(
      'div',
      { className: 'entry-actions' },
      h(
        'button',
        {
          className: 'icon-btn',
          type: 'button',
          'aria-label': `Изменить: ${label}`,
          onClick: () => editEntry(id),
        },
        icon('edit'),
      ),
      h(
        'button',
        {
          className: 'icon-btn',
          type: 'button',
          'aria-label': `Удалить: ${label}`,
          onClick: (ev) => deleteEntry(id, ev.currentTarget.closest('.entry')),
        },
        icon('trash'),
      ),
    ),
  );
}

function editEntry(id) {
  const e = app.state.entries[id];
  if (!e) return;
  resetForm(e.kind);
  ui.editingId = id;
  $('amount').value = String(e.amount).replace('.', ',');
  $('date').value = e.date;
  $('hours').value = core.hoursInputValue(e.hours);
  $('note').value = e.note;
  $('h-add').textContent = 'Правка записи';
  $('saveEntry').textContent = 'Сохранить изменения';
  $('cancelEntry').hidden = false;
  go('add');
}

function deleteEntry(id, row) {
  if (!app.state.entries[id]) return;
  const list = row?.closest('ul');
  const index = list ? [...list.querySelectorAll('.entry')].indexOf(row) : -1;
  leave(row, () => {
    removeEntry(id);
    if (list) restoreFocus(list.id, index);
  });
}

/** После удаления строки фокус — на соседнюю запись, иначе на заголовок раздела (клавиатура, экранный диктор). */
function restoreFocus(listId, index) {
  const rows = [...($(listId)?.querySelectorAll('.entry') ?? [])];
  const row = rows[index] ?? rows[index - 1];
  const target = row?.querySelector('.entry-actions .icon-btn:last-child') ?? $('h-' + ui.page);
  target?.focus({ preventScroll: !row });
}

function removeEntry(id) {
  const removed = app.state.entries[id];
  if (!removed) return;
  const next = cloneState();
  delete next.entries[id];
  if (!commit(next)) return;
  if (ui.editingId === id) resetForm();
  renderAll();
  toast('Запись удалена', {
    action: 'Отменить',
    onAction: () => {
      if (app.state.entries[id]) return;
      const back = cloneState();
      back.entries[id] = removed;
      if (commit(back)) {
        ui.flashId = id;
        renderAll();
        toast('Запись возвращена');
      }
    },
  });
}
