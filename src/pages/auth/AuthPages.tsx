import { zodResolver } from '@hookform/resolvers/zod';
import { Eye, EyeOff, MailCheck } from 'lucide-react';
import { useEffect, useId, useState, type ReactNode } from 'react';
import { useForm, type UseFormRegisterReturn } from 'react-hook-form';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router';
import { z } from 'zod';
import { Logo, LogoMark } from '@/components/layout/AppShell';
import { InlineError, PageLoader, Spinner } from '@/components/ui';
import { TERMS_VERSION } from '@/config/listing';
import { useT } from '@/i18n';
import { errorMessage } from '@/lib/errors';
import { safeInternalPath } from '@/lib/safe-link';
import { supabase } from '@/lib/supabase';
import { emailSchema, loginSchema, registerSchema, resetSchema } from '@/lib/validation';
import { useAuth } from '@/providers/AuthProvider';
import { useToast } from '@/providers/ToastProvider';

/** Auth layout: brand panel from the concept's splash screen on desktop, compact logo on phones. */
function AuthCard({ title, children, footer }: { title: string; children: ReactNode; footer?: ReactNode }) {
  const t = useT();
  return (
    <div className="flex min-h-dvh">
      <aside className="bg-primary-deep relative hidden w-[44%] max-w-xl flex-col justify-between overflow-hidden p-10 text-white lg:flex">
        <div className="flex items-center gap-3">
          <LogoMark className="size-12 [&_rect]:fill-white/10" />
          <span className="text-2xl font-extrabold tracking-[0.04em]">TAPTIM</span>
        </div>
        <div>
          <p className="max-w-sm text-[34px] leading-tight font-extrabold">{t.auth.brandTitle}</p>
          <p className="mt-4 max-w-sm text-white/80">{t.common.slogan}</p>
        </div>
        <p className="text-sm text-white/70">{t.auth.brandFooter}</p>
        <div
          className="pointer-events-none absolute -right-24 -bottom-24 size-80 rounded-full bg-white/5"
          aria-hidden
        />
      </aside>
      <div className="flex flex-1 flex-col items-center justify-center px-4 py-10">
        <Logo className="mb-6 lg:hidden" />
        <div className="w-full max-w-md">
          <h1 className="mb-5 text-[24px] font-extrabold">{title}</h1>
          <div className="card p-5 sm:p-7">{children}</div>
          {footer && <div className="text-text-2 mt-5 text-center text-[15px]">{footer}</div>}
        </div>
      </div>
    </div>
  );
}

function TextInput({
  label,
  error,
  hint,
  type = 'text',
  autoComplete,
  reg,
}: {
  label: string;
  error?: string;
  hint?: string;
  type?: string;
  autoComplete?: string;
  reg: UseFormRegisterReturn;
}) {
  const id = useId();
  const [show, setShow] = useState(false);
  const isPw = type === 'password';
  return (
    <div>
      <label htmlFor={id} className="field-label">
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          type={isPw && show ? 'text' : type}
          autoComplete={autoComplete}
          aria-invalid={Boolean(error)}
          aria-describedby={`${id}-msg`}
          className={`field-input ${isPw ? 'pr-12' : ''}`}
          {...reg}
        />
        {isPw && (
          <button
            type="button"
            onClick={() => setShow((s) => !s)}
            className="text-text-2 hover:text-text absolute top-1/2 right-1 flex size-10 -translate-y-1/2 items-center justify-center rounded-lg"
            aria-label={show ? 'Скрыть пароль' : 'Показать пароль'}
          >
            {show ? <EyeOff className="size-5" /> : <Eye className="size-5" />}
          </button>
        )}
      </div>
      <p
        id={`${id}-msg`}
        className={error ? 'field-error' : hint ? 'field-hint' : 'sr-only'}
        role={error ? 'alert' : undefined}
      >
        {error ?? hint ?? ''}
      </p>
    </div>
  );
}

const redirectUrl = (path: string) => `${window.location.origin}${path}`;

