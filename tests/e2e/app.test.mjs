import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { setup, open, entry, configured, stored, addEntry, today, shift } from './helpers.mjs';

let env;
before(async () => (env = await setup()));
after(() => env.close());

test('онбординг: новый пользователь задаёт цель, даты от сегодняшнего дня', async () => {
  const ctx = await env.context();
  const page = await open(ctx, env.base);
  assert.equal(await page.isVisible('#onboarding'), true);
  await page.fill('#obGoal', '450 000');
  await page.fill('#obStart', '10000');
  await page.click('#onboarding button[type=submit]');
  assert.equal(await page.isVisible('#onboarding'), false);
  const s = (await stored(page)).settings;
  assert.deepEqual(s, { goal: 450000, start: 10000, startDate: today(), deadline: s.deadline });
  assert.ok(s.deadline > today());
  assert.match(await page.textContent('#total'), /10\s000/);
  await page.reload();
  assert.equal(await page.isVisible('#onboarding'), false);
  assert.deepEqual(page.errors, []);
  await ctx.close();
});

test('P0-3: «Добавить доход» после расхода открывает форму дохода', async () => {
  const ctx = await env.context();
  const page = await open(ctx, env.base, { storage: configured() });
  await page.click('[data-add=spent]');
  await page.fill('#amount', '100');
  await page.click('#saveEntry');
  await page.click('[data-add=delivery]');
  assert.equal(await page.getAttribute('#kinds [data-kind=delivery]', 'aria-pressed'), 'true');
  await page.click('nav [data-nav=home]');
  await page.click('nav [data-nav=add]');
  assert.equal(await page.getAttribute('#kinds [data-kind=delivery]', 'aria-pressed'), 'true');
  await ctx.close();
});

test('P0-4: поле часов и быстрые суммы видны только там, где нужны', async () => {
  const ctx = await env.context();
  const page = await open(ctx, env.base, { storage: configured(), hash: '#add' });
  assert.equal(await page.isVisible('#hoursWrap'), true);
  await page.click('#kinds [data-kind=other]');
  assert.equal(await page.isVisible('#hoursWrap'), false);
  await page.click('#kinds [data-kind=spent]');
  assert.equal(await page.isVisible('#hoursWrap'), false);
  assert.equal(await page.isVisible('#quickAmounts'), false);
  await ctx.close();
});

test('форма: валидация, запятая в сумме, дата не в будущем, быстрые суммы', async () => {
  const ctx = await env.context();
  const page = await open(ctx, env.base, { storage: configured(), hash: '#add' });
  assert.equal(await page.getAttribute('#date', 'max'), today());
  await page.click('#saveEntry');
  assert.match(await page.textContent('#formError'), /сумму/);
  assert.equal(await page.getAttribute('#amount', 'aria-invalid'), 'true');
  await page.fill('#amount', '1500,50');
  await page.fill('#hours', '30');
  await page.click('#saveEntry');
  assert.match(await page.textContent('#formError'), /Часы/);
  await page.fill('#hours', '7,5');
  await page.fill('#date', shift(2));
  await page.click('#saveEntry');
  assert.match(await page.textContent('#formError'), /будущем/);
  await page.fill('#date', today());
  await page.click('[data-amount="500"]');
  assert.equal(await page.inputValue('#amount'), '2000,5');
  await page.click('#saveEntry');
  const e = Object.values((await stored(page)).entries)[0];
  assert.deepEqual([e.amount, e.hours, e.kind], [2000.5, 7.5, 'delivery']);
  assert.equal(await page.evaluate(() => location.hash), '#home');
  await ctx.close();
});

