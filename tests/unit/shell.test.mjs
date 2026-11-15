import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, access } from 'node:fs/promises';

test('service worker кеширует все файлы приложения и только существующие', async () => {
  const sw = await readFile('service-worker.js', 'utf8');
  const shell = [...sw.match(/const SHELL = \[([\s\S]*?)\];/)[1].matchAll(/'\.\/([^']*)'/g)].map((m) => m[1]);
  for (const f of shell.filter(Boolean)) await access(f);
  for (const f of await readdir('js')) assert.ok(shell.includes('js/' + f), `js/${f} нет в SHELL`);
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
  assert.match(html, /Content-Security-Policy/);
});

test('версия приложения совпадает в package.json и app.js', async () => {
  const pkg = JSON.parse(await readFile('package.json', 'utf8'));
  const app = await readFile('js/app.js', 'utf8');
  assert.match(app, new RegExp(`APP_VERSION = '${pkg.version.replace(/\./g, '\\.')}'`));
});

test('в интерфейсе нет эмодзи и декоративных юникод-значков — только SVG', async () => {
  const files = ['index.html', 'js/app.js', 'js/core.js'];
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
