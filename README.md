# TAPTIM — как запустить. Пошагово, бесплатно, через браузер

**Ничего устанавливать не нужно.** Supabase CLI, Docker и Node.js — не обязательны. Всё делается в Chrome.

Понадобятся 3 бесплатных аккаунта (карта не нужна)

| Сервис | Зачем | Где |
|---|---|---|
| **Supabase** | база данных, вход по почте, фото, чат | https://supabase.com |
| **GitHub** | хранит код сайта | https://github.com |
| **Cloudflare** | собирает и показывает сайт в интернете | https://dash.cloudflare.com |

В итоге получится сайт вида `https://taptim.pages.dev`.

> Названия кнопок на сайтах иногда немного меняются. Если не нашёл кнопку точно с таким текстом — ищи похожую по смыслу.

---

## Часть 1. Supabase — база данных (≈15 минут)

### Шаг 1. Создать проект

1. Открой https://supabase.com → **Start your project** → войди через GitHub (или почту).
2. Нажми **New project**.
3. Заполни:
   - **Organization** — твоя (создастся автоматически).
   - **Project name** — `taptim`.
   - **Database Password** — нажми **Generate a password**, потом **скопируй и сохрани** в заметки.
   - **Region** — Central EU (Frankfurt) или любой ближайший.
   - **Plan** — **Free**.
4. Нажми **Create new project**. Подожди 1–2 минуты, пока крутится загрузка.

### Шаг 2. Залить базу (один копипаст)

1. В левом меню нажми **SQL Editor** (иконка `>_`).
2. Нажми **+** / **New query** — откроется пустое окно.
3. На компьютере открой из архива файл **`supabase/setup.sql`** (Блокнотом / любым редактором) → `Ctrl+A` → `Ctrl+C`.
4. Вставь в окно SQL Editor (`Ctrl+V`).
5. Нажми **Run** (или `Ctrl+Enter`).
   Если спросит про «destructive operation» — подтверди (**Run this query**).
6. Внизу должно быть **Success. No rows returned**.

**Проверка:** левое меню → **Table Editor** — видны таблицы `listings`, `profiles`, `messages`, `categories` и др.

> Если вылезла ошибка — скопируй её текст и пришли мне. Запускать файл повторно на той же базе не нужно.

### Шаг 3. Функции для фото и удаления аккаунта (3 копипаста)

Функции — это маленькие серверные программы. Их 3, каждая — один файл из папки **`supabase/dashboard-functions/`**.

Для **каждой** из трёх:

1. Левое меню → **Edge Functions** → кнопка **Deploy a new function** → **Via Editor**.
2. Внизу/вверху есть поле с названием функции — впиши имя **точно** как в таблице.
3. Удали весь пример кода в редакторе и вставь содержимое файла целиком.
4. Нажми **Deploy function**. Подожди зелёное «deployed».

| Название функции (вписать) | Какой файл вставить |
|---|---|
| `photos` | `supabase/dashboard-functions/photos.ts` |
| `delete-account` | `supabase/dashboard-functions/delete-account.ts` |
| `cleanup-photos` | `supabase/dashboard-functions/cleanup-photos.ts` |

**Только для `cleanup-photos`:** открой её → вкладка **Details** (или **Settings**) → выключи **Enforce JWT verification** (Verify JWT) → **Save**. У двух других этот переключатель оставь **включённым**.

### Шаг 4. Секреты функций

1. Левое меню → **Edge Functions** → **Secrets** (иногда: **Manage secrets**).
2. Добавь два секрета (**Add new secret** → Name / Value → **Save**):

| Name | Value |
|---|---|
| `ALLOWED_ORIGINS` | пока `http://localhost:5173` — в Части 3 заменишь на адрес сайта |
| `CRON_SECRET` | любая длинная строка из букв и цифр, 30+ символов, например набери от балды `k8Fq2Lw9zR4tY7uP1mXc6vB3nA5sD0eG`. **Сохрани её** — понадобится в Шаге 11. |

`SUPABASE_URL` и `SUPABASE_SERVICE_ROLE_KEY` **не добавляй** — Supabase подставляет их сам.

### Шаг 5. Взять два ключа для сайта

1. Левое меню внизу → **Project Settings** (шестерёнка).
2. Раздел **Data API** (или **API**) → скопируй **Project URL** — вида `https://abcdxyz.supabase.co`.
3. Раздел **API Keys** → скопируй **Publishable key** — начинается с `sb_publishable_…`
   (если такого нет — возьми ключ **anon public**, начинается с `eyJ…`).