test('P0-1: операции с будущей датой не пропадают после перезагрузки и сохранения', async () => {
  const ctx = await env.context();
  const page = await open(ctx, env.base, {
    storage: configured({ fut: entry(shift(1), 5000), old: entry('2026-01-01', 1000) }),
  });
  await page.reload();
  await addEntry(page, { kind: 'other', amount: 10 });
  const keys = Object.keys((await stored(page)).entries);
  assert.ok(keys.includes('fut') && keys.includes('old') && keys.length === 3, keys.join());
  assert.equal(await page.isVisible('#dataBanner'), false);
  await ctx.close();
});

test('P0-1: битые записи — предупреждение и скачивание исходных данных', async () => {
  const ctx = await env.context();
  const page = await open(ctx, env.base, {
    storage: configured({ good: entry(today(), 100), bad: { kind: 'gift', amount: 'много' } }),
  });
  assert.equal(await page.isVisible('#dataBanner'), true);
  assert.match(await page.textContent('#dataBannerText'), /1/);
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#dataBannerDownload')]);
  const raw = JSON.parse(await readFile(await dl.path(), 'utf8'));
  assert.equal(raw.entries.bad.kind, 'gift');
  await page.click('#dataBannerClose');
  await page.click('nav [data-nav=settings]');
  assert.equal(await page.isVisible('#rawCopies'), true);
  await ctx.close();
});

test('старые данные (v1, без дат) открываются с прежним планом', async () => {
  const ctx = await env.context();
  const page = await open(ctx, env.base, {
    storage: {
      'moto-tracker-v1': {
        entries: { a: entry('2026-11-01', 1500.5) },
        settings: { goal: 600000, start: 0 },
      },
    },
  });
  assert.equal(await page.isVisible('#onboarding'), false);
  await page.click('nav [data-nav=settings]');
  assert.equal(await page.inputValue('#startDateInput'), '2026-12-01');
  assert.equal(await page.inputValue('#deadlineInput'), '2027-03-31');
  await ctx.close();
});

test('редактирование, удаление с отменой, удаление редактируемой записи', async () => {
  const ctx = await env.context();
  const page = await open(ctx, env.base, {
    storage: configured({ a: entry(today(), 1000, 'delivery', { note: 'Смена' }) }),
  });
  await page.click('#recent [aria-label^="Изменить: Смена"]');
  assert.equal(await page.textContent('#h-add'), 'Правка записи');
  assert.equal(await page.inputValue('#amount'), '1000');
  await page.fill('#amount', '1200');
  await page.click('#saveEntry');
  assert.equal((await stored(page)).entries.a.amount, 1200);

  await page.click('#recent [aria-label^="Удалить: Смена"]');
  assert.equal(Object.keys((await stored(page)).entries).length, 0);
  await page.click('#toastAction');
  assert.equal((await stored(page)).entries.a.amount, 1200);

  await page.click('#recent [aria-label^="Изменить: Смена"]');
  await page.click('nav [data-nav=history]');
  assert.equal(await page.textContent('#h-add'), 'Новая запись'); // уход со страницы сбрасывает редактирование
  await ctx.close();
});

test('P1-9: две вкладки не затирают данные друг друга', async () => {
  const ctx = await env.context();
  const a = await open(ctx, env.base, { storage: configured() });
  const b = await ctx.newPage();
  await b.goto(env.base);
  await b.waitForSelector('html[data-ready]');
  await addEntry(a, { amount: 111, note: 'из A' });
  await b.waitForFunction(() => document.querySelector('#recent').textContent.includes('из A'));
  await addEntry(b, { amount: 222, note: 'из B' });
  const notes = Object.values((await stored(a)).entries)
    .map((e) => e.note)
    .sort();
  assert.deepEqual(notes, ['из A', 'из B']);
  await ctx.close();
});

