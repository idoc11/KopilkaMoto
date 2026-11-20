// Блок «Календарь смен»: тепловая карта последних 12 недель.
import { shiftCalendar } from '../calendar.js';
import { $, h } from '../dom.js';
import { shiftsWord } from '../plan.js';
import { app, today } from './context.js';

export function renderCalendar() {
  const c = shiftCalendar(app.state.entries, today());
  const label = c.shifts
    ? `Календарь смен за 12 недель: ${c.shifts} ${shiftsWord(c.shifts)}`
    : 'Календарь смен за 12 недель: смен пока нет';
  const grid = $('calendarGrid');
  grid.setAttribute('aria-label', label);
  $('calendarSummary').textContent = c.shifts
    ? `За 12 недель — ${c.shifts} ${shiftsWord(c.shifts)}. Чем темнее клетка, тем удачнее смена.`
    : 'Смен за 12 недель пока нет. Каждая смена «Доставка» закрасит свой день.';
  grid.replaceChildren(
    ...c.weeks.flatMap((week) =>
      week.map((d) =>
        h('span', {
          className: `cal-cell l${d.level}${d.future ? ' future' : ''}${d.today ? ' now' : ''}`,
        }),
      ),
    ),
  );
}