export function LoginPage() {
  const t = useT();
  const { user } = useAuth();
  const [sp] = useSearchParams();
  const navigate = useNavigate();
  const next = safeInternalPath(sp.get('next'));
  const [error, setError] = useState<unknown>(null);
  const form = useForm<z.input<typeof loginSchema>>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  });
  const { errors, isSubmitting } = form.formState;

  if (user) return <Navigate to={next} replace />;

  const submit = form.handleSubmit(async (v) => {
    setError(null);
    const { error: e } = await supabase.auth.signInWithPassword({ email: v.email, password: v.password });
    if (e) {
      // generic message: do not reveal whether the email exists
      setError(e.code === 'email_not_confirmed' ? e : { code: 'invalid_credentials' });
      return;
    }
    navigate(next, { replace: true });
  });

  return (
    <AuthCard
      title={t.auth.loginTitle}
      footer={
        <>
          {t.auth.noAccount}{' '}
          <Link
            to={`/register${sp.get('next') ? `?next=${encodeURIComponent(next)}` : ''}`}
            className="text-primary-ink font-semibold"
          >
            {t.common.signup}
          </Link>
        </>
      }
    >
      <form onSubmit={submit} noValidate className="space-y-4">
        <TextInput
          label={t.auth.email}
          type="email"
          autoComplete="email"
          error={errors.email?.message}
          reg={form.register('email')}
        />
        <TextInput
          label={t.auth.password}
          type="password"
          autoComplete="current-password"
          error={errors.password?.message}
          reg={form.register('password')}
        />
        <div className="text-right">
          <Link to="/forgot" className="text-primary-ink text-sm font-semibold">
            {t.auth.forgot}
          </Link>
        </div>
        <InlineError error={error} />
        <button type="submit" className="btn-primary w-full" disabled={isSubmitting}>
          {isSubmitting && <Spinner className="size-4" />}
          {t.common.login}
        </button>
      </form>
    </AuthCard>
  );
}

export function RegisterPage() {
  const t = useT();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState<unknown>(null);
  const form = useForm<z.input<typeof registerSchema>>({
    resolver: zodResolver(registerSchema),
    defaultValues: { displayName: '', email: '', password: '', passwordRepeat: '', acceptTerms: false },
  });
  const { errors, isSubmitting } = form.formState;
  if (user) return <Navigate to="/" replace />;

  const submit = form.handleSubmit(async (v) => {
    setError(null);
    const { error: e } = await supabase.auth.signUp({
      email: v.email,
      password: v.password,
      options: {
        emailRedirectTo: redirectUrl('/auth/callback'),
        // the DB trigger refuses signups without the current terms version
        data: { display_name: v.displayName.trim(), terms_version: TERMS_VERSION },
      },
    });
    if (e) {
      setError(e);
      return;
    }
    navigate(`/check-email?email=${encodeURIComponent(v.email)}`, { replace: true });
  });

  return (
    <AuthCard
      title={t.auth.registerTitle}
      footer={
        <>
          {t.auth.haveAccount}{' '}
          <Link to="/login" className="text-primary-ink font-semibold">
            {t.common.login}
          </Link>
        </>
      }
    >
      <form onSubmit={submit} noValidate className="space-y-4">
        <TextInput
          label={t.auth.displayName}
          hint={t.auth.displayNameHint}
          autoComplete="nickname"
          error={errors.displayName?.message}
          reg={form.register('displayName')}
        />
        <TextInput
          label={t.auth.email}
          type="email"
          autoComplete="email"
          error={errors.email?.message}
          reg={form.register('email')}
        />
        <TextInput
          label={t.auth.password}
          type="password"
          autoComplete="new-password"
          hint={t.auth.passwordRules}
          error={errors.password?.message}
          reg={form.register('password')}
        />
        <TextInput
          label={t.auth.passwordRepeat}
          type="password"
          autoComplete="new-password"
          error={errors.passwordRepeat?.message}
          reg={form.register('passwordRepeat')}
        />
        <div>
          <label className="flex cursor-pointer items-start gap-3">
            <input
              type="checkbox"
              className="mt-0.5 size-5 shrink-0 accent-[var(--c-primary)]"
              {...form.register('acceptTerms')}
            />
            <span className="text-sm leading-relaxed">
              {t.auth.acceptTerms}{' '}
              <Link to="/terms" target="_blank" className="text-primary-ink font-semibold underline">
                {t.auth.terms}
              </Link>{' '}
              {t.auth.and}{' '}
              <Link to="/privacy" target="_blank" className="text-primary-ink font-semibold underline">
                {t.auth.privacy}
              </Link>
            </span>
          </label>
          {errors.acceptTerms && <p className="field-error">{errors.acceptTerms.message}</p>}
        </div>
        <InlineError error={error} />
        <button type="submit" className="btn-primary w-full" disabled={isSubmitting}>
          {isSubmitting && <Spinner className="size-4" />}
          {t.common.signup}
        </button>
      </form>
    </AuthCard>
  );
}

export function CheckEmailPage() {
  const t = useT();
  const [sp] = useSearchParams();
  const toast = useToast();
  const email = sp.get('email') ?? '';
  const [busy, setBusy] = useState(false);
  return (
    <AuthCard title={t.auth.checkEmailTitle}>
      <div className="space-y-4 text-center">
        <MailCheck className="text-primary mx-auto size-12" aria-hidden />
        <p className="text-text-2">{t.auth.checkEmailText}</p>
        {email && <p className="font-semibold break-all">{email}</p>}
        {email && (
          <button
            type="button"
            className="btn-secondary w-full"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              const { error } = await supabase.auth.resend({
                type: 'signup',
                email,
                options: { emailRedirectTo: redirectUrl('/auth/callback') },
              });
              setBusy(false);
              toast(error ? errorMessage(error) : t.auth.resent, error ? 'error' : 'success');
            }}
          >
            {t.auth.resend}
          </button>
        )}
        <Link to="/login" className="btn-ghost w-full">
          {t.common.login}
        </Link>
      </div>
    </AuthCard>
  );
}