test('история: поиск, фильтры, CSV', async () => {
  const ctx = await env.context();
  const page = await open(ctx, env.base, {
    storage: configured({
      a: entry(today(), 1000),
      b: entry(today(), 300, 'spent', { note: 'Ремонт' }),
      c: entry(shift(-40), 50, 'other', { note: '=1+1' }),
    }),
    hash: '#history',
  });
  assert.equal(await page.textContent('#count'), '3 из 3');
  await page.fill('#historySearch', 'доход');
  assert.equal(await page.textContent('#count'), '2 из 3');
  await page.fill('#historySearch', '');
  await page.selectOption('#historyPeriod', '30');
  assert.equal(await page.textContent('#count'), '2 из 3');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#csvExport')]);
  const csv = await readFile(await dl.path(), 'utf8');
  assert.match(csv, /"'=1\+1"/);
  assert.match(csv, /"-300"/);
  await ctx.close();
});

test('график: нажатие на столбец показывает сумму, отрицательные дни вниз', async () => {
  const ctx = await env.context();
  const page = await open(ctx, env.base, {
    storage: configured({ a: entry(today(), 1000), b: entry(shift(-1), 400, 'spent') }),
  });
  const bars = page.locator('#chart .bar');
  assert.equal(await bars.count(), 7);
  await bars.nth(5).click();
  assert.match(await page.textContent('#chartDetail'), /−400/);
  const [pos, neg] = await Promise.all([
    bars.nth(6).locator('.bar-fill').boundingBox(),
    bars.nth(5).locator('.bar-fill').boundingBox(),
  ]);
  assert.ok(neg.y >= pos.y + pos.height - 1, 'расход рисуется ниже нулевой линии');
  await ctx.close();
});

test('резервная копия: скачать → восстановить → отменить; копия v1', async () => {
  const ctx = await env.context();
  const page = await open(ctx, env.base, {
    storage: configured({ a: entry(today(), 1000) }),
    hash: '#settings',
  });
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#export')]);
  const backup = JSON.parse(await readFile(await dl.path(), 'utf8'));
  assert.equal(backup.app, 'KopilkaMoto');
  assert.match(await page.textContent('#backupInfo'), /сегодня/);

  const v1 = {
    app: 'moto-savings-tracker',
    version: 1,
    entries: { x: entry('2026-10-01', 7), y: entry('2026-10-02', 8), bad: { kind: '?' } },
    settings: { goal: 5000, start: 0 },
  };
  await page.setInputFiles('#file', {
    name: 'v1.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(v1)),
  });
  await page.waitForSelector('#dialog[open]');
  assert.match(await page.textContent('#dialogText'), /Не удалось прочитать: 1/);
  await page.click('#dialogOk');
  await page.waitForFunction(() =>
    document.querySelector('#toastText').textContent.startsWith('Копия восстановлена'),
  );
  assert.deepEqual(Object.keys((await stored(page)).entries).sort(), ['x', 'y']);
  await page.click('#toastAction');
  assert.deepEqual(Object.keys((await stored(page)).entries), ['a']);
  assert.deepEqual(page.errors, []);

  await page.setInputFiles('#file', {
    name: 'x.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{"app":"other"}'),
  });
  await page.waitForFunction(() =>
    document.querySelector('#toastText').textContent.includes('другого приложения'),
  );
  await ctx.close();
});

test('P0-5: напоминание о резервной копии и «Позже»', async () => {
  const ctx = await env.context();
  const page = await open(ctx, env.base, {
    storage: configured({ a: entry(today(), 1), b: entry(today(), 2), c: entry(today(), 3) }),
  });
  assert.equal(await page.isVisible('#backupBanner'), true);
  await page.click('#backupBannerLater');
  assert.equal(await page.isVisible('#backupBanner'), false);
  await page.reload();
  assert.equal(await page.isVisible('#backupBanner'), false);
  await ctx.close();
});

