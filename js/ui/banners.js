// Баннеры сверху: обновление, предупреждения о данных, напоминание о копии.
import * as core from '../core.js';
import { $ } from '../dom.js';
import { app, storageOk, ui } from './context.js';

export function formatAgo(ts) {
  const days = Math.floor((Date.now() - ts) / 86_400_000);
  const when = new Date(ts).toLocaleDateString('ru-RU');
  if (days <= 0) return `сегодня (${when})`;
  if (days === 1) return `вчера (${when})`;
  return `${when}, ${days} дн. назад`;
}

export function renderBanners() {
  $('storageBanner').hidden = storageOk;
  const dw = ui.dataWarning;
  $('dataBanner').hidden = !dw;
  if (dw) $('dataBannerText').textContent = dw.text;
  $('dataBannerDownload').hidden = !dw?.rawKey;
  const reason = storageOk ? core.backupReminder(app.prefs, Object.keys(app.state.entries).length) : null;
  $('backupBanner').hidden = !reason;
  if (reason) {
    $('backupBannerText').textContent =
      reason === 'never'
        ? 'Данные хранятся только в этом браузере. Скачай резервную копию, чтобы не потерять накопления.'
        : reason === 'changes'
          ? `С последней копии изменено ${app.prefs.changesSinceBackup} записей. Скачай свежую копию.`
          : `Последняя резервная копия — ${formatAgo(app.prefs.lastBackupAt)}. Пора сделать новую.`;
  }
}
