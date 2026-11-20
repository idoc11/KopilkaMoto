// Навигация между экранами по адресу (#home, #add…). Экраны регистрируют свои обработчики через registerPage —
// роутер ничего не знает о конкретных экранах, поэтому нет циклических импортов.
import { $ } from '../dom.js';
import { replay } from '../motion.js';
import { renderBanners } from './banners.js';
import { ui } from './context.js';

export const PAGES = ['home', 'add', 'history', 'ai', 'settings'];

/** Обработчики экранов: enter — при показе, leave — при уходе, refresh — перерисовать при смене данных. */
const pages = new Map();

export function registerPage(name, handlers) {
  pages.set(name, handlers);
}

export function pageFromHash() {
  const p = location.hash.slice(1);
  return PAGES.includes(p) ? p : 'home';
}

export function go(page, { replace = false } = {}) {
  const hash = '#' + page;
  if (location.hash !== hash) history[replace ? 'replaceState' : 'pushState'](null, '', hash);
  showPage(page);
}

export function showPage(page, { focus = true } = {}) {
  if (page !== 'add') pages.get('add')?.leave?.();
  if (page !== ui.page) ui.prevPage = ui.page;
  ui.page = page;
  for (const p of PAGES) $('page-' + p).hidden = p !== page;
  replay($('page-' + page), 'enter', 400);
  for (const a of document.querySelectorAll('[data-nav]')) {
    if (a.dataset.nav === page) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
  pages.get(page)?.enter?.();
  document.title = page === 'home' ? 'KopilkaMoto' : `${$('h-' + page).textContent} — KopilkaMoto`;
  window.scrollTo(0, 0);
  if (focus) $('h-' + page).focus({ preventScroll: true });
}

export function renderAll() {
  if (ui.page !== 'home') renderBanners(); // на главной баннеры рисует сам экран
  pages.get(ui.page)?.refresh?.();
}
