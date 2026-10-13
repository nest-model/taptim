import { KeyRound, LogOut, Monitor, Moon, Sun, Trash2, UserX } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';
import {
  deleteAccount,
  useBlocks,
  usePrivateSettings,
  useSetBlock,
  useUpdatePrivateSettings,
  type PrivateSettings,
} from '@/api/account';
import { useCities } from '@/api/reference';
import { useUpdateProfile } from '@/api/account';
import { Avatar, ConfirmDialog, InlineError, Modal, PageHeader, Spinner, Toggle } from '@/components/ui';
import { ENABLED_LANGS, localizedName, useLang, useT } from '@/i18n';
import { errorMessage } from '@/lib/errors';
import { useAuth } from '@/providers/AuthProvider';
import { useCity } from '@/providers/CityProvider';
import { useTheme, type ThemePref } from '@/providers/ThemeProvider';
import { useToast } from '@/providers/ToastProvider';

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="card p-4 sm:p-5">
      <h2 className="mb-2 text-[17px] font-extrabold">{title}</h2>
      {children}
    </section>
  );
}

export default function SettingsPage() {
  const t = useT();
  const { pref, setPref } = useTheme();
  const { lang, setLang } = useLang();
  const { user, signOut } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const settings = usePrivateSettings();
  const patch = useUpdatePrivateSettings();
  const blocks = useBlocks();
  const setBlock = useSetBlock();
  const cities = useCities();
  const { cityId, setCityId } = useCity();
  const updateProfile = useUpdateProfile();
  const [logoutAll, setLogoutAll] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const themes: [ThemePref, string, typeof Sun][] = [
    ['light', t.settings.themeLight, Sun],
    ['dark', t.settings.themeDark, Moon],
    ['system', t.settings.themeSystem, Monitor],
  ];

  const s = settings.data;
  const toggle = (key: keyof PrivateSettings) => (v: boolean) =>
    patch.mutate({ [key]: v } as Partial<PrivateSettings>, {
      onError: (e) => toast(errorMessage(e), 'error'),
    });

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <PageHeader title={t.settings.title} back={user ? '/me' : '/'} />

      <Section title={t.settings.appearance}>
        <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label={t.settings.appearance}>
          {themes.map(([k, label, Icon]) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={pref === k}
              onClick={() => setPref(k)}
              className={`flex min-h-[72px] flex-col items-center justify-center gap-1.5 rounded-2xl border text-sm font-semibold transition-colors ${pref === k ? 'border-primary bg-primary-soft text-primary-ink' : 'border-line hover:bg-surface-2'}`}
            >
              <Icon className="size-5" aria-hidden />
              {label}
            </button>
          ))}
        </div>
        {ENABLED_LANGS.length > 1 && (
          <div className="mt-4">
            <label htmlFor="lang" className="field-label">
              {t.settings.language}
            </label>
            <select
              id="lang"
              className="field-input"
              value={lang}
              onChange={(e) => setLang(e.target.value as typeof lang)}
            >
              {ENABLED_LANGS.map((l) => (
                <option key={l} value={l}>
                  {t.lang[l]}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="mt-4">
          <label htmlFor="city" className="field-label">
            {t.common.city}
          </label>
          <select
            id="city"
            className="field-input"
            value={cityId}
            onChange={(e) => {
              setCityId(e.target.value);
              if (user) updateProfile.mutate({ city_id: e.target.value });
            }}
          >
            {(cities.data ?? []).map((c) => (
              <option key={c.id} value={c.id} disabled={!c.is_active}>
                {localizedName(c)}
                {!c.is_active ? ` (${t.common.soon})` : ''}
              </option>
            ))}
          </select>
        </div>
      </Section>

      {user && s && (
        <>
          <Section title={t.settings.privacy}>
            <fieldset className="space-y-2">
              <legend className="mb-2 text-[15px] font-medium">{t.settings.messagesFrom}</legend>
              {(['everyone', 'interactions_only'] as const).map((v) => (
                <label
                  key={v}
                  className="border-line has-[:checked]:border-primary has-[:checked]:bg-primary-soft flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border px-3.5"
                >
                  <input
                    type="radio"
                    name="messages_from"
                    checked={s.messages_from === v}
                    onChange={() => patch.mutate({ messages_from: v })}
                    className="size-4 accent-[var(--c-primary)]"
                  />
                  <span className="text-[15px]">
                    {v === 'everyone' ? t.settings.messagesEveryone : t.settings.messagesInteractions}
                  </span>
                </label>
              ))}
            </fieldset>
            <p className="text-text-2 mt-3 text-sm">{t.settings.privacyNote}</p>
          </Section>

          <Section title={t.settings.notifications}>
            <div className="divide-line divide-y">
              <Toggle
                checked={s.notify_messages}
                onChange={toggle('notify_messages')}
                label={t.settings.notifyMessages}
              />
              <Toggle
                checked={s.notify_requests}
                onChange={toggle('notify_requests')}
                label={t.settings.notifyRequests}
              />
              <Toggle
                checked={s.notify_offers}
                onChange={toggle('notify_offers')}
                label={t.settings.notifyOffers}
              />
              <Toggle
                checked={s.notify_listing_updates}
                onChange={toggle('notify_listing_updates')}
                label={t.settings.notifyListing}
              />
              <Toggle
                checked={s.notify_reports}
                onChange={toggle('notify_reports')}
                label={t.settings.notifyReports}
              />
            </div>
            <p className="text-text-2 mt-2 text-sm">{t.settings.pushNote}</p>
          </Section>

          <Section title={t.settings.blocks}>
            {!blocks.data?.length ? (
              <p className="text-text-2 text-sm">{t.settings.noBlocks}</p>
            ) : (
              <ul className="divide-line divide-y">
                {blocks.data.map((b) => (
                  <li key={b.blocked_id} className="flex items-center gap-3 py-2.5">
                    <Avatar path={b.profile?.avatar_path} name={b.profile?.display_name} size={36} />
                    <span className="min-w-0 flex-1 truncate font-medium">
                      {b.profile?.display_name ?? '—'}
                    </span>
                    <button
                      type="button"
                      className="btn-ghost min-h-10 text-sm"
                      disabled={setBlock.isPending}
                      onClick={() => setBlock.mutate({ userId: b.blocked_id, block: false })}
                    >
                      <UserX className="size-4" aria-hidden />
                      {t.profile.unblockUser}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title={t.settings.security}>
            <div className="flex flex-col gap-2">
              <Link to="/auth/reset" className="btn-secondary justify-start">
                <KeyRound className="size-5" aria-hidden />
                {t.settings.changePassword}
              </Link>
              <button
                type="button"
                className="btn-secondary justify-start"
                onClick={() => setLogoutAll(true)}
              >
                <LogOut className="size-5" aria-hidden />
                {t.settings.logoutAll}
              </button>
              <button
                type="button"
                className="btn-ghost text-danger justify-start"
                onClick={() => setDeleting(true)}
              >
                <Trash2 className="size-5" aria-hidden />
                {t.settings.deleteAccount}
              </button>
            </div>
          </Section>
        </>
      )}

      <Section title={t.settings.legal}>
        <div className="flex flex-wrap gap-x-5 gap-y-2 text-[15px]">
          <Link to="/terms" className="text-primary-ink underline">
            {t.auth.terms}
          </Link>
          <Link to="/privacy" className="text-primary-ink underline">
            {t.auth.privacy}
          </Link>
          <Link to="/rules" className="text-primary-ink underline">
            {t.nav.rules}
          </Link>
          <Link to="/safety" className="text-primary-ink underline">
            {t.nav.safety}
          </Link>
        </div>
      </Section>

      <ConfirmDialog
        open={logoutAll}
        title={t.settings.logoutAll}
        text={t.settings.logoutAllConfirm}
        confirmLabel={t.common.logout}
        onClose={() => setLogoutAll(false)}
        onConfirm={async () => {
          await signOut('global'); // revokes every refresh token of this user
          navigate('/', { replace: true });
        }}
      />
      {deleting && <DeleteAccountDialog onClose={() => setDeleting(false)} />}
    </div>
  );
}

function DeleteAccountDialog({ onClose }: { onClose: () => void }) {
  const t = useT();
  const toast = useToast();
  const navigate = useNavigate();
  const [word, setWord] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Modal
      open
      onClose={busy ? () => undefined : onClose}
      title={t.settings.deleteTitle}
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose} disabled={busy}>
            {t.common.cancel}
          </button>
          <button
            type="button"
            className="btn-danger"
            disabled={word !== 'УДАЛИТЬ' || busy}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                await deleteAccount(word);
                toast(t.settings.deleted);
                navigate('/', { replace: true });
              } catch (e) {
                setError(e instanceof Error ? e.message : errorMessage(e));
                setBusy(false);
              }
            }}
          >
            {busy && <Spinner className="size-4" />}
            {t.settings.deleteButton}
          </button>
        </>
      }
    >
      <div className="space-y-3 text-[15px]">
        <p className="font-semibold">{t.settings.deleteIntro}</p>
        <p>{t.settings.deleteRemoved}</p>
        <p>{t.settings.deleteAnonymized}</p>
        <p className="text-text-2">{t.settings.deleteRetained}</p>
        <label htmlFor="del-word" className="field-label pt-2">
          {t.settings.deleteTypeConfirm}
        </label>
        <input
          id="del-word"
          className="field-input"
          value={word}
          onChange={(e) => setWord(e.target.value)}
          autoComplete="off"
        />
        <InlineError error={error} />
      </div>
    </Modal>
  );
}
