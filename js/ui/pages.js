// Регистрация экранов в роутере: какой экран что делает при показе, уходе и обновлении данных.
import { HISTORY_PAGE, STORAGE_CHECKED, ui } from './context.js';
import { prepareForm, resetForm } from './form.js';
import { renderChat } from './chat.js';
import { renderHistory } from './history.js';
import { renderHome } from './home.js';
import { registerPage } from './router.js';
import { renderSettings, renderStorageInfo } from './settings.js';

export function registerPages() {
  registerPage('home', {
    enter() {
      ui.chartAnimate = true;
      renderHome();
    },
    refresh: renderHome,
  });
  registerPage('history', {
    enter() {
      ui.historyLimit = HISTORY_PAGE;
      renderHistory();
    },
    refresh: renderHistory,
  });
  registerPage('add', {
    enter: prepareForm,
    leave() {
      if (ui.editingId) resetForm();
    },
  });
  registerPage('settings', { enter: renderSettings, refresh: renderSettings });
  registerPage('ai', { enter: renderChat });
  document.addEventListener(STORAGE_CHECKED, () => renderStorageInfo());
}
