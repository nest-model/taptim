// Maps stable server error codes to user-friendly Russian text.
// Raw server messages are never shown (they may contain internals).

const MESSAGES: Record<string, string> = {
  rate_limited: 'Слишком много действий подряд. Подождите немного и попробуйте снова.',
  restricted: 'Это действие для вашего аккаунта временно ограничено.',
  blocked: 'Общение с этим пользователем недоступно.',
  messages_disabled: 'Пользователь принимает сообщения только по своим объявлениям и запросам.',
  claim_required: 'Сначала опишите приметы вещи — нашедший проверит, что она ваша.',
  listing_unavailable: 'Объявление больше недоступно.',
  listing_deleted: 'Объявление удалено.',
  own_listing: 'Это ваше объявление.',
  quantity_unavailable: 'Столько экземпляров уже нет.',
  invalid_transition: 'Это действие сейчас недоступно. Обновите страницу.',
  invalid_status: 'Недопустимый статус объявления.',
  invalid_category: 'Выберите подходящую категорию.',
  invalid_district: 'Выберите район из списка.',
  city_not_available: 'Этот город пока не подключён.',
  invalid_event_date: 'Дата должна быть не позже сегодняшней и не раньше чем год назад.',
  invalid_wanted_until: 'Срок актуальности — от сегодня до 90 дней.',
  republish_too_soon: 'Повторно публиковать можно не чаще раза в сутки.',
  listing_expired_use_republish: 'Срок объявления истёк — используйте «Опубликовать снова».',
  immutable_field: 'Это поле нельзя изменить.',
  display_name_reserved: 'Такое имя использовать нельзя — выберите другое.',
  invalid_recipient: 'Написать этому человеку нельзя.',
  recipient_unavailable: 'Аккаунт собеседника удалён.',
  empty_message: 'Сообщение пустое.',
  cannot_report_self: 'Нельзя пожаловаться на себя.',
  not_found: 'Не найдено или нет доступа.',
  forbidden: 'Недостаточно прав.',
  not_authenticated: 'Войдите в аккаунт, чтобы продолжить.',
  too_many_photos: 'Можно добавить не больше 5 фотографий.',
  photos_not_allowed: 'В этой категории фотографии не принимаются — не публикуйте фото документов.',
  unsupported_format: 'Поддерживаются только JPG, PNG и WebP.',
  malformed_image: 'Файл повреждён или не является изображением.',
  image_too_large: 'Изображение слишком большое.',
  image_too_small: 'Изображение слишком маленькое.',
  file_too_large: 'Файл слишком большой.',
  upload_not_found: 'Загрузка не завершилась. Попробуйте ещё раз.',
  reason_required: 'Укажите причину.',
  info_request_required: 'Напишите, какая информация нужна.',
  confirmation_required: 'Введите слово для подтверждения.',
  // Supabase Auth
  invalid_credentials: 'Неверная почта или пароль.',
  email_not_confirmed: 'Подтвердите почту — мы отправили ссылку на ваш адрес.',
  user_already_exists: 'Аккаунт с такой почтой уже существует.',
  email_exists: 'Аккаунт с такой почтой уже существует.',
  weak_password: 'Пароль слишком простой: минимум 8 символов, буквы и цифры.',
  same_password: 'Новый пароль совпадает со старым.',
  over_email_send_rate_limit: 'Письмо уже отправлено. Подождите минуту перед повторной отправкой.',
  over_request_rate_limit: 'Слишком много попыток. Попробуйте позже.',
  reauthentication_needed: 'Для смены пароля войдите заново.',
  session_expired: 'Сессия истекла. Войдите снова.',
  flow_state_not_found: 'Ссылка устарела или открыта в другом браузере. Войдите или запросите новую.',
  otp_expired: 'Ссылка устарела. Запросите новую.',
  network: 'Нет соединения с интернетом. Проверьте подключение.',
};

export const GENERIC_ERROR = 'Что-то пошло не так. Попробуйте ещё раз.';

/** Extracts a stable code from Supabase/PostgREST/Auth/Functions errors. */
export function errorCode(err: unknown): string | null {
  if (!err) return null;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return 'network';
  if (typeof err === 'object') {
    const e = err as { message?: unknown; code?: unknown; context?: unknown; name?: unknown };
    if (typeof e.code === 'string' && MESSAGES[e.code]) return e.code;
    if (typeof e.message === 'string' && MESSAGES[e.message]) return e.message;
    if (typeof e.code === 'string' && e.code === '42501') return 'forbidden';
    if (typeof e.code === 'string' && e.code === '23505') return 'duplicate';
    if (typeof e.message === 'string' && /JWT expired|invalid JWT/i.test(e.message)) return 'session_expired';
    if (typeof e.message === 'string' && /Failed to fetch|NetworkError|Load failed/i.test(e.message))
      return 'network';
  }
  return null;
}

export function errorMessage(err: unknown, fallback = GENERIC_ERROR): string {
  const code = errorCode(err);
  if (code === 'duplicate') return 'Вы уже это сделали.';
  return (code && MESSAGES[code]) || fallback;
}

/** Edge Function errors carry `{ error: code }` in the response body. */
export async function functionErrorCode(err: unknown): Promise<string | null> {
  const ctx = (err as { context?: Response } | null)?.context;
  if (ctx && typeof ctx.json === 'function') {
    try {
      const body = (await ctx.clone().json()) as { error?: string };
      return body.error ?? null;
    } catch {
      return null;
    }
  }
  return errorCode(err);
}

export const messageForCode = (code: string | null) => (code && MESSAGES[code]) || GENERIC_ERROR;
