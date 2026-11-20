// Экран «Настройки»: цель и сроки, адрес прокси, хранилище, копии исходных данных.
import * as core from '../core.js';
import { $, h } from '../dom.js';
import { APP_VERSION } from '../version.js';
import { formatAgo } from './banners.js';
import { app, cloneState, commit, savePrefs, storageOk, store, ui } from './context.js';
import { confirmDialog, download, toast } from './notify.js';
import { renderPresets } from './presets.js';

export async function renderStorageInfo() {
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

export function renderSettings() {
  const s = app.state.settings;
  $('goalInput').value = core.formatNumber(s.goal);
  $('startInput').value = core.formatNumber(s.start);
  $('startDateInput').value = s.startDate;
  $('deadlineInput').value = s.deadline;
  $('apiUrl').value = app.prefs.apiUrl;
  $('lockToggle').checked = app.prefs.lock;
  renderPresets();
  $('backupInfo').textContent = app.prefs.lastBackupAt
    ? `Последняя копия: ${formatAgo(app.prefs.lastBackupAt)}.`
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

export function downloadRaw(key) {
  const raw = store.readRaw(key);
  if (raw) download(`kopilkamoto-raw-${key.slice(core.RAW_PREFIX.length)}.json`, raw, 'application/json');
}

export function submitSettings(ev) {
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

export function submitApi(ev) {
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
    app.prefs.apiUrl = url.href;
  } else app.prefs.apiUrl = '';
  savePrefs();
  $('apiUrl').value = app.prefs.apiUrl;
  toast(app.prefs.apiUrl ? 'Адрес сохранён' : 'AI-помощник отключён');
}
