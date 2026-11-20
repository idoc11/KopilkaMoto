import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, open, configured, entry, shift } from './helpers.mjs';

let env;
before(async () => (env = await setup()));
after(() => env.close());

/** 8 смен по 3000 за 4 недели, 4 траты по 500, старая смена — как в unit-тестах плана. */
function shifts(settings = {}) {
  const en = { old: entry(shift(-40), 1000) };
  [1, 3, 5, 8, 10, 12, 15, 20].forEach(
    (n, i) => (en['s' + i] = entry(shift(-n), 3000, 'delivery', { ts: i + 2 })),
  );
  [2, 6, 9, 14].forEach((n, i) => (en['x' + i] = entry(shift(-n), 500, 'spent', { ts: i + 20 })));
  return configured(en, { goal: 100000, startDate: shift(-45), deadline: shift(30), ...settings });
}

const setSlider = (page, n) =>
  page.evaluate((v) => {
    const el = document.getElementById('planShifts');
    el.value = String(v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, n);

test('план на неделю: сколько смен нужно, прогресс недели, ползунок «что если»', async () => {
  const ctx = await env.context();
  const page = await open(ctx, env.base, { storage: shifts() });
  const lead = await page.textContent('#planLead');
  assert.match(lead, /нужно ≈ 6 смен в неделю — сейчас у тебя ≈ 2\. Типичная смена — 3\s000\s₽/);
  assert.match(
    await page.textContent('#planWeekText'),
    /Эта неделя: \d+ сме\S* · [+−]\d[\d\s]*\s₽ из ≈ [\d\s]+\s₽ по плану/,
  );
  const bar = Number(await page.getAttribute('#planWeekBar', 'value'));
  assert.ok(bar >= 0 && bar <= 100, String(bar));

  // ползунок стоит на нынешнем темпе, результат — «позже срока»
  assert.equal(await page.inputValue('#planShifts'), '2');
  assert.match(await page.textContent('#planShiftsOut'), /2 смены/);
  assert.match(
    await page.textContent('#planResult'),
    /Тогда цель будет \d\d\.\d\d\.\d{4} — на \d+ дн\. позже срока\./,
  );

  // 7 смен в неделю — успеваем с запасом
  await setSlider(page, 7);
  assert.match(await page.textContent('#planShiftsOut'), /7 смен/);
  assert.equal(await page.getAttribute('#planShifts', 'aria-valuetext'), '7 смен в неделю');
  assert.match(await page.textContent('#planResult'), /на 3 дн\. раньше срока/);
  // 0 смен — расходы съедают доходы
  await setSlider(page, 0);
  assert.match(await page.textContent('#planResult'), /расходы съедают доходы/);

  // выбор ползунка не сбрасывается при перерисовке главной
  await setSlider(page, 5);
  await page.click('[data-nav=history]');
  await page.click('[data-nav=home]');
  assert.equal(await page.inputValue('#planShifts'), '5');
  assert.deepEqual(page.errors, []);
  await ctx.close();
});

test('план: пустые состояния — нет смен, цель набрана, не начался, срок прошёл, нужно больше 7 смен', async () => {
  const ctx = await env.context();
  const lead = async (storage) => {
    const page = await open(ctx, env.base, { storage });
    const text = await page.textContent('#planLead');
    const whatIfVisible = await page.isVisible('#planWhatIf');
    await page.close();
    return [text, whatIfVisible];
  };

  let [text, visible] = await lead(configured());
  assert.match(text, /Запиши смены через «Доход» → «Доставка»/);
  assert.equal(visible, false);

  [text, visible] = await lead(shifts({ goal: 20000 }));
  assert.match(text, /Цель набрана/);
  assert.equal(visible, false);

  [text, visible] = await lead(shifts({ startDate: shift(20), deadline: shift(200) }));
  assert.match(text, /План начинается \d\d\.\d\d\.\d{4}/);
  assert.equal(visible, false);

  [text, visible] = await lead(shifts({ deadline: shift(-3), startDate: shift(-60) }));
  assert.match(text, /Срок прошёл/);
  assert.equal(visible, false);

  [text, visible] = await lead(shifts({ deadline: shift(4) }));
  assert.match(text, /больше 7 смен в неделю/);
  assert.equal(visible, true, 'ползунок остаётся: можно посмотреть, что даст максимум');
  await ctx.close();
});

test('план: хватает темпа и «смены не нужны»', async () => {
  const ctx = await env.context();
  let page = await open(ctx, env.base, { storage: shifts({ goal: 30000, deadline: shift(200) }) });
  assert.match(await page.textContent('#planLead'), /Ты успеваешь: сейчас ≈ 2 смен в неделю при нужных 1/);
  page = await open(ctx, env.base, {
    storage: configured(
      { a: entry(shift(-1), 3000), o: entry(shift(-2), 90000, 'other') },
      { goal: 150000, deadline: shift(60) },
    ),
  });
  assert.match(await page.textContent('#planLead'), /по плану можно без смен/);
  await ctx.close();
});

test('AI-помощник получает план: сколько смен нужно и сколько сейчас', async () => {
  const PROXY = 'https://proxy.example/';
  const ctx = await env.context();
  const page = await open(ctx, env.base, {
    storage: { ...shifts(), 'kopilkamoto-prefs-v2': { theme: 'auto', apiUrl: PROXY } },
    hash: '#ai',
  });
  let body;
  await page.route(PROXY + '**', (route) => {
    body = JSON.parse(route.request().postData());
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ reply: 'Нужно 6 смен.' }),
    });
  });
  await page.fill('#question', 'Сколько смен нужно?');
  await page.click('#send');
  await page.waitForFunction(() => document.querySelector('#chat').textContent.includes('Нужно 6 смен.'));
  assert.deepEqual(body.context.plan, {
    status: 'ok',
    neededShiftsPerWeek: 6,
    currentShiftsPerWeek: 2,
    typicalShiftIncome: 3000,
  });
  await ctx.close();
});
