// Синхронизация вкладок и обновление сводки в полночь.
import * as core from '../core.js';
import { renderChat } from './chat.js';
import { app, storage, store, ui } from './context.js';
import { resetForm } from './form.js';
import { toast } from './notify.js';
import { renderAll } from './router.js';
import { applyTheme } from './theme.js';

export function setupSync() {
  window.addEventListener('storage', (e) => {
    if (e.storageArea !== storage) return;
    if (e.key === core.STORAGE_KEY || e.key === null) {
      app.state = store.load().state;
      if (ui.editingId && !app.state.entries[ui.editingId]) {
        resetForm();
        if (ui.page === 'add') toast('Запись удалили в другой вкладке');
      }
      renderAll();
      if (e.key) toast('Данные изменились в другой вкладке');
    }
    if (e.key === core.PREFS_KEY || e.key === null) {
      app.prefs = store.loadPrefs();
      applyTheme();
      renderAll();
    }
    if (e.key === core.CHAT_KEY || e.key === null) {
      app.chat = store.loadChat();
      if (ui.page === 'ai' && !ui.aiBusy) renderChat();
    }
  });
}

// Обновляем сводку при наступлении нового локального дня, даже если приложение
// остаётся открытым. При возвращении из сна/фонового режима renderAll вызывается
// также обработчиком visibilitychange ниже.
let dayRefreshTimer = 0;

export function scheduleDayRefresh() {
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
