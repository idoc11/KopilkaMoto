import * as core from './core.js';
import { createStore } from './storage.js';
import { renderMarkdown } from './markdown.js';
import { MOTION, countUp, haptic, leave, reducedMotion, replay } from './motion.js';
import { $, h, icon, serviceWorkerUrl } from './dom.js';

const APP_VERSION = '6.7.0';
const PAGES = ['home', 'add', 'history', 'ai', 'settings'];
/** Сколько строк истории рисовать за раз: тысячи DOM-узлов тормозят поиск на телефоне. */
const HISTORY_PAGE = 100;
const THEME_COLORS = { light: '#f4f2ed', dark: '#0d0e11' };
const THEME_NAMES = { auto: 'как в системе', light: 'светлая', dark: 'тёмная' };

const today = () => core.todayIso();

// ---------- Хранилище ----------

function memoryStorage() {
  const m = new Map();
  return {
    get length() {
      return m.size;
    },
    key: (i) => [...m.keys()][i] ?? null,
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
  };
}

function detectStorage() {
  try {
    const s = window.localStorage;
    const probe = '__kopilkamoto_probe__';
    s.setItem(probe, '1');
    s.removeItem(probe);
    return { storage: s, ok: true };
  } catch {
    return { storage: memoryStorage(), ok: false };
  }
}

const { storage, ok: storageOk } = detectStorage();
const store = createStore(storage);

// ---------- Состояние ----------

const loaded = store.load();
let state = loaded.state;
let prefs = store.loadPrefs();
let chat = store.loadChat();
const ui = {
  page: 'home',
  prevPage: 'home',
  showOnboarding: false,
  kind: 'delivery',
  editingId: null,
  selectedDay: null,
  aiBusy: false,
  installPrompt: null,
  persistAsked: false,
  dataWarning: null,
  shownTotal: 0,
  shownPct: 0,
  knownMarks: null,
  flashId: null,
  chartAnimate: true,
  historyLimit: HISTORY_PAGE,
};

function cloneState(s = state) {
  return { ...s, entries: Object.assign(Object.create(null), s.entries), settings: { ...s.settings } };
}

/** Сохраняет новое состояние. При ошибке записи текущее состояние не меняется. */
function commit(next, { change = true } = {}) {
  if (!store.save(next)) {
    toast('Не удалось сохранить данные. Освободи память браузера и скачай резервную копию.');
    return false;
  }
  state = next;
  if (change) {
    prefs.changesSinceBackup += 1;
    store.savePrefs(prefs);
  }
  requestPersistentStorage();
  return true;
}

function savePrefs() {
  if (!store.savePrefs(prefs)) toast('Не удалось сохранить настройки');
}

async function requestPersistentStorage() {
  if (ui.persistAsked || !navigator.storage?.persist) return;
  ui.persistAsked = true;
  try {
    if (!(await navigator.storage.persisted())) await navigator.storage.persist();
  } catch {
    /* браузер не поддерживает */
  }
  renderStorageInfo();
}

// ---------- Уведомления и диалоги ----------

let toastTimer = 0;
let toastHasAction = false;
let queuedToast = null;

function hideToast() {
  $('toast').hidden = true;
  toastHasAction = false;
  clearTimeout(toastTimer);
  // Отложенное сообщение показываем, когда ушёл тост с кнопкой.
  if (queuedToast) {
    const next = queuedToast;
    queuedToast = null;
    setTimeout(() => toast(...next), 300);
  }
}

function toast(text, { action, onAction, duration = 2800 } = {}) {
  const el = $('toast');
  // Информационный тост не должен вытеснять тост с действием («Отменить»): ставим его в очередь.
  if (!action && toastHasAction && !el.hidden) {
    queuedToast = [text, { duration }];
    return;
  }
  const btn = $('toastAction');
  $('toastText').textContent = text;
  btn.hidden = !action;
  btn.textContent = action || '';
  btn.onclick = action
    ? () => {
        hideToast();
        onAction();
      }
    : null;
  el.hidden = false;
  toastHasAction = Boolean(action);
  announce(action ? `${text}. Кнопка «${action}» доступна несколько секунд.` : text);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, action ? Math.max(duration, 6000) : duration);
}

function announce(text) {
  const a = $('announcer');
  a.textContent = '';
  setTimeout(() => (a.textContent = text), 50);
}

