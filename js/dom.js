// Создание DOM без HTML-строк. Вместе с Trusted Types в CSP это механическая защита от DOM-XSS.

export const $ = (id) => document.getElementById(id);

const URL_ATTRS = new Set(['href', 'src', 'action', 'formaction', 'xlink:href', 'poster']);
const SAFE_PROTOCOLS = new Set(['http:', 'https:', 'blob:', 'mailto:']);

/** Можно ли подставить URL в атрибут: относительные адреса и безопасные схемы — да; javascript:, data: и т.п. — нет. */
export function isSafeUrl(value) {
  const s = String(value).trim();
  if (/^(#|\.{0,2}\/(?!\/)|\?)/.test(s) || s === '') return true;
  try {
    return SAFE_PROTOCOLS.has(new URL(s, 'https://x.invalid/').protocol);
  } catch {
    return false;
  }
}

/**
 * Небольшой помощник для создания DOM: h('a', { href, className, text, onClick }, ...дети).
 * Обработчики — только функции; опасные URL в href/src молча отбрасываются.
 */
export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'className') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (/^on[A-Z]/.test(k)) {
      if (typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    } else if (URL_ATTRS.has(k.toLowerCase()) && !isSafeUrl(v)) continue;
    else el.setAttribute(k, v === true ? '' : v);
  }
  el.append(...children.flat().filter((c) => c !== null && c !== undefined && c !== false));
  return el;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/** SVG-значок из спрайта в index.html. */
export function icon(name) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'i');
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS(SVG_NS, 'use');
  use.setAttribute('href', '#i-' + name);
  svg.append(use);
  return svg;
}

const SW_URL = './service-worker.js';
let swPolicy;

/**
 * Адрес service worker для navigator.serviceWorker.register. При Trusted Types (CSP require-trusted-types-for)
 * это тоже опасный приёмник: нужна политика. Единственная разрешённая в CSP политика пропускает только этот адрес.
 */
export function serviceWorkerUrl() {
  if (!window.trustedTypes?.createPolicy) return SW_URL;
  swPolicy ??= window.trustedTypes.createPolicy('kopilkamoto-sw', {
    createScriptURL: (url) => {
      if (url !== SW_URL) throw new TypeError(`Недопустимый адрес скрипта: ${url}`);
      return url;
    },
  });
  return swPolicy.createScriptURL(SW_URL);
}