4. Сохрани оба в заметки.

> ⚠️ **Никогда** не копируй **secret** / **service_role** ключ — он даёт полный доступ к базе. Сайт с ним специально не запустится.

### Шаг 6. Настроить вход по почте

1. Левое меню → **Authentication** → **Sign In / Providers** (или **Providers**) → **Email**:
   - **Enable Email provider** — включено.
   - **Confirm email** — **включено**.
   - **Minimum password length** — `8`.
   - **Save**.
2. Остальное (адрес сайта) настроишь в Шаге 10 — когда сайт появится.

---

## Часть 2. GitHub — загрузить код (≈10 минут)

### Шаг 7. Создать репозиторий

1. https://github.com → справа вверху **+** → **New repository**.
2. **Repository name**: `taptim`.
3. Выбери **Private** (чтобы код никто не видел).
4. Ничего больше не отмечай → **Create repository**.

### Шаг 8. Загрузить файлы (в 2 захода — GitHub принимает до 100 файлов за раз)

1. На странице нового пустого репозитория нажми ссылку **uploading an existing file**.
2. **Заход 1:** открой распакованную папку `taptim` в Проводнике и перетащи в окно браузера **папку `src`** целиком. Дождись, пока все файлы появятся в списке → внизу **Commit changes**.
3. **Заход 2:** снова **Add file → Upload files** и перетащи **всё остальное**, кроме папки `src` и папки `node_modules` (если она есть):
   `public`, `supabase`, `docs`, `scripts`, `tests`, `e2e`, `index.html`, `package.json`, `package-lock.json`, `vite.config.ts`, `vitest.config.ts`, `playwright.config.ts`, `tsconfig.json`, `tsconfig.app.json`, `tsconfig.node.json`, `eslint.config.js`, `vercel.json`, `README.md` и файлы с точкой в начале (`.gitignore`, `.prettierrc.json`, `.env.example`) → **Commit changes**.

> Если какой-то файл или папка с точкой (`.github`) не перетаскивается — пропусти, для сайта они не нужны.
> **Файл `.env` (если создавал) НЕ загружай** — в нём твои настройки.

**Проверка:** в репозитории видны `src`, `public`, `package.json`, `index.html` в корне (не внутри ещё одной папки `taptim`!).

---

## Часть 3. Cloudflare — выложить сайт (≈10 минут)

### Шаг 9. Подключить репозиторий

1. https://dash.cloudflare.com → войди/зарегистрируйся.
2. Левое меню → **Workers & Pages** (может быть внутри **Compute**) → **Create** (Create application).
3. Вкладка **Pages** → **Import an existing Git repository** (Connect to Git).
4. **Connect GitHub** → разреши доступ → выбери репозиторий `taptim` → **Begin setup**.
5. Заполни:
   - **Project name**: `taptim` (это будет адрес `taptim.pages.dev`; если занято — `taptim-shym` и т. п.)
   - **Production branch**: `main`
   - **Framework preset**: `None` (или `React (Vite)`)
   - **Build command**: `npm run build`
   - **Build output directory**: `dist`
6. Раскрой **Environment variables (advanced)** → **Add variable** три раза:

| Variable name | Value |
|---|---|
| `VITE_SUPABASE_URL` | Project URL из Шага 5 |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Publishable key из Шага 5 |
| `NODE_VERSION` | `22` |

7. **Save and Deploy**. Сборка идёт 1–3 минуты. В конце — зелёная галочка и ссылка `https://taptim.pages.dev`.

> Сборка упала? Нажми на неё → **View build log** → пришли мне последние 30 строк.

### Шаг 10. Сообщить Supabase адрес сайта

1. Supabase → **Authentication** → **URL Configuration**:
   - **Site URL**: `https://taptim.pages.dev` (твой адрес) → **Save**.
   - **Redirect URLs** → **Add URL** — добавь по одному:
     - `https://taptim.pages.dev/auth/callback`
     - `https://taptim.pages.dev/auth/reset`
     → **Save URLs**.
2. Supabase → **Edge Functions → Secrets** → секрет `ALLOWED_ORIGINS` → **Edit** → значение:
   `https://taptim.pages.dev` → **Save**.
   (Без этого фото не будут загружаться.)

