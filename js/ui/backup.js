// Резервная копия JSON и экспорт в CSV.
import * as core from '../core.js';
import { app, commit, savePrefs, store, today, ui } from './context.js';
import { resetForm } from './form.js';
import { confirmDialog, download, toast } from './notify.js';
import { renderAll } from './router.js';
import { applyTheme } from './theme.js';

export function exportBackup() {
  download(
    `kopilkamoto-${today()}.json`,
    JSON.stringify(core.buildBackup(app.state, new Date(), app.prefs), null, 2),
    'application/json',
  );
  app.prefs.lastBackupAt = Date.now();
  app.prefs.changesSinceBackup = 0;
  app.prefs.snoozeUntil = 0;
  savePrefs();
  renderAll();
  toast('Копия скачана');
}

export async function importBackup(file) {
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
  const current = Object.keys(app.state.entries).length;
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
  const previous = app.state;
  const previousPrefs = { ...app.prefs };
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
          app.prefs = previousPrefs;
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
  const lockChanged = p.lock !== app.prefs.lock;
  app.prefs = { ...app.prefs, presets: p.presets, lock: p.lock, theme: p.theme };
  if (lockChanged) app.prefs.lockSince = p.lock ? Date.now() : 0;
  savePrefs();
  applyTheme();
}

export function exportCsv() {
  download(`kopilkamoto-history-${today()}.csv`, core.buildCsv(app.state.entries), 'text/csv;charset=utf-8');
  toast('CSV скачан');
}
