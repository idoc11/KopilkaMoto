import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, access } from 'node:fs/promises';

/** Все .js-файлы в папке, рекурсивно: ['js/app.js', 'js/ui/home.js', …]. */
async function jsFiles(dir = 'js') {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const path = `${dir}/${e.name}`;
    if (e.isDirectory()) out.push(...(await jsFiles(path)));
    else if (e.name.endsWith('.js')) out.push(path);
  }
  return out.sort();
}

test('service worker кеширует все файлы приложения и только существующие', async () => {
  const sw = await readFile('service-worker.js', 'utf8');
  const shell = [...sw.match(/const SHELL = \[([\s\S]*?)\];/)[1].matchAll(/'\.\/([^']*)'/g)].map((m) => m[1]);
  for (const f of shell.filter(Boolean)) await access(f);
  for (const f of await jsFiles()) assert.ok(shell.includes(f), `${f} нет в SHELL`);
  for (const f of (await readdir('fonts')).filter((x) => x.endsWith('.woff2')))
    assert.ok(shell.includes('fonts/' + f), `fonts/${f} нет в SHELL`);
  for (const f of await readdir('images'))
    assert.ok(shell.includes('images/' + f), `images/${f} нет в SHELL`);
  for (const f of await readdir('icons')) assert.ok(shell.includes('icons/' + f), `icons/${f} нет в SHELL`);
  assert.ok(shell.includes('styles.css') && shell.includes('index.html'));
});

test('index.html без инлайн-скриптов и стилей (совместим с CSP)', async () => {
  const html = await readFile('index.html', 'utf8');
  assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>/);
  assert.doesNotMatch(html, /\sstyle="/);
  assert.doesNotMatch(html, /\son[a-z]+="/);
  const csp = html.match(/http-equiv="Content-Security-Policy"\s+content="([^"]+)"/)?.[1] ?? '';
  const dirs = Object.fromEntries(
    csp
      .split(';')
      .map((d) => d.trim().split(/\s+/))
      .map(([k, ...v]) => [k, v]),
  );
  assert.deepEqual(dirs['script-src'], ["'self'"], 'без unsafe-inline/unsafe-eval');
  assert.deepEqual(dirs['style-src'], ["'self'"]);
  assert.deepEqual(dirs['img-src'], ["'self'"]);
  assert.deepEqual(dirs['object-src'], ["'none'"]);
  assert.deepEqual(dirs['base-uri'], ["'none'"]);
  assert.deepEqual(dirs['require-trusted-types-for'], ["'script'"]);
  assert.deepEqual(
    dirs['trusted-types'],
    ['kopilkamoto-sw'],
    'одна политика — только для адреса service worker',
  );
  assert.doesNotMatch(csp, /unsafe-/);
});

test('версия приложения совпадает в package.json и js/version.js', async () => {
  const pkg = JSON.parse(await readFile('package.json', 'utf8'));
  const app = await readFile('js/version.js', 'utf8');
  assert.match(app, new RegExp(`APP_VERSION = '${pkg.version.replace(/\./g, '\\.')}'`));
});

test('в интерфейсе нет эмодзи и декоративных юникод-значков — только SVG', async () => {
  const files = ['index.html', ...(await jsFiles()).filter((f) => !f.endsWith('motion.js'))];
  for (const f of files) {
    const text = await readFile(f, 'utf8');
    const found = text.match(/[\p{Extended_Pictographic}\u2600-\u27BF\u2B00-\u2BFF\uFF0B]/gu);
    assert.equal(found, null, `${f}: ${found?.join(' ')}`);
  }
});

test('все картинки из src/srcset в index.html существуют и лежат в офлайн-кеше', async () => {
  const html = await readFile('index.html', 'utf8');
  const sw = await readFile('service-worker.js', 'utf8');
  const urls = new Set();
  for (const m of html.matchAll(/\s(?:src|srcset|href)="([^"]+)"/g)) {
    for (const part of m[1].split(',')) {
      const url = part.trim().split(/\s+/)[0];
      if (url.startsWith('./') && /\.(webp|png|svg|woff2|css|js)$/.test(url)) urls.add(url);
    }
  }
  assert.ok(urls.has('./images/dream-bike-480.webp'));
  for (const url of urls) {
    await access(url.slice(2));
    assert.ok(sw.includes(`'${url}'`), `${url} нет в SHELL service worker`);
  }
});

test('все модули js/** перечислены в modulepreload (иначе браузер грузит их цепочкой)', async () => {
  const html = await readFile('index.html', 'utf8');
  const preloaded = new Set([...html.matchAll(/rel="modulepreload" href="\.\/([^"]+)"/g)].map((m) => m[1]));
  for (const f of (await jsFiles()).filter((f) => f !== 'js/app.js'))
    assert.ok(preloaded.has(f), `${f} нет в modulepreload`);
});

test('архитектура интерфейса: app.js ≤ 150 строк, модули js/ui ≤ 400, импорты без циклов', async () => {
  const files = await jsFiles();
  const lines = async (f) => (await readFile(f, 'utf8')).split('\n').length;
  assert.ok((await lines('js/app.js')) <= 150, 'app.js — только запуск');
  for (const f of files.filter((f) => f.startsWith('js/ui/')))
    assert.ok((await lines(f)) <= 400, `${f} длиннее 400 строк`);
  // граф статических импортов
  const graph = new Map();
  for (const f of files) {
    const src = await readFile(f, 'utf8');
    const dir = f.slice(0, f.lastIndexOf('/'));
    const deps = [...src.matchAll(/^import [^;]*? from '(\.[^']+)';/gm)].map((m) => {
      const parts = `${dir}/${m[1]}`.split('/');
      const norm = [];
      for (const p of parts) p === '..' ? norm.pop() : p !== '.' && norm.push(p);
      return norm.join('/');
    });
    graph.set(f, deps);
  }
  const cycles = [];
  const visit = (node, path) => {
    if (path.includes(node)) return cycles.push([...path.slice(path.indexOf(node)), node].join(' → '));
    for (const d of graph.get(node) ?? []) visit(d, [...path, node]);
  };
  for (const f of graph.keys()) visit(f, []);
  assert.deepEqual([...new Set(cycles)], [], 'циклические импорты модулей');
});
