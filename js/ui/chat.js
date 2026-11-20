// AI-помощник: переписка, запрос к прокси, очистка.
import * as core from '../core.js';
import { $, h } from '../dom.js';
import { insightsForAi } from '../insights.js';
import { planForAi } from '../plan.js';
import { renderMarkdown } from '../markdown.js';
import { app, store, today, ui } from './context.js';
import { confirmDialog, toast } from './notify.js';
import { go } from './router.js';

function bubble(role, text, extraClass = '') {
  const el = h('div', { className: `bubble ${role} ${extraClass}`.trim() });
  if (role === 'ai') el.append(renderMarkdown(text));
  else el.textContent = text;
  return el;
}

export function renderChat({ pending = false, error = '' } = {}) {
  const items = app.chat.length
    ? app.chat.map((m) => bubble(m.role === 'user' ? 'user' : 'ai', m.content))
    : [
        bubble(
          'ai',
          app.prefs.apiUrl
            ? 'Спроси про накопления: сколько смен осталось, на чём можно сэкономить, успеваешь ли к сроку.'
            : 'Чтобы задавать вопросы, укажи адрес прокси в **Настройки → Помощник**.',
        ),
      ];
  if (pending) {
    items.push(
      h(
        'div',
        { className: 'bubble typing', 'aria-busy': 'true' },
        h('span', { className: 'visually-hidden', text: 'Помощник печатает' }),
        h('span', { className: 'dot', 'aria-hidden': 'true' }),
        h('span', { className: 'dot', 'aria-hidden': 'true' }),
        h('span', { className: 'dot', 'aria-hidden': 'true' }),
      ),
    );
  }
  if (error) items.push(h('div', { className: 'bubble error', role: 'alert', text: error }));
  const box = $('chat');
  box.replaceChildren(...items);
  box.scrollTop = box.scrollHeight;
}

export async function ask(ev) {
  ev?.preventDefault();
  if (ui.aiBusy) return;
  const field = $('question');
  const q = field.value.trim();
  if (!q) return;
  if (!app.prefs.apiUrl) {
    toast('Сначала укажи адрес прокси в настройках');
    go('settings');
    setTimeout(() => $('apiUrl').focus(), 50);
    return;
  }
  if (!navigator.onLine) {
    renderChat({ error: 'Нет подключения к интернету. Вопрос сохранён в поле ввода.' });
    return;
  }
  ui.aiBusy = true;
  $('send').disabled = true;
  field.value = '';
  app.chat.push({ role: 'user', content: q.slice(0, core.AI_MAX_QUESTION) });
  renderChat({ pending: true });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45_000);
  let error = '';
  try {
    const { json } = core.buildAiPayload(app.chat, {
      ...core.buildAiContext(app.state, today()),
      plan: planForAi(app.state, today()),
      insights: insightsForAi(app.state.entries, today()),
    });
    const res = await fetch(app.prefs.apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: json,
      signal: controller.signal,
    });
    let data = null;
    try {
      data = await res.json();
    } catch {
      /* не JSON */
    }
    if (!res.ok) throw new Error(core.aiErrorMessage(res.status, data?.message));
    const answer = typeof data?.reply === 'string' && data.reply.trim() ? data.reply : '';
    if (!answer) throw new Error('Помощник прислал пустой ответ. Попробуй переформулировать вопрос.');
    app.chat.push({ role: 'assistant', content: answer });
    store.saveChat(app.chat);
  } catch (e) {
    app.chat.pop();
    if (!field.value) field.value = q;
    error =
      e.name === 'AbortError'
        ? 'Сервер долго не отвечает. Попробуй ещё раз.'
        : e instanceof TypeError
          ? 'Не удалось связаться с прокси. Проверь интернет и адрес в настройках.'
          : e.message;
  } finally {
    clearTimeout(timer);
    ui.aiBusy = false;
    $('send').disabled = false;
    renderChat({ error });
  }
}

export async function clearChat() {
  if (!app.chat.length) return;
  if (
    !(await confirmDialog({
      title: 'Очистить чат?',
      text: 'История переписки будет удалена.',
      ok: 'Очистить',
    }))
  )
    return;
  app.chat = [];
  store.saveChat(app.chat);
  renderChat();
}
