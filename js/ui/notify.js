// Уведомления, диалоги подтверждения и скачивание файлов.
import { $, h } from '../dom.js';

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

export function toast(text, { action, onAction, duration = 2800 } = {}) {
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

export function confirmDialog({ title, text, ok = 'Подтвердить', danger = false, delay = 0 }) {
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

export function download(name, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = h('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
