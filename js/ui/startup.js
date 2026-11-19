// Проверки при запуске: защита от встраивания в чужой сайт, предупреждения о повреждённых данных.
import { h } from '../dom.js';
import { loaded, ui } from './context.js';

export function reportLoadProblems() {
  const parts = [];
  if (loaded.corrupt) parts.push('Сохранённые данные повреждены и не читаются.');
  if (loaded.rejected.length) parts.push(`Не удалось прочитать записей: ${loaded.rejected.length}.`);
  if (loaded.fixes.length) parts.push(...loaded.fixes);
  if (!parts.length) return;
  if (loaded.rawKey) parts.push('Исходные данные сохранены — их можно скачать.');
  ui.dataWarning = { text: parts.join(' '), rawKey: loaded.rawKey };
}

/**
 * Защита от кликджекинга: GitHub Pages не позволяет задать X-Frame-Options, а meta-CSP не поддерживает
 * frame-ancestors. Во фрейме чужого сайта интерфейс не запускаем — только ссылка на открытие напрямую.
 */
export function blockIfFramed() {
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