test('настройки: проверка дат, тема, https-адрес прокси', async () => {
  const ctx = await env.context();
  const page = await open(ctx, env.base, { storage: configured(), hash: '#settings' });
  await page.fill('#deadlineInput', '2020-01-01');
  await page.click('#settingsForm button[type=submit]');
  assert.match(await page.textContent('#settingsError'), /позже/);
  await page.fill('#apiUrl', 'http://insecure.example');
  await page.click('#apiForm button[type=submit]');
  assert.match(await page.textContent('#toastText'), /https/);
  await page.click('#themeBtn');
  assert.equal(await page.getAttribute('html', 'data-theme'), 'light');
  await page.click('#themeBtn');
  assert.equal(await page.getAttribute('html', 'data-theme'), 'dark');
  assert.match(await page.getAttribute('#themeBtn', 'aria-label'), /тёмная/);
  const meta = await page.$$eval('meta[name=theme-color]', (m) => m.map((x) => x.content));
  assert.deepEqual(meta, ['#0d0e11', '#0d0e11']);
  await ctx.close();
});

test('P2-18: тост не перекрывает нижнюю навигацию', async () => {
  const ctx = await env.context();
  const page = await open(ctx, env.base, { storage: configured() });
  await addEntry(page, { amount: 5 });
  const [t, n] = await Promise.all([
    page.locator('#toast').boundingBox(),
    page.locator('.nav').boundingBox(),
  ]);
  assert.ok(t.y + t.height <= n.y, `toast ${t.y + t.height} > nav ${n.y}`);
  await ctx.close();
});

test('кнопка «Назад» Android переключает разделы', async () => {
  const ctx = await env.context();
  const page = await open(ctx, env.base, { storage: configured() });
  await page.click('nav [data-nav=history]');
  await page.click('nav [data-nav=settings]');
  await page.goBack();
  assert.equal(await page.isVisible('#page-history'), true);
  assert.equal(await page.getAttribute('nav [data-nav=history]', 'aria-current'), 'page');
  await ctx.close();
});

test('история с тысячами записей: рисуется порциями по 100, итоги — по всем, поиск сбрасывает порцию', async () => {
  const entries = {};
  for (let i = 0; i < 1500; i++)
    entries['k' + i] = entry(shift(-(i % 300)), 10, 'delivery', { note: 'Смена ' + i, ts: i + 1 });
  const ctx = await env.context();
  const page = await open(ctx, env.base, { storage: configured(entries), hash: '#history' });
  assert.equal(await page.locator('#list .entry').count(), 100);
  assert.equal(await page.textContent('#count'), '1500 из 1500');
  assert.match(await page.textContent('#historySummary'), /15\s000/);
  assert.match(await page.textContent('#historyMore'), /Показать ещё 100 из 1400/);
  await page.click('#historyMore');
  assert.equal(await page.locator('#list .entry').count(), 200);
  await page.fill('#historySearch', 'Смена 14');
  assert.equal(await page.locator('#list .entry').count(), 100);
  assert.equal(await page.textContent('#count'), '111 из 1500');
  await page.fill('#historySearch', 'Смена 1499');
  assert.equal(await page.locator('#historyMore').count(), 0);
  assert.doesNotMatch(await page.textContent('#list'), /false/);
  await ctx.close();
});