function confirmDialog({ title, text, ok = 'Подтвердить', danger = false, delay = 0 }) {
  const dlg = $('dialog');
  const okBtn = $('dialogOk');
  $('dialogTitle').textContent = title;
  $('dialogText').textContent = text;
  okBtn.textContent = ok;
  okBtn.disabled = false;
  dlg.classList.toggle('danger', danger);
  if (typeof dlg.showModal !== 'function') return Promise.resolve(window.confirm(`${title}\n\n${text}`));
  return new Promise((resolve) => {
    let left = delay;
    let timer = 0;
    // Задержка перед подтверждением: время передумать (замок до цели).
    if (left > 0) {
      okBtn.disabled = true;
      okBtn.textContent = `${ok} (${left})`;
      timer = setInterval(() => {
        left -= 1;
        okBtn.textContent = left > 0 ? `${ok} (${left})` : ok;
        if (left <= 0) {
          okBtn.disabled = false;
          clearInterval(timer);
        }
      }, 1000);
    }
    dlg.returnValue = '';
    dlg.addEventListener(
      'close',
      () => {
        clearInterval(timer);
        okBtn.disabled = false;
        resolve(dlg.returnValue === 'ok');
      },
      { once: true },
    );
    dlg.showModal();
    $('dialogCancel').focus();
  });
}

