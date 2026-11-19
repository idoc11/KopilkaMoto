// Покрытие UI-кода E2E-тестами: запускает tests/e2e с сбором V8-покрытия в Chromium,
// считает долю исполненного кода по каждому файлу js/**/*.js и проверяет порог.
//
//   npm run test:e2e:coverage            — порог 80% (байты исполненного кода без пробелов)
//   E2E_COVERAGE_MIN=90 npm run test:e2e:coverage
//
// Покрытие считается по объединению всех страниц всех тестов: байт покрыт, если он исполнился хотя бы раз.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const MIN = Number(process.env.E2E_COVERAGE_MIN || 80);
const dir = mkdtempSync(join(tmpdir(), 'kopilkamoto-e2e-cov-'));
const run = spawnSync(process.execPath, ['--test', '--test-concurrency=1', 'tests/e2e/*.test.mjs'], {
  stdio: 'inherit',
  env: { ...process.env, E2E_COVERAGE_DIR: dir },
});
if (run.status !== 0) {
  rmSync(dir, { recursive: true, force: true });
  process.exit(run.status ?? 1);
}

/** Для каждого файла — маска исполненных байтов (объединение по всем дампам). */
const hits = new Map();
const fnCalls = new Map();
for (const f of readdirSync(dir)) {
  for (const script of JSON.parse(readFileSync(join(dir, f), 'utf8'))) {
    const file = new URL(script.url).pathname.replace(/^\//, '');
    let src;
    try {
      src = readFileSync(file, 'utf8');
    } catch {
      continue; // файл из _site или удалённый — пропускаем
    }
    // Вложенные диапазоны V8: внутренний переопределяет внешний, поэтому применяем от широких к узким.
    const mark = new Int8Array(src.length);
    const ranges = script.functions
      .flatMap((fn) => fn.ranges)
      .sort((a, b) => b.endOffset - b.startOffset - (a.endOffset - a.startOffset));
    for (const r of ranges) mark.fill(r.count > 0 ? 1 : 0, r.startOffset, Math.min(r.endOffset, src.length));
    const acc = hits.get(file) || new Uint8Array(src.length);
    for (let i = 0; i < src.length; i++) if (mark[i]) acc[i] = 1;
    hits.set(file, acc);
    const calls = fnCalls.get(file) || new Map();
    for (const fn of script.functions) {
      if (!fn.functionName) continue;
      const key = `${fn.functionName}@${fn.ranges[0].startOffset}`;
      calls.set(key, (calls.get(key) || 0) + fn.ranges[0].count);
    }
    fnCalls.set(file, calls);
  }
}
rmSync(dir, { recursive: true, force: true });

const rows = [];
let failed = false;
for (const [file, acc] of [...hits].sort(([a], [b]) => a.localeCompare(b))) {
  const src = readFileSync(file, 'utf8');
  let total = 0;
  let hit = 0;
  for (let i = 0; i < src.length; i++) {
    if (/\s/.test(src[i])) continue;
    total++;
    if (acc[i]) hit++;
  }
  const pct = (100 * hit) / total;
  // Непокрытые строки: показываем для файлов ниже порога и при E2E_COVERAGE_DETAIL=1.
  const missed = [];
  let offset = 0;
  src.split('\n').forEach((line, i) => {
    const bad = [...line].some((ch, k) => !/\s/.test(ch) && !acc[offset + k]);
    if (bad) missed.push(i + 1);
    offset += line.length + 1;
  });
  const ranges = [];
  for (const n of missed) {
    const last = ranges.at(-1);
    if (last && n - last[1] <= 1) last[1] = n;
    else ranges.push([n, n]);
  }
  const calls = fnCalls.get(file);
  const never = [...calls].filter(([, c]) => !c).map(([k]) => k.split('@')[0]);
  const ok = pct >= MIN;
  if (!ok) failed = true;
  rows.push(
    `${ok ? '✓' : '✗'} ${file.padEnd(24)} ${pct.toFixed(1).padStart(5)}%  функции ${calls.size - never.length}/${calls.size}` +
      (never.length ? `  не вызывались: ${never.join(', ')}` : ''),
  );
  if ((!ok || process.env.E2E_COVERAGE_DETAIL) && ranges.length) {
    rows.push(`    непокрытые строки: ${ranges.map(([x, y]) => (x === y ? x : `${x}-${y}`)).join(', ')}`);
  }
}
console.log(`\nПокрытие JS E2E-тестами (порог ${MIN}% по каждому файлу):\n` + rows.join('\n'));
if (!hits.size) {
  console.error('Покрытие не собрано.');
  process.exit(1);
}
process.exit(failed ? 1 : 0);
