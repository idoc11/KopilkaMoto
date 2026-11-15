// Работа с localStorage. Хранилище передаётся параметром, чтобы модуль можно было тестировать в Node.

import {
  CHAT_KEY,
  PREFS_KEY,
  RAW_PREFIX,
  STORAGE_KEY,
  migrateState,
  serializeState,
  todayIso,
} from './core.js';

const THEMES = ['auto', 'light', 'dark'];

export function normalizePrefs(p) {
  const src = p && typeof p === 'object' && !Array.isArray(p) ? p : {};
  let apiUrl = '';
  try {
    const u = new URL(String(src.apiUrl || ''));
    if (u.protocol === 'https:') apiUrl = u.href;
  } catch {
    /* пустой или некорректный URL */
  }
  const num = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : 0);
  return {
    theme: THEMES.includes(src.theme) ? src.theme : 'auto',
    apiUrl,
    lastBackupAt: num(src.lastBackupAt),
    changesSinceBackup: num(src.changesSinceBackup),
    snoozeUntil: num(src.snoozeUntil),
  };
}

export function createStore(storage, { now = () => new Date() } = {}) {
  function read(key) {
    try {
      return storage.getItem(key);
    } catch {
      return null;
    }
  }

  function write(key, value) {
    try {
      storage.setItem(key, value);
      return true;
    } catch {
      return false;
    }
  }

  function rawKeys() {
    const keys = [];
    try {
      for (let i = 0; i < storage.length; i++) {
        const k = storage.key(i);
        if (k && k.startsWith(RAW_PREFIX)) keys.push(k);
      }
    } catch {
      /* хранилище недоступно */
    }
    return keys.sort();
  }

  /** Сохраняет исходную строку данных отдельно, если такой копии ещё нет. */
  function preserveRaw(raw) {
    const existing = rawKeys().find((k) => read(k) === raw);
    if (existing) return existing;
    const key = RAW_PREFIX + now().toISOString().replace(/[:.]/g, '-');
    return write(key, raw) ? key : null;
  }

  function save(state) {
    return write(STORAGE_KEY, serializeState(state));
  }

  function load() {
    const today = todayIso(now());
    const raw = read(STORAGE_KEY);
    let parsed = null;
    let corrupt = false;
    if (raw) {
      try {
        parsed = JSON.parse(raw);
      } catch {
        corrupt = true;
      }
    }
    const result = migrateState(parsed, today);
    result.corrupt = corrupt;
    result.rawKey = null;
    if (raw && (corrupt || result.rejected.length)) {
      // Исходные данные не теряем: сначала копия, и только потом перезапись очищенным состоянием.
      result.rawKey = preserveRaw(raw);
      if (result.rawKey && !corrupt) save(result.state);
      if (corrupt) result.isNew = false;
    }
    return result;
  }

  return {
    load,
    save,
    preserveRaw,
    rawKeys,
    readRaw: read,
    removeRaw(key) {
      if (!key.startsWith(RAW_PREFIX)) return;
      try {
        storage.removeItem(key);
      } catch {
        /* ignore */
      }
    },
    loadPrefs() {
      try {
        return normalizePrefs(JSON.parse(read(PREFS_KEY) || '{}'));
      } catch {
        return normalizePrefs(null);
      }
    },
    savePrefs(prefs) {
      return write(PREFS_KEY, JSON.stringify(normalizePrefs(prefs)));
    },
    loadChat() {
      try {
        const list = JSON.parse(read(CHAT_KEY) || '[]');
        return Array.isArray(list)
          ? list
              .filter((m) => m && ['user', 'assistant'].includes(m.role) && typeof m.content === 'string')
              .slice(-40)
          : [];
      } catch {
        return [];
      }
    },
    saveChat(messages) {
      return write(CHAT_KEY, JSON.stringify(messages.slice(-40)));
    },
  };
}