function download(name, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = h('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// ---------- Тема ----------

function resolvedTheme() {
  if (prefs.theme !== 'auto') return prefs.theme;
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyTheme() {
  const t = resolvedTheme();
  document.documentElement.dataset.theme = t;
  for (const m of document.querySelectorAll('meta[name="theme-color"]')) m.content = THEME_COLORS[t];
  $('theme').value = prefs.theme;
  const btn = $('themeBtn');
  btn.dataset.mode = prefs.theme;
  btn.setAttribute('aria-label', `Тема: ${THEME_NAMES[prefs.theme]}. Нажми, чтобы сменить`);
  btn.title = `Тема: ${THEME_NAMES[prefs.theme]}`;
}

// ---------- Навигация ----------

function pageFromHash() {
  const p = location.hash.slice(1);
  return PAGES.includes(p) ? p : 'home';
}

function go(page, { replace = false } = {}) {
  const hash = '#' + page;
  if (location.hash !== hash) history[replace ? 'replaceState' : 'pushState'](null, '', hash);
  showPage(page);
}

function showPage(page, { focus = true } = {}) {
  if (page !== 'add' && ui.editingId) resetForm();
  if (page !== ui.page) ui.prevPage = ui.page;
  ui.page = page;
  for (const p of PAGES) $('page-' + p).hidden = p !== page;
  replay($('page-' + page), 'enter', 400);
  for (const a of document.querySelectorAll('[data-nav]')) {
    if (a.dataset.nav === page) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
  if (page === 'home') {
    ui.chartAnimate = true;
    renderHome();
  }
  if (page === 'history') {
    ui.historyLimit = HISTORY_PAGE;
    renderHistory();
  }
  if (page === 'add') prepareForm();
  if (page === 'settings') renderSettings();
  if (page === 'ai') renderChat();
  document.title = page === 'home' ? 'KopilkaMoto' : `${$('h-' + page).textContent} — KopilkaMoto`;
  window.scrollTo(0, 0);
  if (focus) $('h-' + page).focus({ preventScroll: true });
}

// ---------- Отрисовка ----------

function entryTitle(e) {
  return e.note || core.KINDS[e.kind].label;
}

function entryItem(id, e) {
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

function renderHome() {
  const t = today();
  const s = core.computeSummary(state, t);
  const g = state.settings.goal;
  $('onboarding').hidden = !ui.showOnboarding;
  countUp($('total'), ui.shownTotal, s.total, (v) => core.formatRub(Math.round(v)));
  ui.shownTotal = s.total;
  $('goalText').textContent = `из ${core.formatRub(g)} к ${core.formatDate(state.settings.deadline)}`;
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
    Object.keys(state.entries).length || s.phase === 'done' ? s.status.text : 'Записей пока нет.';
  if (!Object.keys(state.entries).length && s.phase !== 'done') st.className = 'status neutral';
  $('forecast').textContent = core.forecastBothText(state, t);
  const lockInfo = $('lockInfo');
  lockInfo.hidden = !prefs.lock;
  if (prefs.lock) {
    const w = core.withdrawals(state.entries, prefs.lockSince);
    lockInfo.textContent = w.count
      ? `Замок включён. Из копилки брали ${w.count} раз на ${core.formatRub(w.sum)}.`
      : 'Замок включён. Из копилки ничего не брали.';
  }

  renderChart(t, { animate: ui.chartAnimate });
  ui.chartAnimate = false;

  const m = core.monthSummary(state.entries, t);
  $('monthIncome').textContent = core.formatRub(m.income);
  $('monthSpent').textContent = core.formatRub(m.spent);
  const net = $('monthNet');
  net.textContent = (m.net < 0 ? '−' : '') + core.formatRub(Math.abs(m.net));
  net.className = m.net < 0 ? 'neg' : 'pos';

  const spend = core.spendingBreakdown(state.entries, t);
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

  const a = core.achievements(state, t);
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

  const recent = core.sortEntries(state.entries).slice(0, 5);
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
  const { days, total } = core.weekSeries(state.entries, t);
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

function renderHistory() {
  const filters = {
    query: $('historySearch').value,
    kind: $('historyKind').value,
    period: $('historyPeriod').value,
  };
  const all = core.sortEntries(state.entries);
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

function formatAgo(ts) {
  const days = Math.floor((Date.now() - ts) / 86_400_000);
  const when = new Date(ts).toLocaleDateString('ru-RU');
  if (days <= 0) return `сегодня (${when})`;
  if (days === 1) return `вчера (${when})`;
  return `${when}, ${days} дн. назад`;
}

function renderBanners() {
  $('storageBanner').hidden = storageOk;
  const dw = ui.dataWarning;
  $('dataBanner').hidden = !dw;
  if (dw) $('dataBannerText').textContent = dw.text;
  $('dataBannerDownload').hidden = !dw?.rawKey;
  const reason = storageOk ? core.backupReminder(prefs, Object.keys(state.entries).length) : null;
  $('backupBanner').hidden = !reason;
  if (reason) {
    $('backupBannerText').textContent =
      reason === 'never'
        ? 'Данные хранятся только в этом браузере. Скачай резервную копию, чтобы не потерять накопления.'
        : reason === 'changes'
          ? `С последней копии изменено ${prefs.changesSinceBackup} записей. Скачай свежую копию.`
          : `Последняя резервная копия — ${formatAgo(prefs.lastBackupAt)}. Пора сделать новую.`;
  }
}

async function renderStorageInfo() {
  let text = storageOk ? 'Данные хранятся только в этом браузере.' : 'Хранилище браузера недоступно.';
  try {
    if (storageOk && navigator.storage?.persisted) {
      text += (await navigator.storage.persisted())
        ? ' Браузер не будет удалять их автоматически.'
        : ' Браузер может очистить их при нехватке места или долгом простое — регулярно скачивай копию.';
    }
  } catch {
    /* ignore */
  }
  $('storageInfo').textContent = text;
}

function renderSettings() {
  const s = state.settings;
  $('goalInput').value = core.formatNumber(s.goal);
  $('startInput').value = core.formatNumber(s.start);
  $('startDateInput').value = s.startDate;
  $('deadlineInput').value = s.deadline;
  $('apiUrl').value = prefs.apiUrl;
  $('lockToggle').checked = prefs.lock;
  renderPresets();
  $('backupInfo').textContent = prefs.lastBackupAt
    ? `Последняя копия: ${formatAgo(prefs.lastBackupAt)}.`
    : 'Резервную копию ещё не скачивали.';
  renderStorageInfo();
  renderRawCopies();
  $('versionInfo').textContent = `Версия ${APP_VERSION}`;
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  $('installHint').textContent = standalone
    ? 'Приложение установлено.'
    : ios
      ? 'На iPhone: Safari → «Поделиться» → «На экран Домой». Установленное приложение лучше защищено от очистки данных.'
      : ui.installPrompt
        ? ''
        : 'Чтобы установить, открой меню браузера → «Установить приложение» или «Добавить на главный экран».';
}

function renderRawCopies() {
  const keys = store.rawKeys();
  $('rawCopies').hidden = !keys.length;
  $('rawList').replaceChildren(
    ...keys.map((k) => {
      const stamp = k.slice(core.RAW_PREFIX.length).replace(/T(\d\d)-(\d\d)-(\d\d)-\d+Z$/, ' $1:$2 UTC');
      return h(
        'li',
        {},
        h('span', { text: stamp }),
        h(
          'span',
          { className: 'banner-actions' },
          h('button', {
            className: 'btn small',
            type: 'button',
            text: 'Скачать',
            onClick: () => downloadRaw(k),
          }),
          h('button', {
            className: 'btn small ghost',
            type: 'button',
            text: 'Удалить',
            'aria-label': `Удалить копию от ${stamp}`,
            onClick: async () => {
              if (
                await confirmDialog({
                  title: 'Удалить сохранённые данные?',
                  text: 'Сначала лучше скачать файл. Удаление нельзя отменить.',
                  ok: 'Удалить',
                  danger: true,
                })
              ) {
                store.removeRaw(k);
                renderRawCopies();
              }
            },
          }),
        ),
      );
    }),
  );
}

function downloadRaw(key) {
  const raw = store.readRaw(key);
  if (raw) download(`kopilkamoto-raw-${key.slice(core.RAW_PREFIX.length)}.json`, raw, 'application/json');
}

function renderAll() {
  if (ui.page === 'home') renderHome();
  else renderBanners();
  if (ui.page === 'history') renderHistory();
  if (ui.page === 'settings') renderSettings();
}

// ---------- Форма операции ----------

function setKind(kind) {
  ui.kind = kind;
  for (const b of $('kinds').querySelectorAll('[data-kind]')) {
    b.setAttribute('aria-pressed', String(b.dataset.kind === kind));
  }
  $('hoursWrap').hidden = kind !== 'delivery';
  $('quickAmounts').hidden = kind === 'spent';
  $('presetChips').hidden = kind !== 'spent' || !prefs.presets.length;
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

function prepareForm() {
  const t = today();
  const date = $('date');
  date.max = t;
  // Автоматическую дату обновляем (приложение могло быть открыто с вечера), выбранную вручную — не трогаем.
  if (!ui.editingId && (!date.value || date.value === ui.autoDate)) {
    date.value = t;
    ui.autoDate = t;
  }
}

function resetForm(kind = 'delivery') {
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

function openAdd(kind) {
  resetForm(kind);
  go('add');
}

function editEntry(id) {
  const e = state.entries[id];
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

/** Замок до цели: подтверждение расхода с задержкой. Без замка — сразу true. */
async function confirmSpend(amount) {
  if (!prefs.lock) return true;
  const left = Math.max(0, state.settings.goal - core.balance(state));
  const delay = core.delayDays(state, amount, today());
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

// ---------- Частые расходы ----------

const presetLabel = (p) => `${p.note} −${core.formatRub(p.amount)}`;

function renderPresets() {
  const list = prefs.presets;
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
                prefs.presets = prefs.presets.filter((_, j) => j !== i);
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
      if (!state.entries[id]) return;
      const back = cloneState();
      delete back.entries[id];
      if (commit(back)) {
        renderAll();
        toast('Расход отменён');
      }
    },
  });
}

function submitPreset(ev) {
  ev.preventDefault();
  const err = $('presetError');
  err.hidden = true;
  const note = $('presetName').value.trim();
  const amount = core.parseAmount($('presetAmount').value);
  let msg = '';
  if (!note) msg = 'Напиши название, например «Электричка».';
  else if (!(amount >= 1 && amount <= core.MAX_AMOUNT)) msg = 'Сумма — от 1 ₽, например 100 или 99,50.';
  else if (prefs.presets.some((p) => p.note.toLowerCase() === note.toLowerCase())) msg = 'Такой уже есть.';
  else if (prefs.presets.length >= core.MAX_PRESETS)
    msg = `Можно не больше ${core.MAX_PRESETS} частых расходов.`;
  if (msg) {
    err.textContent = msg;
    err.hidden = false;
    return;
  }
  prefs.presets = core.normalizePresets([...prefs.presets, { note, amount }]);
  savePrefs();
  $('presetForm').reset();
  renderPresets();
  toast(`Добавлено: ${note}`);
}

async function submitEntry(ev) {
  ev.preventDefault();
  clearFormErrors();
  const t = today();
  const editing = ui.editingId;
  const original = editing ? state.entries[editing] : null;
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

function deleteEntry(id, row) {
  if (!state.entries[id]) return;
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
  const removed = state.entries[id];
  if (!removed) return;
  const next = cloneState();
  delete next.entries[id];
  if (!commit(next)) return;
  if (ui.editingId === id) resetForm();
  renderAll();
  toast('Запись удалена', {
    action: 'Отменить',
    onAction: () => {
      if (state.entries[id]) return;
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

// ---------- Онбординг ----------

function setupOnboarding() {
  ui.showOnboarding = loaded.isNew && !Object.keys(state.entries).length;
  $('obDeadline').value = state.settings.deadline;
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
  $('obSkip').addEventListener('click', () => finishOnboarding(state.settings));
}

function finishOnboarding(settings) {
  const next = cloneState();
  next.settings = { ...settings };
  if (!commit(next, { change: false })) return;
  ui.showOnboarding = false;
  renderHome();
  toast('Цель сохранена');
}

// ---------- Настройки ----------

function submitSettings(ev) {
  ev.preventDefault();
  const err = $('settingsError');
  err.hidden = true;
  const goal = core.parseAmount($('goalInput').value);
  const start = $('startInput').value.trim() ? core.parseAmount($('startInput').value) : 0;
  const startDate = $('startDateInput').value;
  const deadline = $('deadlineInput').value;
  let msg = '';
  if (!(goal >= 1 && goal <= core.MAX_AMOUNT)) msg = 'Цель — от 1 до 1 000 000 000 ₽.';
  else if (!(start >= 0 && start <= core.MAX_AMOUNT)) msg = 'Уже отложенная сумма — от 0 до 1 000 000 000 ₽.';
  else if (!core.isValidIso(startDate) || !core.isValidIso(deadline)) msg = 'Укажи обе даты.';
  else if (deadline <= startDate) msg = 'Дата цели должна быть позже даты начала.';
  if (msg) {
    err.textContent = msg;
    err.hidden = false;
    return;
  }
  const next = cloneState();
  next.settings = { goal: core.roundMoney(goal), start: core.roundMoney(start), startDate, deadline };
  if (commit(next)) {
    ui.showOnboarding = false;
    toast('Цель и сроки сохранены');
  }
}

function submitApi(ev) {
  ev.preventDefault();
  const value = $('apiUrl').value.trim();
  if (value) {
    let url;
    try {
      url = new URL(value);
    } catch {
      /* ниже */
    }
    if (!url || url.protocol !== 'https:') {
      toast('Нужен корректный адрес, начинающийся с https://');
      $('apiUrl').focus();
      return;
    }
    prefs.apiUrl = url.href;
  } else prefs.apiUrl = '';
  savePrefs();
  $('apiUrl').value = prefs.apiUrl;
  toast(prefs.apiUrl ? 'Адрес сохранён' : 'AI-помощник отключён');
}

// ---------- Резервные копии ----------

function exportBackup() {
  download(
    `kopilkamoto-${today()}.json`,
    JSON.stringify(core.buildBackup(state, new Date(), prefs), null, 2),
    'application/json',
  );
  prefs.lastBackupAt = Date.now();
  prefs.changesSinceBackup = 0;
  prefs.snoozeUntil = 0;
  savePrefs();
  renderAll();
  toast('Копия скачана');
}

async function importBackup(file) {
  if (!file) return;
  if (file.size > core.MAX_BACKUP_BYTES) {
    toast('Файл слишком большой для резервной копии KopilkaMoto');
    return;
  }
  let parsed;
  try {
    parsed = core.parseBackup(await file.text(), today());
  } catch (e) {
    toast(e instanceof core.BackupError ? e.message : 'Не удалось прочитать файл');
    return;
  }
  const count = Object.keys(parsed.state.entries).length;
  const current = Object.keys(state.entries).length;
  const lines = [
    `В копии операций: ${count}.`,
    parsed.rejected.length ? `Не удалось прочитать: ${parsed.rejected.length}.` : '',
    `Сейчас в приложении: ${current}. Текущие данные будут заменены, но их можно вернуть кнопкой «Отменить».`,
  ].filter(Boolean);
  const ok = await confirmDialog({
    title: 'Восстановить из копии?',
    text: lines.join('\n'),
    ok: 'Заменить данные',
    danger: true,
  });
  if (!ok) return;
  const previous = state;
  const previousPrefs = { ...prefs };
  if (current) store.preserveRaw(core.serializeState(previous));
  if (!commit(parsed.state, { change: false })) return;
  if (parsed.preferences) applyBackupPreferences(parsed.preferences);
  if (ui.editingId) resetForm();
  ui.showOnboarding = false;
  renderAll();
  toast(
    `Копия восстановлена: ${count} операций` +
      (parsed.rejected.length ? `, пропущено ${parsed.rejected.length}` : ''),
    {
      action: 'Отменить',
      duration: 8000,
      onAction: () => {
        if (commit(previous, { change: false })) {
          prefs = previousPrefs;
          savePrefs();
          applyTheme();
          renderAll();
          toast('Прежние данные возвращены');
        }
      },
    },
  );
}

/** Настройки из копии: частые расходы, замок, тема. Адрес прокси и даты копий остаются местными. */
function applyBackupPreferences(p) {
  const lockChanged = p.lock !== prefs.lock;
  prefs = { ...prefs, presets: p.presets, lock: p.lock, theme: p.theme };
  if (lockChanged) prefs.lockSince = p.lock ? Date.now() : 0;
  savePrefs();
  applyTheme();
}

function exportCsv() {
  download(`kopilkamoto-history-${today()}.csv`, core.buildCsv(state.entries), 'text/csv;charset=utf-8');
  toast('CSV скачан');
}

// ---------- AI ----------

function bubble(role, text, extraClass = '') {
  const el = h('div', { className: `bubble ${role} ${extraClass}`.trim() });
  if (role === 'ai') el.append(renderMarkdown(text));
  else el.textContent = text;
  return el;
}

function renderChat({ pending = false, error = '' } = {}) {
  const items = chat.length
    ? chat.map((m) => bubble(m.role === 'user' ? 'user' : 'ai', m.content))
    : [
        bubble(
          'ai',
          prefs.apiUrl
            ? 'Спроси про накопления: сколько смен осталось, на чём можно сэкономить, успеваешь ли к сроку.'
            : 'Чтобы задавать вопросы, укажи адрес прокси в **Настройки → Помощник**.',
        ),
      ];
  if (pending) {
    items.push(
      h(
        'div',
        { className: 'bubble typing', 'aria-busy': 'true' },
        h('span', { className: 'visually-hidden', text: 'Помощник печатает' }),
        h('span', { className: 'dot', 'aria-hidden': 'true' }),
        h('span', { className: 'dot', 'aria-hidden': 'true' }),
        h('span', { className: 'dot', 'aria-hidden': 'true' }),
      ),
    );
  }
  if (error) items.push(h('div', { className: 'bubble error', role: 'alert', text: error }));
  const box = $('chat');
  box.replaceChildren(...items);
  box.scrollTop = box.scrollHeight;
}

async function ask(ev) {
  ev?.preventDefault();
  if (ui.aiBusy) return;
  const field = $('question');
  const q = field.value.trim();
  if (!q) return;
  if (!prefs.apiUrl) {
    toast('Сначала укажи адрес прокси в настройках');
    go('settings');
    setTimeout(() => $('apiUrl').focus(), 50);
    return;
  }
  if (!navigator.onLine) {
    renderChat({ error: 'Нет подключения к интернету. Вопрос сохранён в поле ввода.' });
    return;
  }
  ui.aiBusy = true;
  $('send').disabled = true;
  field.value = '';
  chat.push({ role: 'user', content: q.slice(0, core.AI_MAX_QUESTION) });
  renderChat({ pending: true });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45_000);
  let error = '';
  try {
    const { json } = core.buildAiPayload(chat, core.buildAiContext(state, today()));
    const res = await fetch(prefs.apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: json,
      signal: controller.signal,
    });
    let data = null;
    try {
      data = await res.json();
    } catch {
      /* не JSON */
    }
    if (!res.ok) throw new Error(core.aiErrorMessage(res.status, data?.message));
    const answer = typeof data?.reply === 'string' && data.reply.trim() ? data.reply : '';
    if (!answer) throw new Error('Помощник прислал пустой ответ. Попробуй переформулировать вопрос.');
    chat.push({ role: 'assistant', content: answer });
    store.saveChat(chat);
  } catch (e) {
    chat.pop();
    if (!field.value) field.value = q;
    error =
      e.name === 'AbortError'
        ? 'Сервер долго не отвечает. Попробуй ещё раз.'
        : e instanceof TypeError
          ? 'Не удалось связаться с прокси. Проверь интернет и адрес в настройках.'
          : e.message;
  } finally {
    clearTimeout(timer);
    ui.aiBusy = false;
    $('send').disabled = false;
    renderChat({ error });
  }
}

async function clearChat() {
  if (!chat.length) return;
  if (
    !(await confirmDialog({
      title: 'Очистить чат?',
      text: 'История переписки будет удалена.',
      ok: 'Очистить',
    }))
  )
    return;
  chat = [];
  store.saveChat(chat);
  renderChat();
}

// ---------- Service Worker и установка ----------

function setupServiceWorker() {
  if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
  let updateRequested = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (updateRequested) location.reload();
  });
  const offerUpdate = (worker) => {
    $('updateBanner').hidden = false;
    $('updateBtn').onclick = () => {
      updateRequested = true;
      worker.postMessage({ type: 'SKIP_WAITING' });
    };
  };
  navigator.serviceWorker
    .register(serviceWorkerUrl())
    .then((reg) => {
      if (reg.waiting && navigator.serviceWorker.controller) offerUpdate(reg.waiting);
      reg.addEventListener('updatefound', () => {
        const w = reg.installing;
        w?.addEventListener('statechange', () => {
          if (w.state === 'installed' && navigator.serviceWorker.controller) offerUpdate(w);
        });
      });
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') reg.update().catch(() => {});
      });
    })
    .catch(() => {});
}

function setupInstall() {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    ui.installPrompt = e;
    $('install').hidden = false;
    if (ui.page === 'settings') renderSettings();
  });
  window.addEventListener('appinstalled', () => {
    ui.installPrompt = null;
    $('install').hidden = true;
    toast('Приложение установлено');
  });
  $('install').addEventListener('click', async () => {
    if (!ui.installPrompt) return;
    ui.installPrompt.prompt();
    await ui.installPrompt.userChoice;
    ui.installPrompt = null;
    $('install').hidden = true;
  });
}

// ---------- Синхронизация вкладок ----------

function setupSync() {
  window.addEventListener('storage', (e) => {
    if (e.storageArea !== storage) return;
    if (e.key === core.STORAGE_KEY || e.key === null) {
      state = store.load().state;
      if (ui.editingId && !state.entries[ui.editingId]) {
        resetForm();
        if (ui.page === 'add') toast('Запись удалили в другой вкладке');
      }
      renderAll();
      if (e.key) toast('Данные изменились в другой вкладке');
    }
    if (e.key === core.PREFS_KEY || e.key === null) {
      prefs = store.loadPrefs();
      applyTheme();
      renderAll();
    }
    if (e.key === core.CHAT_KEY || e.key === null) {
      chat = store.loadChat();
      if (ui.page === 'ai' && !ui.aiBusy) renderChat();
    }
  });
}

// ---------- Инициализация ----------

function reportLoadProblems() {
  const parts = [];
  if (loaded.corrupt) parts.push('Сохранённые данные повреждены и не читаются.');
  if (loaded.rejected.length) parts.push(`Не удалось прочитать записей: ${loaded.rejected.length}.`);
  if (loaded.fixes.length) parts.push(...loaded.fixes);
  if (!parts.length) return;
  if (loaded.rawKey) parts.push('Исходные данные сохранены — их можно скачать.');
  ui.dataWarning = { text: parts.join(' '), rawKey: loaded.rawKey };
}

function bind() {
  $('entryForm').addEventListener('submit', submitEntry);
  $('cancelEntry').addEventListener('click', () => {
    resetForm();
    go(ui.prevPage && ui.prevPage !== 'add' ? ui.prevPage : 'home', { replace: true });
  });
  $('kinds').addEventListener('click', (e) => {
    const b = e.target.closest('[data-kind]');
    if (b) setKind(b.dataset.kind);
  });
  for (const b of document.querySelectorAll('[data-amount]')) {
    b.addEventListener('click', () => {
      const cur = core.parseAmount($('amount').value);
      $('amount').value = String(
        core.roundMoney((Number.isFinite(cur) ? cur : 0) + Number(b.dataset.amount)),
      ).replace('.', ',');
      $('amount').removeAttribute('aria-invalid');
    });
  }
  for (const b of document.querySelectorAll('[data-add]'))
    b.addEventListener('click', () => openAdd(b.dataset.add));
  const refilter = () => {
    ui.historyLimit = HISTORY_PAGE;
    renderHistory();
  };
  $('historySearch').addEventListener('input', refilter);
  $('historyKind').addEventListener('change', refilter);
  $('historyPeriod').addEventListener('change', refilter);
  $('csvExport').addEventListener('click', exportCsv);
  $('settingsForm').addEventListener('submit', submitSettings);
  $('apiForm').addEventListener('submit', submitApi);
  $('theme').addEventListener('change', (e) => {
    prefs.theme = e.target.value;
    savePrefs();
    applyTheme();
  });
  $('themeBtn').addEventListener('click', () => {
    const order = ['auto', 'light', 'dark'];
    prefs.theme = order[(order.indexOf(prefs.theme) + 1) % order.length];
    savePrefs();
    applyTheme();
    toast(`Тема: ${THEME_NAMES[prefs.theme]}`);
  });
  matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => {
    if (prefs.theme === 'auto') applyTheme();
  });
  $('presetForm').addEventListener('submit', submitPreset);
  $('lockToggle').addEventListener('change', (e) => {
    prefs.lock = e.target.checked;
    prefs.lockSince = prefs.lock ? Date.now() : 0;
    savePrefs();
    toast(prefs.lock ? 'Замок включён' : 'Замок выключен');
  });
  $('export').addEventListener('click', exportBackup);
  $('import').addEventListener('click', () => $('file').click());
  $('file').addEventListener('change', (e) => {
    importBackup(e.target.files[0]);
    e.target.value = '';
  });
  $('chatForm').addEventListener('submit', ask);
  $('question').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) ask(e);
  });
  $('clearChat').addEventListener('click', clearChat);
  $('backupBannerSave').addEventListener('click', exportBackup);
  $('backupBannerLater').addEventListener('click', () => {
    prefs.snoozeUntil = Date.now() + 3 * 86_400_000;
    savePrefs();
    renderBanners();
  });
  $('dataBannerDownload').addEventListener(
    'click',
    () => ui.dataWarning?.rawKey && downloadRaw(ui.dataWarning.rawKey),
  );
  $('dataBannerClose').addEventListener('click', () => {
    ui.dataWarning = null;
    renderBanners();
  });
  // Ссылки на разделы переключают страницу сразу, без ожидания hashchange.
  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[href^="#"]');
    const page = a?.getAttribute('href').slice(1);
    if (!a || !PAGES.includes(page) || e.defaultPrevented || e.ctrlKey || e.metaKey) return;
    e.preventDefault();
    go(page);
  });
  const syncFromUrl = () => {
    const page = pageFromHash();
    if (page !== ui.page) showPage(page);
  };
  window.addEventListener('popstate', syncFromUrl);
  window.addEventListener('hashchange', syncFromUrl);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') renderAll();
  });
}

