// Блок «Когда выгоднее работать»: средняя смена по дням недели за 8 недель.
import * as core from '../core.js';
import { $, h } from '../dom.js';
import { MIN_SHIFTS, weekdayStats } from '../insights.js';
import { shiftsWord } from '../plan.js';
import { app, today } from './context.js';

const rub = (n) => core.formatRub(Math.round(n));

function lead(s) {
  if (!s.shiftDays)
    return 'Пока нет смен за последние 8 недель. Добавь доход «Доставка» — здесь появится разбор по дням недели.';
  if (!s.enough) {
    return `Нужно хотя бы ${MIN_SHIFTS} смен за 8 недель, сейчас ${s.shiftDays}. Продолжай записывать — выводы появятся сами.`;
  }
  if (s.best === null)
    return 'Пока нет дня, который заметно выделялся бы: нужно хотя бы по 2 смены в разные дни недели.';
  const b = s.days[s.best];
  const w = s.days[s.worst];
  const per = b.perHour ? `, ≈ ${rub(b.perHour)} в час` : '';
  return `Лучший день — ${b.full}: в среднем ${rub(b.avg)} за смену${per} (${b.shifts} ${shiftsWord(b.shifts)}). Слабее всего — ${w.full}: ${rub(w.avg)}.`;
}

export function renderInsights() {
  const s = weekdayStats(app.state.entries, today());
  $('insightsLead').textContent = lead(s);
  const badge = $('insightsBadge');
  badge.textContent = s.best === null ? '' : s.days[s.best].label;
  badge.hidden = s.best === null;
  const top = Math.max(0, ...s.days.map((d) => d.avg ?? 0));
  $('insightsList').replaceChildren(
    ...s.days.map((d) => {
      const fill = h('span', { className: 'spend-fill' });
      fill.style.width = d.avg ? `${Math.max(2, (d.avg / top) * 100)}%` : '0%';
      const sum = d.shifts ? `${rub(d.avg)} · ${d.shifts} ${shiftsWord(d.shifts)}` : 'нет смен';
      return h(
        'li',
        { className: d.index === s.best ? 'best' : d.index === s.worst ? 'worst' : '' },
        h('span', { className: 'spend-label', text: d.label }),
        h('span', { className: 'spend-sum', text: sum }),
        h('span', { className: 'spend-bar', 'aria-hidden': 'true' }, fill),
      );
    }),
  );
}
