// Главный экран: накопления, дорога с мотоциклом, график недели, месяц, отметки.
import * as core from '../core.js';
import { $, h, icon } from '../dom.js';
import { MOTION, countUp, reducedMotion, replay } from '../motion.js';
import { renderBanners } from './banners.js';
import { app, today, ui } from './context.js';
import { entryItem } from './entries.js';
import { toast } from './notify.js';
import { renderPresets } from './presets.js';

export function renderHome() {
  const t = today();
  const s = core.computeSummary(app.state, t);
  const g = app.state.settings.goal;
  $('onboarding').hidden = !ui.showOnboarding;
  countUp($('total'), ui.shownTotal, s.total, (v) => core.formatRub(Math.round(v)));
  ui.shownTotal = s.total;
  $('goalText').textContent = `из ${core.formatRub(g)} к ${core.formatDate(app.state.settings.deadline)}`;
  const road = $('progress');
  if (s.pct > ui.shownPct + 0.05) replay(road, 'driving', MOTION.drive);
  ui.shownPct = s.pct;
  // Двойной кадр — чтобы при первом показе мотоцикл выехал со старта, а не появился на месте.
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      $('fill').style.width = s.pct + '%';
      road.style.setProperty('--p', s.pct + '%');
    }),
  );
  road.classList.toggle('finished', s.phase === 'done');
  const bike = $('dreamBike');
  bike.style.setProperty('--gray', String(1 - s.pct / 100));
  bike.parentElement.classList.toggle('done', s.phase === 'done');
  bike.alt = `Мотоцикл мечты: цвет проявляется по мере накопления, сейчас ${Math.floor(s.pct)}%`;
  const pctText = s.pct.toLocaleString('ru-RU', { maximumFractionDigits: 1 }) + '%';
  $('pct').textContent = pctText;
  const progress = $('progress');
  progress.setAttribute('aria-valuenow', String(Math.round(s.pct)));
  progress.setAttribute('aria-valuetext', `${pctText}: ${core.formatRub(s.total)} из ${core.formatRub(g)}`);
  $('left').textContent = s.left ? 'ещё ' + core.formatRub(s.left) : 'набрано';
  $('perDay').textContent =
    s.perDay === null ? '—' : s.perDay === 0 ? '0 ₽' : core.formatRub(Math.ceil(s.perDay));
  $('perHour').textContent = s.perHour === null ? '—' : core.formatRub(Math.round(s.perHour));
  $('daysLeft').textContent = s.daysLeftText;
  const st = $('status');
  st.className = 'status ' + s.status.tone;
  st.textContent =
    Object.keys(app.state.entries).length || s.phase === 'done' ? s.status.text : 'Записей пока нет.';
  if (!Object.keys(app.state.entries).length && s.phase !== 'done') st.className = 'status neutral';
  $('forecast').textContent = core.forecastBothText(app.state, t);
  const lockInfo = $('lockInfo');
  lockInfo.hidden = !app.prefs.lock;
  if (app.prefs.lock) {
    const w = core.withdrawals(app.state.entries, app.prefs.lockSince);
    lockInfo.textContent = w.count
      ? `Замок включён. Из копилки брали ${w.count} раз на ${core.formatRub(w.sum)}.`
      : 'Замок включён. Из копилки ничего не брали.';
  }

  renderChart(t, { animate: ui.chartAnimate });
  ui.chartAnimate = false;

  const m = core.monthSummary(app.state.entries, t);
  $('monthIncome').textContent = core.formatRub(m.income);
  $('monthSpent').textContent = core.formatRub(m.spent);
  const net = $('monthNet');
  net.textContent = (m.net < 0 ? '−' : '') + core.formatRub(Math.abs(m.net));
  net.className = m.net < 0 ? 'neg' : 'pos';

  const spend = core.spendingBreakdown(app.state.entries, t);
  $('spendWrap').hidden = !spend.items.length;
  $('spendList').replaceChildren(
    ...spend.items.map((x) => {
      const pct = Math.round(x.share * 100);
      const bar = h('span', { className: 'spend-fill' });
      bar.style.width = `${Math.max(2, x.share * 100)}%`;
      return h(
        'li',
        {},
        h('span', { className: 'spend-label', text: x.label }),
        h('span', { className: 'spend-sum', text: `${core.formatRub(x.amount)} · ${pct}%` }),
        h('span', { className: 'spend-bar', 'aria-hidden': 'true' }, bar),
      );
    }),
  );

  const a = core.achievements(app.state, t);
  const unlocked = new Set(a.items.filter((x) => x.done).map((x) => x.title));
  const fresh = ui.knownMarks ? [...unlocked].filter((x) => !ui.knownMarks.has(x)) : [];
  ui.knownMarks = unlocked;
  $('achievements').replaceChildren(
    ...a.items.map((x) =>
      h(
        'li',
        {
          className: 'mark ' + (x.done ? 'unlocked' : 'locked') + (fresh.includes(x.title) ? ' fresh' : ''),
          title: x.hint,
        },
        icon('check'),
        x.title,
        h('span', { className: 'visually-hidden', text: x.done ? ' — есть' : ' — пока нет' }),
      ),
    ),
  );
  $('streakLabel').textContent = a.streak ? `${a.streak} дн. подряд с доходом` : '';
  $('nextAchievement').textContent = a.next ? `Дальше: ${a.next.title.toLowerCase()} — ${a.next.hint}.` : '';

  const recent = core.sortEntries(app.state.entries).slice(0, 5);
  $('recent').replaceChildren(
    ...(recent.length
      ? recent.map(([id, e]) => entryItem(id, e))
      : [h('li', { className: 'empty', text: 'Пусто. Нажми «Доход», когда закроешь первую смену.' })]),
  );
  renderPresets();
  renderBanners();
  ui.flashId = null;
  if (fresh.length) setTimeout(() => toast(`Новая отметка: ${fresh.join(', ')}`), MOTION.markToast);
}

