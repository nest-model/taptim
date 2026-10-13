import {
  SendHorizontal,
  ChevronLeft,
  CircleAlert,
  Clock,
  MessageCircle,
  ShieldAlert,
  Flag,
} from 'lucide-react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router';
import { usePublicProfile } from '@/api/account';
import {
  useConversation,
  useConversations,
  useMarkRead,
  useMessages,
  useSendMessage,
  type Message,
} from '@/api/chat';
import { useListing } from '@/api/listings';
import { ReportDialog } from '@/components/ReportDialog';
import { Avatar, EmptyState, ErrorState, PageHeader, PageLoader, Spinner } from '@/components/ui';
import { LIMITS } from '@/config/listing';
import { useT } from '@/i18n';
import { errorMessage } from '@/lib/errors';
import { formatDate, formatTime, relativeTime } from '@/lib/format';
import { URL_RE } from '@/lib/safe-link';
import { useAuth } from '@/providers/AuthProvider';
import { useToast } from '@/providers/ToastProvider';

export function ChatsPage() {
  const t = useT();
  const q = useConversations();
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title={t.chat.title} />
      {q.isPending ? (
        <ul className="space-y-2" aria-hidden>
          {Array.from({ length: 5 }, (_, i) => (
            <li key={i} className="skeleton h-[76px] rounded-2xl" />
          ))}
        </ul>
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : !q.data.length ? (
        <EmptyState icon={MessageCircle} title={t.chat.empty} text={t.chat.emptyHint} />
      ) : (
        <ul className="card divide-line divide-y overflow-hidden">
          {q.data.map((c) => (
            <li key={c.id}>
              <Link to={`/chats/${c.id}`} className="hover:bg-surface-2 flex items-center gap-3 px-4 py-3.5">
                <Avatar path={c.other_avatar} name={c.other_name} size={48} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <p className="truncate font-bold">
                      {c.other_deleted ? t.common.deletedUser : c.other_name}
                    </p>
                    <span className="text-text-2 ml-auto shrink-0 text-xs">
                      {relativeTime(c.last_message_at)}
                    </span>
                  </div>
                  {c.listing_title && (
                    <p className="text-primary-ink truncate text-xs font-semibold">{c.listing_title}</p>
                  )}
                  <p
                    className={`truncate text-sm ${c.unread_count ? 'text-text font-semibold' : 'text-text-2'}`}
                  >
                    {c.is_blocked ? t.chat.blockedBanner : (c.last_message_preview ?? '…')}
                  </p>
                </div>
                {!!c.unread_count && (
                  <span className="bg-primary text-on-primary flex h-6 min-w-6 items-center justify-center rounded-full px-1.5 text-xs font-bold">
                    {c.unread_count}
                  </span>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Renders URLs as inert, visibly marked text — never as clickable links (phishing protection). */
function SafeText({ text }: { text: string }) {
  const parts = text.split(new RegExp(`(${URL_RE.source})`, 'gi'));
  return (
    <>
      {parts.map((p, i) =>
        new RegExp(`^${URL_RE.source}$`, 'i').test(p) ? (
          <span key={i} className="bg-warning-soft text-warning rounded px-1" title="Ссылка не кликабельна">
            {p}
          </span>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </>
  );
}

export function ChatPage() {
  const { id } = useParams();
  const t = useT();
  const { user } = useAuth();
  const toast = useToast();
  const conv = useConversation(id);
  const msgs = useMessages(id);
  const send = useSendMessage(id ?? '');
  const markRead = useMarkRead();
  const inbox = useConversations();
  const meta = inbox.data?.find((c) => c.id === id);
  const otherId = conv.data
    ? conv.data.user_low === user?.id
      ? conv.data.user_high
      : conv.data.user_low
    : undefined;
  const other = usePublicProfile(otherId);
  const listing = useListing(conv.data?.listing_id ?? undefined);
  const [text, setText] = useState('');
  const [reportMsg, setReportMsg] = useState<Message | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);

  const list = useMemo(() => [...(msgs.data?.pages.flat() ?? [])].reverse(), [msgs.data]);
  const lastId = list[list.length - 1]?.id;

  // mark read when new messages arrive while the chat is open
  useEffect(() => {
    if (id && lastId) markRead.mutate(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, lastId]);

  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && atBottom.current) el.scrollTop = el.scrollHeight;
  }, [lastId]);

  if (conv.isPending || msgs.isPending) return <PageLoader />;
  if (conv.isError) return <ErrorState error={conv.error} onRetry={() => conv.refetch()} />;
  if (!conv.data) return <EmptyState icon={MessageCircle} title={t.common.notFoundTitle} />;

  const blocked = meta?.is_blocked ?? false;
  const deleted = other.data?.is_deleted ?? false;
  const disabled = blocked || deleted;

  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    const body = text.trim();
    if (!body || body.length > LIMITS.messageMax || disabled) return;
    setText('');
    atBottom.current = true;
    send.mutate(
      { body, clientId: crypto.randomUUID() },
      { onError: (err) => toast(errorMessage(err), 'error') },
    );
  };
  const retry = (m: Message) => send.mutate({ body: m.body, clientId: m.client_id });

  return (
    <div className="mx-auto flex h-[calc(100dvh-56px-96px-env(safe-area-inset-bottom))] max-w-2xl flex-col md:h-[calc(100dvh-56px-64px)]">
      <div className="border-line flex items-center gap-3 border-b pb-3">
        <Link to="/chats" className="icon-btn -ml-2" aria-label={t.common.back}>
          <ChevronLeft className="size-6" />
        </Link>
        <Avatar path={other.data?.avatar_path} name={other.data?.display_name} size={40} />
        <div className="min-w-0 flex-1">
          <Link to={otherId ? `/u/${otherId}` : '#'} className="block truncate font-bold">
            {deleted ? t.common.deletedUser : (other.data?.display_name ?? '…')}
          </Link>
          {listing.data && (
            <Link
              to={`/listing/${listing.data.listing.id}`}
              className="text-primary-ink block truncate text-xs font-semibold"
            >
              {t.chat.about}: {listing.data.listing.title}
            </Link>
          )}
        </div>
      </div>

      <div
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget;
          atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
        className="flex-1 space-y-1 overflow-y-auto py-3"
        aria-live="polite"
      >
        <p className="bg-info-soft text-info mx-auto mb-3 flex max-w-md items-start gap-2 rounded-2xl px-3.5 py-2.5 text-[13px]">
          <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          {t.chat.safetyBanner}
        </p>
        {msgs.hasNextPage && (
          <div className="flex justify-center">
            <button
              type="button"
              className="btn-ghost text-sm"
              onClick={() => msgs.fetchNextPage()}
              disabled={msgs.isFetchingNextPage}
            >
              {msgs.isFetchingNextPage && <Spinner className="size-4" />}
              {t.chat.loadOlder}
            </button>
          </div>
        )}
        {list.map((m, i) => {
          const mine = m.sender_id === user?.id;
          const day = formatDate(m.created_at);
          const prev = list[i - 1];
          const showDay = i === 0 || day !== formatDate(prev!.created_at);
          const firstOfGroup = showDay || prev?.sender_id !== m.sender_id;
          return (
            <div key={m.client_id ?? m.id} className={firstOfGroup ? 'pt-2' : ''}>
              {showDay && <p className="text-text-2 py-2 text-center text-xs font-semibold">{day}</p>}
              <div className={`group flex items-end gap-2 ${mine ? 'justify-end' : 'justify-start'}`}>
                {!mine && (
                  <span className={`shrink-0 ${firstOfGroup ? '' : 'invisible'}`} aria-hidden>
                    <Avatar path={other.data?.avatar_path} name={other.data?.display_name} size={28} />
                  </span>
                )}
                <div
                  className={`text-text max-w-[78%] rounded-[18px] px-3.5 pt-2 pb-1.5 text-[15px] leading-snug ${mine ? 'bg-bubble-out rounded-br-md' : 'border-line bg-surface rounded-bl-md border'} ${m.failed ? 'opacity-70' : ''}`}
                >
                  <p className="user-text">
                    <SafeText text={m.body} />
                  </p>
                  <p className="text-text-2 mt-0.5 flex items-center justify-end gap-1 text-[11px]">
                    {m.pending && <Clock className="size-3" aria-label={t.chat.sending} />}
                    {formatTime(m.created_at)}
                  </p>
                </div>
                {!mine && !m.pending && (
                  <button
                    type="button"
                    onClick={() => setReportMsg(m)}
                    className="text-text-2 rounded-full p-1.5 opacity-35 hover:opacity-100 focus:opacity-100 md:opacity-0 md:group-hover:opacity-100"
                    aria-label={t.chat.reportMessage}
                  >
                    <Flag className="size-3.5" />
                  </button>
                )}
              </div>
              {m.failed && (
                <p className="text-danger mt-1 flex items-center justify-end gap-1.5 text-xs">
                  <CircleAlert className="size-3.5" aria-hidden />
                  {t.chat.failed} ·{' '}
                  <button type="button" className="font-semibold underline" onClick={() => retry(m)}>
                    {t.chat.resend}
                  </button>
                </p>
              )}
            </div>
          );
        })}
      </div>

      {disabled ? (
        <p className="bg-surface-2 text-text-2 rounded-2xl p-4 text-center text-sm">
          {deleted ? t.chat.deletedBanner : t.chat.blockedBanner}
        </p>
      ) : (
        <form onSubmit={submit} className="flex items-end gap-2 pt-2">
          <label htmlFor="msg" className="sr-only">
            {t.chat.placeholder}
          </label>
          <textarea
            id="msg"
            rows={1}
            value={text}
            maxLength={LIMITS.messageMax}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                submit();
              }
            }}
            placeholder={t.chat.placeholder}
            className="field-input bg-surface max-h-36 min-h-12 resize-none rounded-[24px] px-4 py-3"
          />
          <button
            type="submit"
            className="bg-primary text-on-primary hover:bg-primary-hover flex size-12 shrink-0 items-center justify-center rounded-full transition-colors disabled:opacity-50"
            disabled={!text.trim()}
            aria-label={t.chat.send}
          >
            <SendHorizontal className="size-5" />
          </button>
        </form>
      )}
      {reportMsg && (
        <ReportDialog
          target={{ target_type: 'message', message_id: reportMsg.id }}
          onClose={() => setReportMsg(null)}
        />
      )}
    </div>
  );
}
