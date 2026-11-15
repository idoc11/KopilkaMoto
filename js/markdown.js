// Минимальный безопасный Markdown для ответов AI: абзацы, заголовки, списки, **жирный**, *курсив*, `код`.
// Разбор — чистая функция; отрисовка создаёт DOM только через createElement/textContent (без innerHTML).

/** Разбивает строку на фрагменты [{type:'text'|'strong'|'em'|'code', text}]. */
export function parseInline(text) {
  const out = [];
  const re = /\*\*(.+?)\*\*|__(.+?)__|`([^`]+)`|\*([^*\s][^*]*?)\*/g;
  let last = 0;
  let m;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push({ type: 'text', text: text.slice(last, m.index) });
    if (m[1] !== undefined || m[2] !== undefined) out.push({ type: 'strong', text: m[1] ?? m[2] });
    else if (m[3] !== undefined) out.push({ type: 'code', text: m[3] });
    else out.push({ type: 'em', text: m[4] });
    last = re.lastIndex;
  }
  if (last < text.length) out.push({ type: 'text', text: text.slice(last) });
  return out;
}

/** Разбирает текст на блоки: {type:'p'|'h', text} и {type:'ul'|'ol', items:[text]}. */
export function parseMarkdown(src) {
  const blocks = [];
  let para = [];
  let list = null;
  const flushPara = () => {
    if (para.length) blocks.push({ type: 'p', text: para.join('\n') });
    para = [];
  };
  const flushList = () => {
    if (list) blocks.push(list);
    list = null;
  };
  for (const raw of String(src ?? '')
    .replace(/\r\n?/g, '\n')
    .split('\n')) {
    const line = raw.trimEnd();
    let m;
    if (!line.trim()) {
      flushPara();
      flushList();
    } else if ((m = /^\s{0,3}#{1,6}\s+(.*)$/.exec(line))) {
      flushPara();
      flushList();
      blocks.push({ type: 'h', text: m[1].replace(/\s*#+$/, '') });
    } else if ((m = /^\s*[-*•]\s+(.*)$/.exec(line))) {
      flushPara();
      if (!list || list.type !== 'ul') {
        flushList();
        list = { type: 'ul', items: [] };
      }
      list.items.push(m[1]);
    } else if ((m = /^\s*\d+[.)]\s+(.*)$/.exec(line))) {
      flushPara();
      if (!list || list.type !== 'ol') {
        flushList();
        list = { type: 'ol', items: [] };
      }
      list.items.push(m[1]);
    } else if (/^\s*(---+|\*\*\*+)\s*$/.test(line)) {
      flushPara();
      flushList();
    } else {
      flushList();
      para.push(line.trim());
    }
  }
  flushPara();
  flushList();
  return blocks;
}

function appendInline(doc, parent, text) {
  for (const part of parseInline(text)) {
    if (part.type === 'text') parent.append(doc.createTextNode(part.text));
    else {
      const el = doc.createElement(part.type);
      el.textContent = part.text;
      parent.append(el);
    }
  }
}

export function renderMarkdown(src, doc = document) {
  const frag = doc.createDocumentFragment();
  for (const b of parseMarkdown(src)) {
    if (b.type === 'ul' || b.type === 'ol') {
      const list = doc.createElement(b.type);
      for (const item of b.items) {
        const li = doc.createElement('li');
        appendInline(doc, li, item);
        list.append(li);
      }
      frag.append(list);
    } else {
      const el = doc.createElement(b.type === 'h' ? 'h3' : 'p');
      const lines = b.text.split('\n');
      lines.forEach((line, i) => {
        if (i) el.append(doc.createElement('br'));
        appendInline(doc, el, line);
      });
      frag.append(el);
    }
  }
  return frag;
}
