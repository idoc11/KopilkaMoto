// Собирает папку _site только из файлов приложения и проставляет BUILD в service worker.
// Запуск: node scripts/build.mjs [build-id]
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { execSync } from 'node:child_process';

const OUT = '_site';
const FILES = [
  'index.html',
  'styles.css',
  'manifest.webmanifest',
  'service-worker.js',
  'js',
  'icons',
  'fonts',
];

let build = process.argv[2] || process.env.GITHUB_SHA || '';
if (!build) {
  try {
    build = execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
  } catch {
    build = String(Date.now());
  }
}
build = build.slice(0, 12).replace(/[^\w-]/g, '');

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT);
for (const f of FILES) await cp(f, `${OUT}/${f}`, { recursive: true });
const swPath = `${OUT}/service-worker.js`;
const sw = await readFile(swPath, 'utf8');
if (!sw.includes("const BUILD = 'dev';")) throw new Error('В service-worker.js не найдена строка BUILD');
await writeFile(swPath, sw.replace("const BUILD = 'dev';", `const BUILD = '${build}';`));
await writeFile(`${OUT}/.nojekyll`, '');
console.log(`Сборка готова: ${OUT}/ (BUILD=${build})`);