/**
 * Защита от кликджекинга: GitHub Pages не позволяет задать X-Frame-Options, а meta-CSP не поддерживает
 * frame-ancestors. Во фрейме чужого сайта интерфейс не запускаем — только ссылка на открытие напрямую.
 */
function blockIfFramed() {
  let framed;
  try {
    framed = window.top !== window.self;
  } catch {
    framed = true;
  }
  if (!framed) return false;
  document.body.replaceChildren(
    h(
      'div',
      { id: 'framed', className: 'framed' },
      h('p', {
        text: 'KopilkaMoto нельзя использовать внутри другого сайта. Чтобы вести копилку, открой её напрямую.',
      }),
      h('a', {
        className: 'btn primary',
        href: location.href,
        target: '_top',
        rel: 'noopener',
        text: 'Открыть KopilkaMoto',
      }),
    ),
  );
  return true;
}

// Обновляем сводку при наступлении нового локального дня, даже если приложение
// остаётся открытым. При возвращении из сна/фонового режима renderAll вызывается
// также обработчиком visibilitychange ниже.
let dayRefreshTimer = 0;

function scheduleDayRefresh() {
  clearTimeout(dayRefreshTimer);
  const now = new Date();
  const nextMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  // Небольшой запас, чтобы локальная дата уже гарантированно сменилась.
  const delay = Math.max(100, nextMidnight.getTime() - now.getTime() + 100);
  dayRefreshTimer = window.setTimeout(() => {
    renderAll();
    scheduleDayRefresh();
  }, delay);
}

function init() {
  if (blockIfFramed()) return;
  reportLoadProblems();
  setupOnboarding();
  bind();
  setKind('delivery');
  $('date').value = today();
  ui.autoDate = today();
  applyTheme();
  setupSync();
  setupInstall();
  showPage(pageFromHash(), { focus: false });
  setupServiceWorker();
  scheduleDayRefresh();
  document.documentElement.dataset.ready = 'true';
}

init();
