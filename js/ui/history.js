// Экран «История»: поиск, фильтры, порции по 100 строк.
import * as core from '../core.js';
import { $, h } from '../dom.js';
import { HISTORY_PAGE, app, today, ui } from './context.js';
import { entryItem } from './entries.js';

export function renderHistory() {
  const filters = {
    query: $('historySearch').value,
    kind: $('historyKind').value,
    period: $('historyPeriod').value,
  };
  const all = core.sortEntries(app.state.entries);
  const list = core.filterHistory(all, filters, today());
  const totals = core.totalsOf(list);
  $('count').textContent = `${list.length} из ${all.length}`;
  $('historySummary').replaceChildren(
    h(
      'dl',
      { className: 'totals' },
      h(
        'div',
        {},
        h('dt', { text: 'Доходы' }),
        h('dd', { className: 'pos', text: core.formatRub(totals.income) }),
      ),
      h(
        'div',
        {},
        h('dt', { text: 'Расходы' }),
        h('dd', { className: 'neg', text: core.formatRub(totals.spent) }),
      ),
    ),
    h('p', { className: 'hint', text: `Итог выбранных операций: ${core.formatSigned(totals.net)}` }),
  );
  const shown = list.slice(0, ui.historyLimit);
  const rest = list.length - shown.length;
  $('list').replaceChildren(
    ...(list.length
      ? [
          ...shown.map(([id, e]) => entryItem(id, e)),
          rest > 0 &&
            h(
              'li',
              { className: 'more' },
              h('button', {
                className: 'btn wide',
                type: 'button',
                id: 'historyMore',
                text: `Показать ещё ${Math.min(rest, HISTORY_PAGE)} из ${rest}`,
                onClick: () => {
                  ui.historyLimit += HISTORY_PAGE;
                  renderHistory();
                },
              }),
            ),
        ].filter(Boolean)
      : [
          h('li', {
            className: 'empty',
            text: all.length ? 'Ничего не найдено. Измени фильтры.' : 'Операций пока нет.',
          }),
        ]),
  );
}