test('приложение открыто через полночь: в новой записи сегодняшняя дата, а не вчерашняя', async () => {
  const ctx = await env.context();
  const page = await ctx.newPage();
  await page.clock.install({ time: new Date(2026, 10, 20, 23, 58) });
  await page.addInitScript((d) => {
    if (!localStorage.getItem('moto-tracker-v1')) localStorage.setItem('moto-tracker-v1', JSON.stringify(d));
  }, configured()['moto-tracker-v1']);
  await page.goto(env.base + '#add');
  await page.waitForSelector('html[data-ready]');
  assert.equal(await page.inputValue('#date'), '2026-11-20');
  await page.click('[data-nav=home]');
  await page.clock.runFor(5 * 60_000); // 00:03 следующего дня
  await page.click('[data-nav=add]');
  assert.equal(await page.inputValue('#date'), '2026-11-21');
  assert.equal(await page.getAttribute('#date', 'max'), '2026-11-21');
  // черновик (сумма, тип, комментарий, выбранная вручную дата) переживает переход в другой раздел
  await page.click('#kinds [data-kind=other]');
  await page.fill('#amount', '1234');
  await page.fill('#note', 'Чаевые');
  await page.fill('#date', '2026-11-18');
  await page.click('[data-nav=history]');
  await page.clock.runFor(24 * 3600_000);
  await page.click('[data-nav=add]');
  assert.deepEqual(
    [await page.inputValue('#amount'), await page.inputValue('#note'), await page.inputValue('#date')],
    ['1234', 'Чаевые', '2026-11-18'],
  );
  assert.equal(await page.getAttribute('#kinds [data-kind=other]', 'aria-pressed'), 'true');
  assert.equal(await page.getAttribute('#date', 'max'), '2026-11-22');
  // кнопка «Доход» на главной начинает новую запись
  await page.click('[data-nav=home]');
  await page.click('[data-add=delivery]');
  assert.equal(await page.inputValue('#amount'), '');
  assert.equal(await page.inputValue('#date'), '2026-11-22');
  await ctx.close();
});

test('удаление с клавиатуры: фокус переходит на соседнюю запись, а не теряется', async () => {
  const ctx = await env.context();
  const page = await open(ctx, env.base, {
    storage: configured({
      a: entry(today(), 1, 'delivery', { note: 'A', ts: 3 }),
      b: entry(today(), 2, 'delivery', { note: 'B', ts: 2 }),
      c: entry(today(), 3, 'delivery', { note: 'C', ts: 1 }),
    }),
    hash: '#history',
  });
  await page.focus('#list [aria-label^="Удалить: B"]');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => !document.querySelector('#list [aria-label^="Удалить: B"]'));
  assert.match(
    await page.evaluate(() => document.activeElement.getAttribute('aria-label') || ''),
    /^Удалить: C/,
  );
  // последняя запись — фокус на предыдущую
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => !document.querySelector('#list [aria-label^="Удалить: C"]'));
  assert.match(
    await page.evaluate(() => document.activeElement.getAttribute('aria-label') || ''),
    /^Удалить: A/,
  );
  // список пуст — фокус на заголовок раздела
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => !document.querySelector('#list .entry'));
  assert.equal(await page.evaluate(() => document.activeElement.id), 'h-history');
  await ctx.close();
});

test('встраивание в чужой сайт (кликджекинг): приложение не запускается в рамке', async () => {
  const ctx = await env.context();
  const page = await ctx.newPage();
  // «Чужой» сайт: тот же сервер, но другой источник (localhost ≠ 127.0.0.1)
  env.overrides.set('/evil.html', `<iframe src="${env.base}" width="400" height="600"></iframe>`);
  await page.goto(env.base.replace('127.0.0.1', 'localhost') + 'evil.html');
  const frame = await (await page.waitForSelector('iframe')).contentFrame();
  await frame.waitForLoadState('load');
  await frame.waitForSelector('#framed', { timeout: 5000 });
  assert.equal(await frame.locator('nav [data-nav]').count(), 0, 'интерфейс не должен быть доступен');
  assert.match(await frame.textContent('#framed'), /открой/i);
  assert.equal(await frame.getAttribute('#framed a', 'target'), '_top');
  env.overrides.delete('/evil.html');
  await ctx.close();
});

test('часы в формате 7:30: сохраняются как 7,5, показываются «7 ч 30 мин», правятся как 7:30', async () => {
  const ctx = await env.context();
  const page = await open(ctx, env.base, { storage: configured(), hash: '#add' });
  await page.fill('#amount', '3000');
  await page.fill('#hours', '7:30');
  await page.fill('#note', 'Смена');
  await page.click('#saveEntry');
  const e = Object.values((await stored(page)).entries)[0];
  assert.equal(e.hours, 7.5);
  assert.match(await page.textContent('#recent .entry .sub'), /7 ч 30 мин/);
  assert.match(await page.textContent('#perHour'), /400/); // 3000 ₽ / 7,5 ч
  await page.click('#recent [aria-label^="Изменить: Смена"]');
  assert.equal(await page.inputValue('#hours'), '7:30');
  await page.fill('#hours', '7:75');
  await page.click('#saveEntry');
  assert.match(await page.textContent('#formError'), /7:30/);
  await ctx.close();
});