function renderChart(t, { animate = false } = {}) {
  const { days, total } = core.weekSeries(app.state.entries, t);
  $('weekTotal').textContent = core.formatSigned(total);
  const posMax = Math.max(0, ...days.map((d) => d.value));
  const negMax = Math.max(0, ...days.map((d) => -d.value));
  const range = posMax + negMax || 1;
  const zero = posMax || !negMax ? (posMax / range) * 100 : 0;
  const chart = $('chart');
  chart.style.setProperty('--zero', `${negMax || posMax ? zero : 100}%`);
  chart.classList.toggle('animate', animate && !reducedMotion());
  if (!days.some((d) => d.date === ui.selectedDay)) ui.selectedDay = null;
  chart.replaceChildren(
    ...days.map((d) => {
      const fill = h('span', { className: 'bar-fill ' + (d.value < 0 ? 'neg' : 'pos') });
      fill.style.animationDelay = `${days.indexOf(d) * MOTION.stagger}ms`;
      const share = (Math.abs(d.value) / range) * 100;
      if (d.value > 0) {
        fill.style.bottom = `${100 - zero}%`;
        fill.style.height = `${share}%`;
      } else if (d.value < 0) {
        fill.style.top = `${zero}%`;
        fill.style.height = `${share}%`;
      } else fill.hidden = true;
      const detail = `${d.weekday}, ${core.formatDate(d.date)}: ${d.value ? core.formatSigned(d.value) : 'операций нет'}`;
      return h(
        'button',
        {
          className: 'bar',
          type: 'button',
          'aria-pressed': String(ui.selectedDay === d.date),
          dataset: { date: d.date },
          onClick: () => {
            ui.selectedDay = ui.selectedDay === d.date ? null : d.date;
            renderChart(today());
          },
        },
        h('span', { className: 'visually-hidden', text: detail }),
        h('span', {
          className: 'bar-value ' + (d.value > 0 ? 'pos' : d.value < 0 ? 'neg' : ''),
          'aria-hidden': 'true',
          text: d.value ? core.formatCompact(d.value) : '·',
        }),
        h('span', { className: 'bar-plot', 'aria-hidden': 'true' }, fill),
        h('span', { className: 'bar-day', 'aria-hidden': 'true', text: d.weekday }),
      );
    }),
  );
  const sel = days.find((d) => d.date === ui.selectedDay);
  $('chartDetail').textContent = sel
    ? `${sel.weekday}, ${core.formatDate(sel.date)}: ${sel.value ? core.formatSigned(sel.value) : 'операций нет'}`
    : 'Доходы минус расходы по дням. Нажми на столбец, чтобы увидеть сумму.';
}