/** Email confirmation (PKCE): the one-time code is exchanged for a session by supabase-js. */
export function AuthCallbackPage() {
  const t = useT();
  const { user, ready } = useAuth();
  const [sp] = useSearchParams();
  const errorCode = sp.get('error_code');
  if (errorCode) {
    return (
      <AuthCard title={t.common.errorTitle}>
        <InlineError error={{ code: errorCode === 'otp_expired' ? 'otp_expired' : 'flow_state_not_found' }} />
        <Link to="/login" className="btn-primary mt-4 w-full">
          {t.common.login}
        </Link>
      </AuthCard>
    );
  }
  if (ready && user) return <Navigate to="/" replace />;
  return (
    <AuthCard title={t.auth.confirming}>
      <PageLoader />
      <CallbackTimeout />
    </AuthCard>
  );
}

function CallbackTimeout() {
  const t = useT();
  const [late, setLate] = useState(false);
  useEffect(() => {
    const id = window.setTimeout(() => setLate(true), 6000);
    return () => window.clearTimeout(id);
  }, []);
  if (!late) return null;
  return (
    <div className="space-y-3">
      <InlineError error={{ code: 'flow_state_not_found' }} />
      <Link to="/login" className="btn-primary w-full">
        {t.common.login}
      </Link>
    </div>
  );
}

export function ForgotPasswordPage() {
  const t = useT();
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const form = useForm<{ email: string }>({
    resolver: zodResolver(z.object({ email: emailSchema })),
    defaultValues: { email: '' },
  });
  const submit = form.handleSubmit(async (v) => {
    setError(null);
    const { error: e } = await supabase.auth.resetPasswordForEmail(v.email, {
      redirectTo: redirectUrl('/auth/reset'),
    });
    // Same response whether or not the account exists (no account enumeration), except rate limits.
    if (e && e.code?.startsWith('over_')) setError(e);
    else setSent(true);
  });
  return (
    <AuthCard title={t.auth.forgotTitle}>
      {sent ? (
        <div className="space-y-4">
          <p className="text-text-2">{t.auth.forgotSent}</p>
          <Link to="/login" className="btn-primary w-full">
            {t.common.login}
          </Link>
        </div>
      ) : (
        <form onSubmit={submit} noValidate className="space-y-4">
          <p className="text-text-2 text-[15px]">{t.auth.forgotText}</p>
          <TextInput
            label={t.auth.email}
            type="email"
            autoComplete="email"
            error={form.formState.errors.email?.message}
            reg={form.register('email')}
          />
          <InlineError error={error} />
          <button type="submit" className="btn-primary w-full" disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting && <Spinner className="size-4" />}
            {t.auth.sendLink}
          </button>
        </form>
      )}
    </AuthCard>
  );
}

/** Also used for "change password" while signed in. */
export function ResetPasswordPage() {
  const t = useT();
  const { user, ready } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [error, setError] = useState<unknown>(null);
  const form = useForm<z.input<typeof resetSchema>>({
    resolver: zodResolver(resetSchema),
    defaultValues: { password: '', passwordRepeat: '' },
  });
  if (!ready) return <PageLoader />;
  if (!user) {
    return (
      <AuthCard title={t.auth.resetTitle}>
        <InlineError error={{ code: 'otp_expired' }} />
        <Link to="/forgot" className="btn-primary mt-4 w-full">
          {t.auth.sendLink}
        </Link>
      </AuthCard>
    );
  }
  const submit = form.handleSubmit(async (v) => {
    setError(null);
    const { error: e } = await supabase.auth.updateUser({ password: v.password });
    if (e) {
      setError(e);
      return;
    }
    toast(t.auth.resetDone);
    navigate('/me', { replace: true });
  });
  return (
    <AuthCard title={t.auth.resetTitle}>
      <form onSubmit={submit} noValidate className="space-y-4">
        <TextInput
          label={t.auth.newPassword}
          type="password"
          autoComplete="new-password"
          hint={t.auth.passwordRules}
          error={form.formState.errors.password?.message}
          reg={form.register('password')}
        />
        <TextInput
          label={t.auth.passwordRepeat}
          type="password"
          autoComplete="new-password"
          error={form.formState.errors.passwordRepeat?.message}
          reg={form.register('passwordRepeat')}
        />
        <InlineError error={error} />
        <button type="submit" className="btn-primary w-full" disabled={form.formState.isSubmitting}>
          {form.formState.isSubmitting && <Spinner className="size-4" />}
          {t.common.save}
        </button>
      </form>
    </AuthCard>
  );
}
