# KopilkaMoto

Обновлённый мобильный трекер накоплений: адаптивный интерфейс, авто-тема, локальное хранение, история, график за неделю, резервные копии, PWA и интерфейс ChatGPT.

## Публикация GitHub Pages
1. Распакуй архив и загрузи содержимое в корень `idoc11/KopilkaMoto` в ветку `main`, сохранив папку `.github`.
2. GitHub → Settings → Pages → Build and deployment → Source: **GitHub Actions**.
3. Открой Actions и дождись успешного запуска `Deploy KopilkaMoto to GitHub Pages`.
4. Адрес: https://idoc11.github.io/KopilkaMoto/

## Установка
Android: открой сайт в Chrome → меню ⋮ → «Установить приложение» / «Добавить на главный экран».
iPhone: открой сайт в Safari → «Поделиться» → «На экран Домой».

## Данные
Данные хранятся в localStorage текущего браузера. Синхронизации между устройствами нет. Делай резервную копию JSON в настройках.

## ChatGPT API
GitHub Pages не может безопасно хранить API-ключ. `ai-worker.js` — прокси для Cloudflare Workers:
1. Создай Worker и вставь туда содержимое `ai-worker.js`.
2. В Variables and Secrets добавь Secret `OPENAI_API_KEY`.
3. Добавь переменную `ALLOWED_ORIGIN` = `https://idoc11.github.io` (или `*` для первичной проверки; это менее строго).
4. Опционально добавь `OPENAI_MODEL` (по умолчанию `gpt-4o-mini`).
5. Опубликуй Worker, скопируй HTTPS URL и укажи его в настройках KopilkaMoto.
API оплачивается отдельно по тарифам OpenAI. Никогда не публикуй ключ в HTML/JS или GitHub.

## Сохранность старых данных
Приложение использует прежний ключ `moto-tracker-v1` и сохраняет совместимость с прежней структурой `entries` и `settings`. Перед обновлением всё равно скачай резервную копию.
