import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, access } from 'node:fs/promises';

test('service worker кеширует все файлы приложения и только существующие', async () => {
  const sw = await readFile('service-worker.js', 'utf8');
  const shell = [...sw.match(/const SHELL = \[([\s\S]*?)\];/)[1].matchAll(/'\.\/([^']*)'/g)].map((m) => m[1]);
  for (const f of shell.filter(Boolean)) await access(f);
  for (const f of await readdir('js')) assert.ok(shell.includes('js/' + f), `js/${f} нет в SHELL`);
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
