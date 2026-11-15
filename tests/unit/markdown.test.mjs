import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMarkdown, parseInline, renderMarkdown } from '../../js/markdown.js';

test('блоки: заголовки, списки, абзацы', () => {
  const b = parseMarkdown(
    '### План\nКопи **5 000 ₽** в день.\n\n- раз\n- два\n1. первый\n2) второй\n---\nИтог',
  );
  assert.deepEqual(
    b.map((x) => x.type),
    ['h', 'p', 'ul', 'ol', 'p'],
  );
  assert.deepEqual(b[2].items, ['раз', 'два']);
  assert.deepEqual(b[3].items, ['первый', 'второй']);
});

test('inline: жирный, курсив, код; HTML остаётся текстом', () => {
  assert.deepEqual(parseInline('a **b** *c* `d` <img src=x onerror=alert(1)>'), [
    { type: 'text', text: 'a ' },
    { type: 'strong', text: 'b' },
    { type: 'text', text: ' ' },
    { type: 'em', text: 'c' },
    { type: 'text', text: ' ' },
    { type: 'code', text: 'd' },
    { type: 'text', text: ' <img src=x onerror=alert(1)>' },
  ]);
  assert.deepEqual(parseInline('2 * 3 = 6'), [{ type: 'text', text: '2 * 3 = 6' }]);
});

// Минимальный DOM: проверяем, что рендер строит узлы только через createElement/createTextNode.
function fakeDocument() {
  const node = (type, tag) => ({
    type,
    tag,
    children: [],
    text: '',
    append(...c) {
      this.children.push(...c);
    },
    set textContent(v) {
      this.children = [{ type: 'text', text: String(v), children: [] }];
    },
  });
  return {
    created: [],
    createDocumentFragment() {
      return node('fragment');
    },
    createElement(tag) {
      this.created.push(tag);
      return node('element', tag);
    },
    createTextNode(t) {
      return { type: 'text', text: t, children: [] };
    },
  };
}
const toHtml = (n) =>
  n.type === 'text'
    ? n.text
    : n.type === 'fragment'
      ? n.children.map(toHtml).join('')
      : `<${n.tag}>${n.children.map(toHtml).join('')}</${n.tag}>`;

test('renderMarkdown: структура, переносы строк, HTML и опасные теги остаются текстом', () => {
  const doc = fakeDocument();
  const out = renderMarkdown(
    '### План\nСтрока 1\nСтрока **2**\n\n- пункт `x`\n1. раз\n\n<script>alert(1)</script><img src=x onerror=alert(1)>',
    doc,
  );
  assert.equal(
    toHtml(out),
    '<h3>План</h3><p>Строка 1<br></br>Строка <strong>2</strong></p><ul><li>пункт <code>x</code></li></ul>' +
      '<ol><li>раз</li></ol><p><script>alert(1)</script><img src=x onerror=alert(1)></p>',
  );
  // Создаются только безопасные теги; script/img попадают в текстовые узлы
  assert.deepEqual([...new Set(doc.created)].sort(), ['br', 'code', 'h3', 'li', 'ol', 'p', 'strong', 'ul']);
});

test('renderMarkdown: пустой и не-строковый ввод', () => {
  assert.equal(toHtml(renderMarkdown('', fakeDocument())), '');
  assert.equal(toHtml(renderMarkdown(null, fakeDocument())), '');
  assert.equal(toHtml(renderMarkdown(42, fakeDocument())), '<p>42</p>');
});