test('мотоцикл мечты на главной: серый в начале, цветной при наборе суммы, доступен офлайн', async () => {
  const ctx = await env.context();
  const gray = async (page) =>
    Number(
      await page.evaluate(() =>
        getComputedStyle(document.getElementById('dreamBike')).getPropertyValue('--gray'),
      ),
    );
  const empty = await open(ctx, env.base, { storage: configured() });
  // картинка загрузилась; на узком экране — облегчённая версия 480 px
  const img = await empty.evaluate(() => {
    const el = document.getElementById('dreamBike');
    return { w: el.naturalWidth, src: el.currentSrc };
  });
  assert.ok(img.w > 0, JSON.stringify(img));
  assert.match(img.src, /dream-bike-480\.webp$/);
  assert.equal(await gray(empty), 1);
  const half = await open(ctx, env.base, { storage: configured({ a: entry(today(), 300000) }) });
  assert.equal(await gray(half), 0.5);
  assert.match(await half.getAttribute('#dreamBike', 'alt'), /50%/);
  const done = await open(ctx, env.base, { storage: configured({ a: entry(today(), 600000) }) });
  assert.equal(await gray(done), 0);
  assert.equal(await done.evaluate(() => document.querySelector('.dream').classList.contains('done')), true);
  // тени и подсветки у мотоцикла нет
  assert.equal(
    await done.evaluate(() =>
      getComputedStyle(document.getElementById('dreamBike')).filter.includes('drop-shadow'),
    ),
    false,
  );
  await ctx.close();
});

test('частые расходы: запись одним нажатием с отменой, подстановка в форму, настройка списка', async () => {
  const ctx = await env.context();
  const page = await open(ctx, env.base, { storage: configured() });
  const chips = () => page.locator('#quickSpend .preset').allTextContents();
  assert.deepEqual(await chips(), ['Электричка −100 ₽', 'Еда −400 ₽']);

  // одно нажатие — расход записан сегодняшним днём
  await page.click('#quickSpend [aria-label^="Записать расход: Электричка"]');
  const entries = Object.values((await stored(page)).entries);
  assert.deepEqual(
    entries.map((e) => [e.kind, e.amount, e.note, e.date]),
    [['spent', 100, 'Электричка', today()]],
  );
  assert.match(await page.textContent('#toastText'), /Записано: Электричка/);
  await page.click('#toastAction');
  assert.deepEqual((await stored(page)).entries, {});

  // в форме в режиме «Расход» — подстановка суммы и комментария
  await page.click('[data-add=spent]');
  assert.equal(await page.isVisible('#presetChips'), true);
  await page.click('#presetChips [aria-label^="Подставить: Еда"]');
  assert.deepEqual([await page.inputValue('#amount'), await page.inputValue('#note')], ['400', 'Еда']);
  await page.click('#kinds [data-kind=delivery]');
  assert.equal(await page.isVisible('#presetChips'), false);

  // настройка: удалить, добавить, дубль — ошибка; сохраняется после перезагрузки
  await page.click('[data-nav=settings]');
  await page.click('[aria-label="Удалить частый расход Еда"]');
  await page.fill('#presetName', 'Кофе');
  await page.fill('#presetAmount', '250');
  await page.click('#presetForm button[type=submit]');
  await page.fill('#presetName', 'кофе');
  await page.fill('#presetAmount', '1');
  await page.click('#presetForm button[type=submit]');
  assert.match(await page.textContent('#presetError'), /уже есть/);
  await page.reload();
  await page.waitForSelector('html[data-ready]');
  assert.deepEqual(await page.locator('#quickSpend .preset').allTextContents(), [
    'Электричка −100 ₽',
    'Кофе −250 ₽',
  ]);
  assert.deepEqual(page.errors, []);
  await ctx.close();
});

