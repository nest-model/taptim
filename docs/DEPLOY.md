# Запуск в production

## 1. Supabase-проект

```bash
supabase link --project-ref <ref>
supabase db push                          # применяет supabase/migrations
supabase functions deploy photos
supabase functions deploy delete-account
supabase functions deploy cleanup-photos --no-verify-jwt
supabase secrets set ALLOWED_ORIGINS=https://taptim.kz CRON_SECRET=$(openssl rand -hex 32)
```

### Ежедневная очистка фото (бесплатно: pg_cron + pg_net)

В SQL-редакторе (подставьте ref проекта и тот же `CRON_SECRET`):

```sql
create extension if not exists pg_net;
select cron.schedule('taptim-cleanup-photos', '30 3 * * *', $$
  select net.http_post(
    url := 'https://<ref>.supabase.co/functions/v1/cleanup-photos',
    headers := jsonb_build_object('x-cron-secret', '<CRON_SECRET>', 'Content-Type', 'application/json'),
    body := '{}'::jsonb
  );
$$);
```

Удаляются фото объявлений, закрытых/удалённых больше 30 дней назад (кроме тех, на которые есть открытая жалоба).

`SUPABASE_URL` и `SUPABASE_SERVICE_ROLE_KEY` в функции подставляет платформа — **не** кладите их в `.env` фронтенда.

## Бюджет 0 ₸ (Supabase Free)

| Ресурс | Лимит Free | Как укладываемся |
|---|---|---|
| Storage | 1 ГБ | фото ≤1280 px WebP (~150 КБ) + превью ≤400 px (~20 КБ), максимум 5 фото, автоочистка закрытых |
| Egress | 5 ГБ / мес | в лентах грузятся только превью; файлы с вечным кешем в браузере |
| Edge Functions | 500 000 вызовов / мес | 1 вызов на фото |

Ориентир: ~5 000 объявлений по 3 фото ≈ 2,6 ГБ — не влезет, но с очисткой закрытых храним только **живые** объявления: ≈ 1 500–2 000 активных объявлений с фото. Лента из 20 превью ≈ 0,4 МБ → ~12 000 просмотров ленты в месяц. Следите за Usage в Dashboard.

Бесплатный проект засыпает после недели без запросов — для запуска с реальными пользователями это не проблема, для демо откройте сайт раз в неделю.

## 2. Настройки Auth (Dashboard → Authentication)

| Параметр | Значение |
|---|---|
| Site URL | `https://taptim.kz` |
| Redirect URLs | `https://taptim.kz/auth/callback`, `https://taptim.kz/auth/reset` (и ничего лишнего) |
| Confirm email | включено |
| Secure password change | включено |
| Minimum password length | 8, буквы + цифры |
| Refresh token rotation | включено, reuse interval 10 с |
| JWT expiry | 3600 |
| Phone / SMS | выключено, пока не подключён провайдер |
| CAPTCHA | рекомендуется Turnstile или hCaptcha |
| SMTP | собственный домен (встроенный SMTP Supabase — только для тестов) |

Шаблоны писем — на русском; ссылка должна вести на `{{ .SiteURL }}/auth/callback?code=...` (PKCE).

## 3. База

- Проверьте **Advisors → Security** (не должно быть таблиц без RLS).
- Если `pg_cron` не включён — включите и выполните: `select cron.schedule('taptim-maintenance', '17 3 * * *', 'select public.run_maintenance()');`
- Назначьте первого администратора (см. README).
- Бэкапы: включите PITR.

## 4. Фронтенд

```bash
VITE_SUPABASE_URL=https://<ref>.supabase.co \
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_... \
npm run build && npm run check:secrets
```

`dist/` — статический SPA. Заголовки безопасности и SPA-fallback уже настроены:
- Netlify / Cloudflare Pages — `public/_headers`, `public/_redirects`;
- Vercel — `vercel.json`.

Если используете GitHub Pages: заголовки там не настраиваются — для production лучше Cloudflare Pages/Netlify/Vercel.

## 5. Перед публичным запуском

- [ ] Юрист: пользовательское соглашение, политика конфиденциальности, правила.
- [ ] Хранение ПД граждан РК — требования о локализации (возможно, self-hosted Supabase в РК).
- [ ] CAPTCHA на регистрацию и восстановление пароля.
- [ ] Свой SMTP + SPF/DKIM/DMARC.
- [ ] Мониторинг ошибок (без персональных данных в логах).
- [ ] Регламент модерации и сроки хранения жалоб/переписки.
