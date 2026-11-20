// Точка входа: запускает интерфейс. Логика — в js/core.js, экраны и обработчики — в js/ui/*.
import { $ } from './dom.js';
import { bind } from './ui/bindings.js';
import { today, ui } from './ui/context.js';
import { setKind } from './ui/form.js';
import { setupOnboarding } from './ui/onboarding.js';
import { setupInstall, setupServiceWorker } from './ui/pwa.js';
import { registerPages } from './ui/pages.js';
import { pageFromHash, showPage } from './ui/router.js';
import { blockIfFramed, reportLoadProblems } from './ui/startup.js';
import { scheduleDayRefresh, setupSync } from './ui/sync.js';
import { applyTheme } from './ui/theme.js';

function init() {
  if (blockIfFramed()) return;
  registerPages();
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
