# Charlie Quiz Automation

Автоматичне покриття квізу реєстрації Charlie (AllRight) з двома підходами:
- **Variant 1**: Адаптивний навігатор з перевіркою бізнес-результату
- **Variant 2**: AI-агент (Claude vision) для проходження квізу

## Передумови

- Node.js 18+
- npm

## Встановлення

```bash
npm install
npx playwright install chromium
```

## Конфігурація

Скопіюйте `.env.example` в `.env` і заповніть:

```bash
cp .env.example .env
```

| Змінна | Обов'язкова | Опис |
|--------|------------|------|
| `AWS_ACCESS_KEY_ID` | Тільки для Variant 2 | AWS Access Key (Claude через Bedrock) |
| `AWS_SECRET_ACCESS_KEY` | Тільки для Variant 2 | AWS Secret Key |
| `AWS_REGION` | Ні | AWS регіон (default: us-east-1) |
| `BASE_URL` | Ні | Override базового URL (default: stage.allright.com) |

## Запуск тестів

### Variant 1 — Бізнес-результат (без AI)

```bash
npm run test:business
```

Або в headed-режимі (бачити браузер):

```bash
npx playwright test tests/business-result.spec.ts --headed
```

### Variant 2 — AI-агент (потрібні AWS credentials для Bedrock)

```bash
export AWS_ACCESS_KEY_ID=...
export AWS_SECRET_ACCESS_KEY=...
export AWS_REGION=us-east-1
npm run test:ai-agent
```

### Всі тести

```bash
npm test
```

### Дослідження квізу (exploration script)

```bash
npm run explore
```

Зберігає screenshots в `exploration/screenshots/` та JSON-звіт.

## Структура проєкту

```
├── APPROACH.md                  ← Частина A: опис підходу
├── README.md                    ← Цей файл
├── playwright.config.ts         ← Конфігурація Playwright
├── src/
│   ├── helpers/
│   │   ├── quiz-navigator.ts    ← Адаптивна навігація (евристики)
│   │   ├── data-generator.ts    ← Генерація тестових даних
│   │   └── result-verifier.ts   ← Верифікація бізнес-результату
│   └── ai-agent/
│       └── quiz-agent.ts        ← AI-агент з Claude vision
├── tests/
│   ├── business-result.spec.ts  ← Тести Variant 1
│   └── ai-agent-flow.spec.ts    ← Тести Variant 2
└── exploration/
    └── explore-quiz.ts          ← Скрипт дослідження структури квізу
```

## Архітектурні рішення

### Адаптивний навігатор (quiz-navigator.ts)

Не хардкодить кроки квізу. На кожному кроці:
1. Шукає input-поля → заповнює тестовими даними
2. Шукає кнопку "Продовжити"/"Далі" → натискає
3. Шукає clickable options → обирає першу
4. Перевіряє чи дійшов до success screen

Це робить тест стійким до A/B-змін і нових кроків.

### AI-агент (quiz-agent.ts)

Використовує Claude через **AWS Bedrock** (а не прямий Anthropic API), що дозволяє:
- Використовувати існуючі AWS credentials без окремого API-ключа
- Інтегруватися з корпоративним AWS-акаунтом
- Контролювати витрати через AWS billing

На кожній ітерації:
1. Робить screenshot сторінки
2. Відправляє в Claude (vision) з інструкцією "пройди квіз"
3. Claude повертає дію (click/fill/done)
4. Playwright виконує дію
5. Повторює до success або max iterations

Модель за замовчуванням — Claude Haiku 4.5 (оптимальний баланс швидкість/вартість). Можна змінити через `BEDROCK_MODEL_ID`.

### Result Verifier (result-verifier.ts)

Перевіряє бізнес-результат двома методами:
- **Network**: перехоплює API-запити на створення user/booking
- **UI**: перевіряє наявність success-screen

## Припущення

1. Stage-середовище доступне за URL `stage.allright.com`
2. Квіз завершується створенням user + booking (бізнес-інваріант)
3. Тестові дані (@example.com) не блокуються системою
4. Структура квізу: послідовність кроків з кнопками/інпутами → фінальний екран

## Чому Bedrock, а не прямий Anthropic API

AI-агент підключається до Claude через AWS Bedrock замість прямого `api.anthropic.com`:

1. **Не потребує окремого платного API-ключа** — працює з існуючими AWS credentials
2. **Корпоративна інтеграція** — витрати йдуть через AWS billing, можна контролювати через IAM policies
3. **Той самий Claude** — Bedrock надає доступ до тих самих моделей (Haiku, Sonnet, Opus)
4. **Простіше для CI/CD** — AWS credentials вже є в більшості CI-систем

Якщо потрібна інша модель (наприклад, Sonnet для кращої якості навігації):
```bash
export BEDROCK_MODEL_ID=us.anthropic.claude-sonnet-4-20250514-v1:0
npm run test:ai-agent
```

## Що б зробив далі

- API-верифікація через адмін-панель (з Bearer token)
- Автоматичний cleanup тестових записів
- Паралельний запуск для покриття різних A/B-варіантів
- Alerting в Slack при падінні тестів
- Метрики та трейсінг (час проходження, кількість кроків)