---

## Часть 4. Первый запуск

### Шаг 11. Автоочистка старых фото (экономит бесплатные лимиты)

Supabase → **SQL Editor** → **New query** → вставь, **замени 2 места** и нажми **Run**:

```sql
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule('taptim-maintenance', '17 3 * * *', 'select public.run_maintenance()');

select cron.schedule('taptim-cleanup-photos', '30 3 * * *', $$
  select net.http_post(
    url := 'https://ТВОЙ-ПРОЕКТ.supabase.co/functions/v1/cleanup-photos',
    headers := jsonb_build_object('x-cron-secret', 'ТВОЙ_CRON_SECRET', 'Content-Type', 'application/json'),
    body := '{}'::jsonb
  );
$$);
```

- `ТВОЙ-ПРОЕКТ.supabase.co` → твой Project URL без `https://` (из Шага 5).
- `ТВОЙ_CRON_SECRET` → строка из Шага 4.

### Шаг 12. Зарегистрироваться и стать админом

1. Открой свой сайт → **Войти** → **Регистрация** → заполни → отметь согласие → **Регистрация**.
2. Открой почту → письмо от Supabase (проверь **Спам**) → нажми ссылку **в этом же браузере**.
3. Supabase → **SQL Editor** → **New query** → вставь (подставь свою почту) → **Run**:

```sql
insert into public.user_roles (user_id, role)
select id, 'admin' from auth.users where email = 'твоя@почта.kz';
```

4. На сайте выйди и зайди снова — в шапке появится щит **Модерация**.

### Шаг 13. Проверить, что всё работает

- [ ] Создать объявление с 2 фото → оно появилось в ленте с картинкой.
- [ ] Во втором браузере (или в режиме инкогнито) зарегистрировать второй аккаунт → написать автору → сообщение пришло без перезагрузки.
- [ ] Пожаловаться на объявление → жалоба видна в **Модерация → Жалобы**.
- [ ] Включить тёмную тему в **Профиль → Настройки**.

🎉 Готово. Теперь каждое изменение кода, загруженное в GitHub, Cloudflare сам выкладывает на сайт.

---

## Если что-то не работает

| Что видишь | Что делать |
|---|---|
| На сайте «Приложение не настроено» | В Cloudflare не заданы `VITE_SUPABASE_URL` / `VITE_SUPABASE_PUBLISHABLE_KEY`. Cloudflare → проект → **Settings → Variables and Secrets** → добавь → **Deployments → Retry deployment**. |
| Фото не загружаются | 1) В секрете `ALLOWED_ORIGINS` точный адрес сайта, без `/` в конце. 2) Функция `photos` задеплоена. Логи: Supabase → **Edge Functions → photos → Logs**. |
| Письмо не приходит | Проверь «Спам». Встроенная почта Supabase шлёт **всего несколько писем в час** — подожди. Для реальных пользователей подключи бесплатный SMTP (Brevo): **Authentication → Emails → SMTP Settings**. |
| «Ссылка устарела» после письма | Открывай ссылку в том же браузере, где регистрировался; проверь Redirect URLs (Шаг 10). |
| «Database error saving new user» | Регистрируйся только через форму сайта (там галочка согласия, без неё база не пустит). |
| Сайт долго грузится / ошибки после паузы | Бесплатный проект Supabase засыпает после ~недели без посещений: Supabase → проект → **Restore project**. |
| Ошибка в SQL Editor на Шаге 2 | Пришли текст ошибки. Не запускай `setup.sql` второй раз. |

---

## Бесплатные лимиты (0 ₸)

Supabase Free: **1 ГБ** файлов, **5 ГБ** трафика в месяц, **500 000** вызовов функций. Фото сжимаются (WebP ≤1280 px + превью 400 px), максимум 5 на объявление, фото закрытых объявлений удаляются через 30 дней — хватит примерно на 1 500–2 000 живых объявлений с фото. Расход смотри: Supabase → **Usage**. Cloudflare Pages — бесплатно.

---

## Для разработчика

Если всё-таки поставишь Node.js 22 и захочешь запускать сайт у себя (`npm install`, `npm run dev`), тесты, CLI-деплой — см. [`docs/DEV.md`](docs/DEV.md), [`docs/DEPLOY.md`](docs/DEPLOY.md), безопасность — [`docs/SECURITY.md`](docs/SECURITY.md).

 
