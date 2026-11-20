// Привязка обработчиков событий к элементам страницы.
import * as core from '../core.js';
import { $ } from '../dom.js';
import { exportBackup, exportCsv, importBackup } from './backup.js';
import { renderBanners } from './banners.js';
import { ask, clearChat } from './chat.js';
import { HISTORY_PAGE, app, savePrefs, ui } from './context.js';
import { openAdd, resetForm, setKind, submitEntry } from './form.js';
import { renderHistory } from './history.js';
import { toast } from './notify.js';
import { bindPlan } from './plan.js';
import { bindReport } from './report.js';
import { submitPreset } from './presets.js';
import { PAGES, go, pageFromHash, renderAll, showPage } from './router.js';
import { downloadRaw, submitApi, submitSettings } from './settings.js';
import { THEME_NAMES, applyTheme } from './theme.js';

export function bind() {
  bindPlan();
  bindReport();
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
    app.prefs.theme = e.target.value;
    savePrefs();
    applyTheme();
  });
  $('themeBtn').addEventListener('click', () => {
    const order = ['auto', 'light', 'dark'];
    app.prefs.theme = order[(order.indexOf(app.prefs.theme) + 1) % order.length];
    savePrefs();
    applyTheme();
    toast(`Тема: ${THEME_NAMES[app.prefs.theme]}`);
  });
  matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => {
    if (app.prefs.theme === 'auto') applyTheme();
  });
  $('presetForm').addEventListener('submit', submitPreset);
  $('lockToggle').addEventListener('change', (e) => {
    app.prefs.lock = e.target.checked;
    app.prefs.lockSince = app.prefs.lock ? Date.now() : 0;
    savePrefs();
    toast(app.prefs.lock ? 'Замок включён' : 'Замок выключен');
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
    app.prefs.snoozeUntil = Date.now() + 3 * 86_400_000;
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
