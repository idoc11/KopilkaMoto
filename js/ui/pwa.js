// Service worker (офлайн, обновление по кнопке) и установка на главный экран.
import { $, serviceWorkerUrl } from '../dom.js';
import { ui } from './context.js';
import { toast } from './notify.js';
import { renderSettings } from './settings.js';

export function setupServiceWorker() {
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

export function setupInstall() {
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
