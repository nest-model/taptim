import { z } from 'zod';
import { LIMITS, LISTING_TYPES, CONDITIONS } from '@/config/listing';
import { isoDate } from './format';

// Client-side schemas mirror DB constraints for early, friendly feedback.
// They are NOT a security boundary — the database re-validates everything.

const trimmed = (min: number, max: number, minMsg: string, maxMsg: string) =>
  z
    .string()
    .transform((s) => s.trim())
    .pipe(z.string().min(min, { error: minMsg }).max(max, { error: maxMsg }));

export const emailSchema = z
  .string()
  .trim()
  .min(1, { error: 'Укажите почту' })
  .pipe(z.email({ error: 'Проверьте адрес почты' }));

export const passwordSchema = z
  .string()
  .min(8, { error: 'Минимум 8 символов' })
  .max(72, { error: 'Максимум 72 символа' })
  .regex(/[A-Za-zА-Яа-яЁё]/, { error: 'Добавьте хотя бы одну букву' })
  .regex(/\d/, { error: 'Добавьте хотя бы одну цифру' });

const RESERVED = /(taptim|таптим|модератор|moderator|админ|admin|поддержка|support)/i;

export const displayNameSchema = trimmed(
  LIMITS.displayNameMin,
  LIMITS.displayNameMax,
  'Минимум 2 символа',
  'Максимум 40 символов',
).refine((v) => !RESERVED.test(v), { error: 'Такое имя использовать нельзя' });

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, { error: 'Введите пароль' }),
});

export const registerSchema = z
  .object({
    displayName: displayNameSchema,
    email: emailSchema,
    password: passwordSchema,
    passwordRepeat: z.string(),
    acceptTerms: z.boolean().refine((v) => v, { error: 'Нужно принять соглашение' }),
  })
  .refine((v) => v.password === v.passwordRepeat, { path: ['passwordRepeat'], error: 'Пароли не совпадают' });

export const resetSchema = z
  .object({ password: passwordSchema, passwordRepeat: z.string() })
  .refine((v) => v.password === v.passwordRepeat, { path: ['passwordRepeat'], error: 'Пароли не совпадают' });

export const profileSchema = z.object({
  display_name: displayNameSchema,
  bio: z
    .string()
    .trim()
    .max(LIMITS.bioMax, { error: `Максимум ${LIMITS.bioMax} символов` }),
});

/** Full listing form. Type-specific requirements are checked in superRefine. */
export const listingSchema = z
  .object({
    type: z.enum(LISTING_TYPES as [string, ...string[]]),
    category_id: z.string().min(1, { error: 'Выберите категорию' }),
    title: trimmed(
      LIMITS.titleMin,
      LIMITS.titleMax,
      'Минимум 3 символа',
      `Максимум ${LIMITS.titleMax} символов`,
    ),
    description: trimmed(
      LIMITS.descriptionMin,
      LIMITS.descriptionMax,
      'Опишите подробнее — минимум 10 символов',
      `Максимум ${LIMITS.descriptionMax} символов`,
    ),
    district_id: z.string().min(1, { error: 'Выберите район' }),
    place_hint: z
      .string()
      .trim()
      .max(LIMITS.placeMax, { error: `Максимум ${LIMITS.placeMax} символов` }),
    event_date: z.string(),
    item_condition: z.enum(CONDITIONS as [string, ...string[]]).or(z.literal('')),
    quantity: z.coerce.number().int().min(1).max(LIMITS.quantityMax),
    exchange_wish: z.string().trim().max(LIMITS.exchangeWishMax),
    wanted_until: z.string(),
    is_valuable: z.boolean(),
  })
  .superRefine((v, ctx) => {
    if (v.type === 'lost' || v.type === 'found') {
      if (!v.event_date) ctx.addIssue({ code: 'custom', path: ['event_date'], message: 'Укажите дату' });
      else if (v.event_date > isoDate(0) || v.event_date < isoDate(-LIMITS.eventMaxDaysAgo))
        ctx.addIssue({
          code: 'custom',
          path: ['event_date'],
          message: 'Дата — не позже сегодня и не раньше года назад',
        });
    }
    if ((v.type === 'giveaway' || v.type === 'exchange') && !v.item_condition)
      ctx.addIssue({ code: 'custom', path: ['item_condition'], message: 'Укажите состояние' });
    if (v.type === 'exchange' && v.exchange_wish.length < LIMITS.exchangeWishMin)
      ctx.addIssue({ code: 'custom', path: ['exchange_wish'], message: 'Напишите, что хотите взамен' });
    if (v.type === 'wanted') {
      if (!v.wanted_until) ctx.addIssue({ code: 'custom', path: ['wanted_until'], message: 'Укажите срок' });
      else if (v.wanted_until < isoDate(0) || v.wanted_until > isoDate(LIMITS.wantedMaxDays))
        ctx.addIssue({ code: 'custom', path: ['wanted_until'], message: 'От сегодня до 90 дней' });
    }
  });

export type ListingFormValues = z.input<typeof listingSchema>;

export const messageSchema = z
  .string()
  .transform((s) => s.trim())
  .pipe(z.string().min(1).max(LIMITS.messageMax));

export const reportSchema = z.object({
  reason: z.enum(['fraud', 'prohibited', 'spam', 'abuse', 'dangerous', 'rules', 'other']),
  description: z
    .string()
    .trim()
    .max(LIMITS.reportMax, { error: `Максимум ${LIMITS.reportMax} символов` }),
});
