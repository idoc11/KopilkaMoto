// Общее состояние интерфейса: данные, настройки, чат, хранилище и сохранение.
import * as core from '../core.js';
import { createStore } from '../storage.js';
import { toast } from './notify.js';

/** Событие «браузер ответил, сохраняются ли данные надолго»: экран настроек обновляет подсказку. */
export const STORAGE_CHECKED = 'kopilkamoto:storage-checked';

/** Сколько строк истории рисовать за раз: тысячи DOM-узлов тормозят поиск на телефоне. */
export const HISTORY_PAGE = 100;

export const today = () => core.todayIso();

function memoryStorage() {
  const m = new Map();
  return {
    get length() {
      return m.size;
    },
    key: (i) => [...m.keys()][i] ?? null,
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
  };
}

function detectStorage() {
  try {
    const s = window.localStorage;
    const probe = '__kopilkamoto_probe__';
    s.setItem(probe, '1');
    s.removeItem(probe);
    return { storage: s, ok: true };
  } catch {
    return { storage: memoryStorage(), ok: false };
  }
}

export const { storage, ok: storageOk } = detectStorage();

export const store = createStore(storage);

export const loaded = store.load();

/** Изменяемое состояние. Хранится в одном объекте, чтобы любой модуль видел актуальные значения. */
export const app = { state: loaded.state, prefs: store.loadPrefs(), chat: store.loadChat() };

export const ui = {
  page: 'home',
  prevPage: 'home',
  showOnboarding: false,
  kind: 'delivery',
  editingId: null,
  selectedDay: null,
  aiBusy: false,
  installPrompt: null,
  persistAsked: false,
  dataWarning: null,
  shownTotal: 0,
  shownPct: 0,
  knownMarks: null,
  flashId: null,
  chartAnimate: true,
  historyLimit: HISTORY_PAGE,
  planShifts: null,
};

export function cloneState(s = app.state) {
  return { ...s, entries: Object.assign(Object.create(null), s.entries), settings: { ...s.settings } };
}

/** Сохраняет новое состояние. При ошибке записи текущее состояние не меняется. */
export function commit(next, { change = true } = {}) {
  if (!store.save(next)) {
    toast('Не удалось сохранить данные. Освободи память браузера и скачай резервную копию.');
    return false;
  }
  app.state = next;
  if (change) {
    app.prefs.changesSinceBackup += 1;
    store.savePrefs(app.prefs);
  }
  requestPersistentStorage();
  return true;
}

export function savePrefs() {
  if (!store.savePrefs(app.prefs)) toast('Не удалось сохранить настройки');
}

async function requestPersistentStorage() {
  if (ui.persistAsked || !navigator.storage?.persist) return;
  ui.persistAsked = true;
  try {
    if (!(await navigator.storage.persisted())) await navigator.storage.persist();
  } catch {
    /* браузер не поддерживает */
  }
  document.dispatchEvent(new Event(STORAGE_CHECKED));
}
