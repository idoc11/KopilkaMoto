// Работа с localStorage. Хранилище передаётся параметром, чтобы модуль можно было тестировать в Node.

import {
  CHAT_KEY,
  MAX_RAW_COPIES,
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
    lock: src.lock === true,
    lockSince: src.lock === true ? num(src.lockSince) || Date.now() : 0,
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

  function remove(key) {
    try {
      storage.removeItem(key);
    } catch {
      /* ignore */
    }
  }

  /**
   * Сохраняет исходную строку данных отдельно, если такой копии ещё нет.
   * Хранит не больше MAX_RAW_COPIES копий: иначе localStorage переполнится и перестанет сохраняться всё остальное.
   * Если места нет — освобождает его за счёт самой старой копии и пробует ещё раз.
   */
  function preserveRaw(raw) {
    const existing = rawKeys().find((k) => read(k) === raw);
    if (existing) return existing;
    const key = RAW_PREFIX + now().toISOString().replace(/[:.]/g, '-');
    let saved = write(key, raw);
    if (!saved) {
      const oldest = rawKeys()[0];
      if (oldest) {
        remove(oldest);
        saved = write(key, raw);
      }
    }
    if (!saved) return null;
    const keys = rawKeys();
    for (const k of keys.slice(0, Math.max(0, keys.length - MAX_RAW_COPIES))) remove(k);
    return key;
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
      if (key.startsWith(RAW_PREFIX)) remove(key);
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