test('частые расходы и замок до цели: сначала подтверждение', async () => {
  const ctx = await env.context();
  const page = await open(ctx, env.base, {
    storage: { ...configured(), 'kopilkamoto-prefs-v2': { theme: 'auto', lock: true, lockSince: 1 } },
  });
  await page.click('#quickSpend [aria-label^="Записать расход: Еда"]');
  await page.waitForSelector('#dialog[open]');
  assert.match(await page.textContent('#dialogTitle'), /Взять 400/);
  await page.click('#dialogCancel');
  assert.deepEqual((await stored(page)).entries, {});
  await ctx.close();
});

test('переезд на новый телефон: копия переносит частые расходы, замок и тему', async () => {
  const ctx = await env.context();
  const old = await open(ctx, env.base, {
    storage: {
      ...configured({ a: entry(today(), 500) }),
      'kopilkamoto-prefs-v2': {
        theme: 'dark',
        lock: true,
        lockSince: 1,
        presets: [{ note: 'Бензин', amount: 1500 }],
      },
    },
    hash: '#settings',
  });
  const [dl] = await Promise.all([old.waitForEvent('download'), old.click('#export')]);
  const file = await readFile(await dl.path());
  await ctx.close();

  const fresh = await env.context();
  const page = await open(fresh, env.base, { storage: configured(), hash: '#settings' });
  await page.setInputFiles('#file', { name: 'b.json', mimeType: 'application/json', buffer: file });
  await page.waitForSelector('#dialog[open]');
  await page.click('#dialogOk');
  await page.waitForFunction(() =>
    document.querySelector('#toastText').textContent.startsWith('Копия восстановлена'),
  );
  const prefs = await page.evaluate(() => JSON.parse(localStorage.getItem('kopilkamoto-prefs-v2')));
  assert.deepEqual(
    [prefs.presets, prefs.lock, prefs.theme],
    [[{ note: 'Бензин', amount: 1500 }], true, 'dark'],
  );
  assert.equal(await page.getAttribute('html', 'data-theme'), 'dark');
  assert.equal(await page.isChecked('#lockToggle'), true);
  // «Отменить» возвращает и прежние настройки
  await page.click('#toastAction');
  const back = await page.evaluate(() => JSON.parse(localStorage.getItem('kopilkamoto-prefs-v2')));
  assert.deepEqual(
    back.presets.map((p) => p.note),
    ['Электричка', 'Еда'],
  );
  assert.equal(back.lock, false);
  await fresh.close();
});

test('«Куда ушли деньги»: расходы месяца по категориям на главной', async () => {
  const ctx = await env.context();
  const page = await open(ctx, env.base, {
    storage: configured({
      a: entry(today(), 400, 'spent', { note: 'Еда' }),
      b: entry(today(), 100, 'spent', { note: 'Электричка' }),
      c: entry(today(), 5000),
    }),
  });
  assert.equal(await page.isVisible('#spendWrap'), true);
  assert.deepEqual(await page.locator('#spendList .spend-label').allTextContents(), ['Еда', 'Электричка']);
  assert.match(await page.textContent('#spendList li:first-child .spend-sum'), /400\s₽ · 80%/);
  // одно нажатие частого расхода — разбивка обновилась
  await page.click('#quickSpend [aria-label^="Записать расход: Электричка"]');
  assert.match(await page.textContent('#spendList li:nth-child(2) .spend-sum'), /200\s₽ · 33%/);
  const empty = await open(ctx, env.base, { storage: configured({ c: entry(today(), 5000) }) });
  assert.equal(await empty.isVisible('#spendWrap'), false);
  await ctx.close();
});
