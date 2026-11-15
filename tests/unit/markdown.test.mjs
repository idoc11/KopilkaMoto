import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMarkdown, parseInline } from '../../js/markdown.js';

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
