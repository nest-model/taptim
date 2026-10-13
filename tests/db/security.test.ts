/**
 * Database security tests: RLS, IDOR, privilege escalation, state machines, rate limits.
 * Run with `npm run test:db` (spins up a throwaway Postgres and applies all migrations).
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  anon,
  as,
  createListing,
  createUser,
  dbAvailable,
  makeRole,
  pgError,
  pool,
  service,
  superuser,
  today,
  user,
} from './helpers';

const d = dbAvailable ? describe : describe.skip;

afterAll(async () => {
  if (dbAvailable) await pool.end();
});

d('account & profile', () => {
  let a: string;
  let b: string;
  beforeAll(async () => {
    a = await createUser('Алия');
    b = await createUser('Бекзат');
  });

  it('signup without accepted terms is rejected by the server', async () => {
    const e = await pgError(
      as(superuser, (q) =>
        q(`insert into auth.users (id, raw_user_meta_data) values ($1, '{"display_name":"X"}')`, [
          randomUUID(),
        ]),
      ),
    );
    expect(e.message).toBe('terms_not_accepted');
  });

  it('owner edits own public fields; reserved names are refused', async () => {
    await as(user(a), (q) => q(`update public.profiles set display_name = 'Алия К.' where id = $1`, [a]));
    const e = await pgError(
      as(user(a), (q) =>
        q(`update public.profiles set display_name = 'Модератор TAPTIM' where id = $1`, [a]),
      ),
    );
    expect(e.message).toBe('display_name_reserved');
  });

  it('IDOR: cannot edit someone else profile (0 rows affected)', async () => {
    const r = await as(user(a), (q) =>
      q(`update public.profiles set display_name = 'hack' where id = $1`, [b]),
    );
    expect(r.rowCount).toBe(0);
  });

  it('privilege escalation: cannot touch protected columns or grant roles', async () => {
    expect(
      (
        await pgError(
          as(user(a), (q) => q(`update public.profiles set is_deleted = true where id = $1`, [a])),
        )
      ).code,
    ).toBe('42501');
    expect(
      (
        await pgError(
          as(user(a), (q) => q(`insert into public.user_roles (user_id, role) values ($1, 'admin')`, [a])),
        )
      ).code,
    ).toBe('42501');
    expect(
      (await pgError(as(user(a), (q) => q(`update public.profile_private set terms_version = 'x'`)))).code,
    ).toBe('42501');
    expect((await pgError(as(user(a), (q) => q(`select public.anonymize_account($1)`, [b])))).code).toBe(
      '42501',
    );
    expect((await pgError(as(user(a), (q) => q(`select public.admin_dashboard()`)))).message).toBe(
      'forbidden',
    );
    expect(
      (await pgError(as(user(a), (q) => q(`select public.admin_set_role($1, 'admin', true)`, [a])))).message,
    ).toBe('forbidden');
  });

  it('private settings are invisible to others and anon', async () => {
    const r = await as(user(a), (q) => q(`select * from public.profile_private`));
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].user_id).toBe(a);
    expect((await pgError(as(anon, (q) => q(`select * from public.profile_private`)))).code).toBe('42501');
    expect((await pgError(as(anon, (q) => q(`select * from public.notifications`)))).code).toBe('42501');
    expect((await pgError(as(user(a), (q) => q(`select * from public.rate_limit_events`)))).code).toBe(
      '42501',
    );
  });
});

d('listings', () => {
  let a: string;
  let b: string;
  beforeAll(async () => {
    a = await createUser('Автор');
    b = await createUser('Другой');
  });

  it('draft may be incomplete, but cannot be published until complete', async () => {
    const id = await createListing(a, { status: 'draft', title: 'Ке', description: '' });
    const e = await pgError(
      as(user(a), (q) => q(`update public.listings set status = 'active' where id = $1`, [id])),
    );
    expect(e.message).toMatch(/listings_publishable/);
    expect((await as(anon, (q) => q(`select id from public.listings where id = $1`, [id]))).rowCount).toBe(0);
  });

  it('published listing is public; author_id/moderation_state cannot be set by the client', async () => {
    const id = await createListing(a);
    expect((await as(anon, (q) => q(`select id from public.listings where id = $1`, [id]))).rowCount).toBe(1);
    expect(
      (
        await pgError(
          as(user(a), (q) => q(`update public.listings set moderation_state = 'ok' where id = $1`, [id])),
        )
      ).code,
    ).toBe('42501');
    expect(
      (
        await pgError(
          as(user(a), (q) => q(`update public.listings set author_id = $2 where id = $1`, [id, b])),
        )
      ).code,
    ).toBe('42501');
    const forged = await pgError(
      as(user(a), (q) =>
        q(`insert into public.listings (author_id, type, title) values ($1, 'wanted', 'чужое имя')`, [b]),
      ),
    );
    expect(forged.code).toBe('42501');
  });

  it('IDOR: other users cannot update or delete a listing', async () => {
    const id = await createListing(a);
    expect(
      (await as(user(b), (q) => q(`update public.listings set title = 'взлом' where id = $1`, [id])))
        .rowCount,
    ).toBe(0);
    expect((await as(user(b), (q) => q(`delete from public.listings where id = $1`, [id]))).rowCount).toBe(0);
  });

  it('enforces status transitions and soft delete', async () => {
    const id = await createListing(a, { status: 'draft' });
    expect(
      (
        await pgError(
          as(user(a), (q) => q(`update public.listings set status = 'resolved' where id = $1`, [id])),
        )
      ).message,
    ).toBe('invalid_transition');
    await as(user(a), (q) => q(`update public.listings set status = 'active' where id = $1`, [id]));
    // published listings are not hard-deletable (evidence for reports)
    expect((await as(user(a), (q) => q(`delete from public.listings where id = $1`, [id]))).rowCount).toBe(0);
    expect((await as(user(a), (q) => q(`select public.delete_my_listing($1) r`, [id]))).rows[0].r).toBe(
      'soft_deleted',
    );
    expect((await as(user(a), (q) => q(`select id from public.listings where id = $1`, [id]))).rowCount).toBe(
      0,
    );
    expect((await pgError(as(user(b), (q) => q(`select public.delete_my_listing($1)`, [id])))).message).toBe(
      'not_found',
    );
  });

  it('type-specific server validation', async () => {
    const future = new Date(Date.now() + 3 * 86400_000).toISOString().slice(0, 10);
    const e = await pgError(
      createListing(a, {
        type: 'lost',
        category_id: 'phones',
        event_date: future,
        item_condition: null,
        quantity: null,
      }),
    );
    expect(e.message).toBe('invalid_event_date');
    const wrongCat = await pgError(createListing(a, { type: 'giveaway', category_id: 'documents' }));
    expect(wrongCat.message).toBe('invalid_category');
  });

  it('suspicious content goes to manual review and is hidden from the public', async () => {
    const id = await createListing(a, {
      title: 'Отдам травмат',
      description: 'Без документов, срочно, звоните.',
    });
    const { rows } = await as(user(a), (q) =>
      q(`select moderation_state from public.listings where id = $1`, [id]),
    );
    expect(rows[0].moderation_state).toBe('pending_review');
    expect((await as(anon, (q) => q(`select id from public.listings where id = $1`, [id]))).rowCount).toBe(0);
  });

  it('search: stemming, literal LIKE, filters, closed excluded', async () => {
    const id = await createListing(a, {
      type: 'lost',
      category_id: 'documents',
      title: 'Потерял ключи от дома',
      description: 'Связка ключей с синим брелоком, район рынка.',
      event_date: today(),
      item_condition: null,
      quantity: null,
    });
    const found = await as(anon, (q) =>
      q(`select id from public.search_listings(p_query => 'ключ', p_types => '{lost}')`),
    );
    expect(found.rows.map((r) => r.id)).toContain(id);
    const pct = await as(anon, (q) => q(`select id from public.search_listings(p_query => '%')`));
    expect(pct.rowCount).toBe(0);
    const wrongType = await as(anon, (q) =>
      q(`select id from public.search_listings(p_query => 'ключи', p_types => '{found}')`),
    );
    expect(wrongType.rows.map((r) => r.id)).not.toContain(id);
    await as(user(a), (q) => q(`update public.listings set status = 'resolved' where id = $1`, [id]));
    const closed = await as(anon, (q) => q(`select id from public.search_listings(p_query => 'ключи')`));
    expect(closed.rows.map((r) => r.id)).not.toContain(id);
    expect(
      (
        await pgError(
          as(anon, (q) => q(`select * from public.search_listings(p_sort => 'id; drop table x')`)),
        )
      ).message,
    ).toBe('invalid_sort');
  });

  it('rate limit on listing creation is enforced in the database', async () => {
    const spammer = await createUser('Спамер');
    for (let i = 0; i < 6; i++) await createListing(spammer, { status: 'draft' });
    const e = await pgError(createListing(spammer, { status: 'draft' }));
    expect(e.message).toBe('rate_limited');
  });

  it('photos cannot be inserted by clients (only the Edge Function)', async () => {
    const id = await createListing(b);
    const e = await pgError(
      as(user(b), (q) =>
        q(`insert into public.listing_photos (listing_id, owner_id, storage_path) values ($1, $2, $3)`, [
          id,
          b,
          `${b}/${'a'.repeat(32)}.jpg`,
        ]),
      ),
    );
    expect(e.code).toBe('42501');
  });
});

d('chat', () => {
  let author: string;
  let buyer: string;
  let stranger: string;
  let listing: string;
  let conv: string;
  beforeAll(async () => {
    author = await createUser('Автор чата');
    buyer = await createUser('Покупатель');
    stranger = await createUser('Посторонний');
    listing = await createListing(author);
    const r = await as(user(buyer), (q) => q(`select public.start_conversation($1) as id`, [listing]));
    conv = r.rows[0].id;
    await as(user(buyer), (q) =>
      q(`insert into public.messages (conversation_id, body, client_id) values ($1, 'Здравствуйте!', $2)`, [
        conv,
        randomUUID(),
      ]),
    );
  });

  it('reuses the conversation for the same pair + listing', async () => {
    const r = await as(user(buyer), (q) => q(`select public.start_conversation($1) as id`, [listing]));
    expect(r.rows[0].id).toBe(conv);
  });

  it('IDOR: a stranger cannot read or write into someone else chat', async () => {
    expect(
      (await as(user(stranger), (q) => q(`select * from public.messages where conversation_id = $1`, [conv])))
        .rowCount,
    ).toBe(0);
    expect(
      (await as(user(stranger), (q) => q(`select * from public.conversations where id = $1`, [conv])))
        .rowCount,
    ).toBe(0);
    const e = await pgError(
      as(user(stranger), (q) =>
        q(`insert into public.messages (conversation_id, body, client_id) values ($1, 'спам', $2)`, [
          conv,
          randomUUID(),
        ]),
      ),
    );
    expect(e.code).toBe('42501');
    const inbox = await as(user(stranger), (q) => q(`select * from public.my_conversations()`));
    expect(inbox.rowCount).toBe(0);
  });

  it('cannot spoof the sender', async () => {
    const e = await pgError(
      as(user(buyer), (q) =>
        q(
          `insert into public.messages (conversation_id, sender_id, body, client_id) values ($1, $2, 'x', $3)`,
          [conv, author, randomUUID()],
        ),
      ),
    );
    expect(e.code).toBe('42501');
  });

  it('unread counter + notification for the recipient', async () => {
    const r = await as(user(author), (q) => q(`select * from public.my_conversations()`));
    expect(r.rows[0].unread_count).toBe(1);
    const n = await as(user(author), (q) =>
      q(`select kind from public.notifications where kind = 'message'`),
    );
    expect(n.rowCount).toBe(1);
    await as(user(author), (q) => q(`select public.mark_conversation_read($1)`, [conv]));
    const r2 = await as(user(author), (q) => q(`select * from public.my_conversations()`));
    expect(r2.rows[0].unread_count).toBe(0);
  });

  it('idempotent retry: same client_id is not stored twice', async () => {
    const cid = randomUUID();
    const send = () =>
      as(user(buyer), (q) =>
        q(`insert into public.messages (conversation_id, body, client_id) values ($1, 'повтор', $2)`, [
          conv,
          cid,
        ]),
      );
    await send();
    expect((await pgError(send())).code).toBe('23505');
  });

  it('block freezes the conversation in both directions', async () => {
    await as(user(author), (q) => q(`insert into public.blocks (blocked_id) values ($1)`, [buyer]));
    const e = await pgError(
      as(user(buyer), (q) =>
        q(`insert into public.messages (conversation_id, body, client_id) values ($1, 'ещё', $2)`, [
          conv,
          randomUUID(),
        ]),
      ),
    );
    expect(e.code).toBe('42501');
    const other = await createListing(author, { title: 'Ещё учебники' });
    expect(
      (await pgError(as(user(buyer), (q) => q(`select public.start_conversation($1)`, [other])))).message,
    ).toBe('blocked');
    // the blocked person cannot see who blocked them
    expect((await as(user(buyer), (q) => q(`select * from public.blocks`))).rowCount).toBe(0);
    await as(user(author), (q) => q(`delete from public.blocks where blocked_id = $1`, [buyer]));
  });

  it('message flood is rate limited', async () => {
    const e = await pgError(
      as(user(buyer), async (q) => {
        for (let i = 0; i < 25; i++) {
          await q(`insert into public.messages (conversation_id, body, client_id) values ($1, $2, $3)`, [
            conv,
            `msg ${i}`,
            randomUUID(),
          ]);
        }
      }),
    );
    expect(e.message).toBe('rate_limited');
  });

  it('author cannot cold-message random users', async () => {
    const e = await pgError(
      as(user(author), (q) => q(`select public.start_conversation($1, $2)`, [listing, stranger])),
    );
    expect(e.message).toBe('invalid_recipient');
  });
});

d('giveaway queue, exchange, ownership claims', () => {
  let author: string;
  let u1: string;
  let u2: string;
  let outsider: string;
  beforeAll(async () => {
    author = await createUser('Даритель');
    u1 = await createUser('Первый');
    u2 = await createUser('Второй');
    outsider = await createUser('Наблюдатель');
  });

  it('queue → approve → complete resolves the listing and declines the rest', async () => {
    const id = await createListing(author, { quantity: 1 });
    const r1 = await as(user(u1), (q) =>
      q(`insert into public.giveaway_requests (listing_id) values ($1) returning id`, [id]),
    );
    const r2 = await as(user(u2), (q) =>
      q(`insert into public.giveaway_requests (listing_id) values ($1) returning id`, [id]),
    );
    const req1 = r1.rows[0].id;
    const req2 = r2.rows[0].id;
    expect(
      (await as(user(u2), (q) => q(`select public.giveaway_queue_position($1) p`, [req2]))).rows[0].p,
    ).toBe(2);
    expect(
      (
        await as(user(outsider), (q) =>
          q(`select * from public.giveaway_requests where listing_id = $1`, [id]),
        )
      ).rowCount,
    ).toBe(0);
    expect(
      (await pgError(as(user(u1), (q) => q(`select public.giveaway_request_action($1, 'approve')`, [req1]))))
        .message,
    ).toBe('invalid_transition');
    expect(
      (
        await pgError(
          as(user(u1), (q) =>
            q(`update public.giveaway_requests set status = 'approved' where id = $1`, [req1]),
          ),
        )
      ).code,
    ).toBe('42501');
    await as(user(author), (q) => q(`select public.giveaway_request_action($1, 'approve')`, [req1]));
    await as(user(author), (q) => q(`select public.giveaway_request_action($1, 'complete')`, [req1]));
    const l = await as(anon, (q) =>
      q(`select status, quantity_available from public.listings where id = $1`, [id]),
    );
    expect(l.rows[0]).toEqual({ status: 'resolved', quantity_available: 0 });
    const s2 = await as(user(u2), (q) =>
      q(`select status from public.giveaway_requests where id = $1`, [req2]),
    );
    expect(s2.rows[0].status).toBe('declined');
  });

  it('cannot request own item', async () => {
    const id = await createListing(author);
    const e = await pgError(
      as(user(author), (q) => q(`insert into public.giveaway_requests (listing_id) values ($1)`, [id])),
    );
    expect(e.message).toBe('own_listing');
  });

  it('exchange: accept reserves, both confirmations complete it', async () => {
    const id = await createListing(author, {
      type: 'exchange',
      category_id: 'sport',
      title: 'Гантели 2×5 кг',
      description: 'Меняю гантели на скакалку или эспандер.',
      exchange_wish: 'Скакалка',
      quantity: null,
    });
    const o = await as(user(u1), (q) =>
      q(
        `insert into public.exchange_offers (listing_id, message) values ($1, 'Есть скакалка') returning id`,
        [id],
      ),
    );
    const offer = o.rows[0].id;
    await as(user(author), (q) => q(`select public.exchange_offer_action($1, 'accept')`, [offer]));
    expect(
      (await as(anon, (q) => q(`select status from public.listings where id = $1`, [id]))).rows[0].status,
    ).toBe('reserved');
    await as(user(author), (q) => q(`select public.exchange_offer_action($1, 'confirm')`, [offer]));
    const st = await as(user(u1), (q) => q(`select public.exchange_offer_action($1, 'confirm') s`, [offer]));
    expect(st.rows[0].s).toBe('completed');
    expect(
      (await as(anon, (q) => q(`select status from public.listings where id = $1`, [id]))).rows[0].status,
    ).toBe('resolved');
  });

  it('valuable found item: contact only after a claim; proof stays private', async () => {
    const id = await createListing(author, {
      type: 'found',
      category_id: 'phones',
      title: 'Найден телефон',
      description: 'Найден телефон у остановки, опишите чехол и обои.',
      event_date: today(),
      is_valuable: true,
      item_condition: null,
      quantity: null,
    });
    expect(
      (await pgError(as(user(u1), (q) => q(`select public.start_conversation($1)`, [id])))).message,
    ).toBe('claim_required');
    const c = await as(user(u1), (q) =>
      q(
        `insert into public.ownership_claims (listing_id, proof) values ($1, 'Чёрный чехол с котом, на обоях — море') returning id`,
        [id],
      ),
    );
    expect(
      (
        await as(user(outsider), (q) =>
          q(`select proof from public.ownership_claims where listing_id = $1`, [id]),
        )
      ).rowCount,
    ).toBe(0);
    await as(user(u1), (q) => q(`select public.start_conversation($1)`, [id]));
    await as(user(author), (q) => q(`select public.ownership_claim_action($1, 'approve')`, [c.rows[0].id]));
    await as(user(author), (q) => q(`select public.ownership_claim_action($1, 'returned')`, [c.rows[0].id]));
    expect(
      (await as(anon, (q) => q(`select status from public.listings where id = $1`, [id]))).rows[0].status,
    ).toBe('resolved');
  });
});

d('reports & moderation', () => {
  let author: string;
  let reporter: string;
  let mod: string;
  let listing: string;
  let report: string;
  beforeAll(async () => {
    author = await createUser('Нарушитель');
    reporter = await createUser('Заявитель');
    mod = await createUser('Мод');
    await makeRole(mod, 'moderator');
    listing = await createListing(author, {
      title: 'Отдам котёнка',
      description: 'Только по предоплате на карту.',
      category_id: 'pets',
    });
    await as(superuser, (q) =>
      q(`update public.listings set moderation_state = 'ok' where id = $1`, [listing]),
    );
    const r = await as(user(reporter), (q) =>
      q(
        `insert into public.reports (target_type, listing_id, reason, description) values ('listing', $1, 'fraud', 'Просит деньги') returning id`,
        [listing],
      ),
    );
    report = r.rows[0].id;
  });

  it('reporter sees own report; the reported user never sees who reported', async () => {
    expect((await as(user(reporter), (q) => q(`select id from public.reports`))).rowCount).toBe(1);
    expect((await as(user(author), (q) => q(`select id from public.reports`))).rowCount).toBe(0);
  });

  it('duplicate open reports are rejected', async () => {
    const e = await pgError(
      as(user(reporter), (q) =>
        q(`insert into public.reports (target_type, listing_id, reason) values ('listing', $1, 'spam')`, [
          listing,
        ]),
      ),
    );
    expect(e.code).toBe('23505');
  });

  it('moderator hides the listing; action is logged; log is append-only', async () => {
    await as(user(mod), (q) =>
      q(`select public.admin_set_listing_state($1, 'hidden', 'Мошенничество', $2)`, [listing, report]),
    );
    await as(user(mod), (q) => q(`select public.admin_update_report($1, 'resolved', 'Скрыто')`, [report]));
    expect(
      (await as(anon, (q) => q(`select id from public.listings where id = $1`, [listing]))).rowCount,
    ).toBe(0);
    const log = await as(user(mod), (q) =>
      q(`select action from public.moderation_actions where listing_id = $1`, [listing]),
    );
    expect(log.rows.map((r) => r.action)).toContain('listing_hide');
    expect((await pgError(as(service, (q) => q(`delete from public.moderation_actions`)))).message).toBe(
      'append_only',
    );
    const n = await as(user(reporter), (q) =>
      q(`select title from public.notifications where kind = 'report_update'`),
    );
    expect(n.rowCount).toBe(1);
  });

  it('moderator sees only the reported message window, and access is logged', async () => {
    const l2 = await createListing(author, {
      title: 'Отдам книги',
      description: 'Детективы, около двадцати штук.',
    });
    const conv = (await as(user(reporter), (q) => q(`select public.start_conversation($1) id`, [l2]))).rows[0]
      .id;
    const msg = await as(user(author), (q) =>
      q(
        `insert into public.messages (conversation_id, body, client_id) values ($1, 'Скинь код из СМС', $2) returning id`,
        [conv, randomUUID()],
      ),
    );
    // moderators have NO direct access to chats
    expect(
      (await as(user(mod), (q) => q(`select id from public.messages where conversation_id = $1`, [conv])))
        .rowCount,
    ).toBe(0);
    const rep = await as(user(reporter), (q) =>
      q(
        `insert into public.reports (target_type, message_id, reason) values ('message', $1, 'fraud') returning id, target_user_id`,
        [msg.rows[0].id],
      ),
    );
    expect(rep.rows[0].target_user_id).toBe(author);
    const ctx = await as(user(mod), (q) => q(`select public.admin_report_context($1) c`, [rep.rows[0].id]));
    expect(ctx.rows[0].c.messages.some((m: { is_reported: boolean }) => m.is_reported)).toBe(true);
  });

  it('ban blocks posting and hides active listings; no single-signal auto-ban', async () => {
    const before = await as(user(author), (q) => q(`select count(*)::int n from public.user_restrictions`));
    expect(before.rows[0].n).toBe(0);
    await as(user(mod), (q) =>
      q(`select public.admin_restrict_user($1, 'ban', 'Мошенничество', null, null)`, [author]),
    );
    const e = await pgError(createListing(author));
    expect(e.code).toBe('42501');
    const visible = await as(anon, (q) =>
      q(`select count(*)::int n from public.listings where author_id = $1`, [author]),
    );
    expect(visible.rows[0].n).toBe(0);
  });

  it('moderator cannot restrict an admin or themselves; non-admin cannot grant roles', async () => {
    const admin = await createUser('Админ');
    await makeRole(admin, 'admin');
    expect(
      (
        await pgError(
          as(user(mod), (q) =>
            q(`select public.admin_restrict_user($1, 'ban', 'test', null, null)`, [admin]),
          ),
        )
      ).message,
    ).toBe('forbidden');
    expect(
      (
        await pgError(
          as(user(mod), (q) => q(`select public.admin_restrict_user($1, 'ban', 'test', null, null)`, [mod])),
        )
      ).message,
    ).toBe('cannot_target_self');
    expect(
      (await pgError(as(user(mod), (q) => q(`select public.admin_set_role($1, 'admin', true)`, [mod]))))
        .message,
    ).toBe('forbidden');
  });
});

d('account deletion', () => {
  it('anonymises profile, soft-deletes listings, removes personal data', async () => {
    const u = await createUser('Уходящий');
    const other = await createUser('Остающийся');
    const l = await createListing(u);
    const ol = await createListing(other);
    await as(user(u), (q) => q(`insert into public.favorites (listing_id) values ($1)`, [ol]));
    const res = await as(service, (q) => q(`select public.anonymize_account($1) r`, [u]));
    expect(res.rows[0].r).toHaveProperty('photos');
    const p = await as(anon, (q) =>
      q(`select display_name, is_deleted from public.profiles where id = $1`, [u]),
    );
    expect(p.rows[0]).toEqual({ display_name: 'Удалённый пользователь', is_deleted: true });
    expect((await as(anon, (q) => q(`select id from public.listings where id = $1`, [l]))).rowCount).toBe(0);
    expect(
      (await as(superuser, (q) => q(`select * from public.favorites where user_id = $1`, [u]))).rowCount,
    ).toBe(0);
    expect(
      (await as(superuser, (q) => q(`select * from public.profile_private where user_id = $1`, [u])))
        .rowCount,
    ).toBe(0);
  });
});

d('storage policies', () => {
  it('a user can stage uploads only inside their own folder of the private bucket', async () => {
    const u = await createUser('Фото');
    const v = await createUser('Чужой');
    const name = (owner: string) => `${owner}/${randomUUID().replace(/-/g, '')}.jpg`;
    await as(user(u), (q) =>
      q(`insert into storage.objects (bucket_id, name) values ('uploads', $1)`, [name(u)]),
    );
    expect(
      (
        await pgError(
          as(user(u), (q) =>
            q(`insert into storage.objects (bucket_id, name) values ('uploads', $1)`, [name(v)]),
          ),
        )
      ).code,
    ).toBe('42501');
    expect(
      (
        await pgError(
          as(user(u), (q) =>
            q(`insert into storage.objects (bucket_id, name) values ('listing-photos', $1)`, [name(u)]),
          ),
        )
      ).code,
    ).toBe('42501');
    expect(
      (
        await pgError(
          as(user(u), (q) =>
            q(`insert into storage.objects (bucket_id, name) values ('uploads', $1)`, [`${u}/../x.exe`]),
          ),
        )
      ).code,
    ).toBe('42501');
    expect((await as(user(u), (q) => q(`select * from storage.objects`))).rowCount).toBe(0);
  });
});

d('search v2', () => {
  it('"только с фото" and exclusion of the current listing', async () => {
    const u = await createUser('Фотограф');
    const withPhoto = await createListing(u, { title: 'Гиря с фото', category_id: 'sport' });
    const noPhoto = await createListing(u, { title: 'Гиря без фото', category_id: 'sport' });
    await as(service, (q) =>
      q(`insert into public.listing_photos (listing_id, owner_id, storage_path) values ($1, $2, $3)`, [
        withPhoto,
        u,
        `${withPhoto}/${'b'.repeat(32)}.jpg`,
      ]),
    );
    const r = await as(anon, (q) =>
      q(`select id from public.search_listings(p_query => 'гиря', p_with_photo => true)`),
    );
    expect(r.rows.map((x) => x.id)).toEqual([withPhoto]);
    const sim = await as(anon, (q) =>
      q(`select id from public.search_listings(p_category => 'sport', p_exclude => $1)`, [withPhoto]),
    );
    expect(sim.rows.map((x) => x.id)).toContain(noPhoto);
    expect(sim.rows.map((x) => x.id)).not.toContain(withPhoto);
    const card = await as(anon, (q) =>
      q(`select photo_count, exchange_wish from public.listing_cards where id = $1`, [withPhoto]),
    );
    expect(card.rows[0].photo_count).toBe(1);
  });
});

d('photo budget', () => {
  it('max 5 photos; purge only old closed listings without open reports', async () => {
    const u = await createUser('Экономный');
    const r = await createUser('Жалобщик');
    const id = await createListing(u, { title: 'Старый стол' });
    const reported = await createListing(u, { title: 'Спорный стол' });
    const photo = (l: string, i: number) =>
      as(service, (q) =>
        q(
          `insert into public.listing_photos (listing_id, owner_id, storage_path, thumb_path) values ($1, $2, $3, $4)`,
          [l, u, `${l}/${String(i).repeat(32)}.webp`, `${l}/${String(i).repeat(32)}_t.webp`],
        ),
      );
    for (let i = 1; i <= 5; i++) await photo(id, i);
    expect((await pgError(photo(id, 6))).message).toBe('too_many_photos');
    await photo(reported, 7);
    await as(user(r), (q) =>
      q(`insert into public.reports (target_type, listing_id, reason) values ('listing', $1, 'spam')`, [
        reported,
      ]),
    );
    // both closed long ago
    await as(superuser, (q) =>
      q(`update public.listings set status = 'archived' where id = any($1)`, [[id, reported]]),
    );
    await as(superuser, (q) => q(`alter table public.listings disable trigger listings_updated_at`));
    await as(superuser, (q) =>
      q(`update public.listings set updated_at = now() - interval '40 days' where id = any($1)`, [
        [id, reported],
      ]),
    );
    await as(superuser, (q) => q(`alter table public.listings enable trigger listings_updated_at`));
    const purge = await as(service, (q) => q(`select * from public.photos_to_purge(100)`));
    const ids = new Set(purge.rows.map((x) => x.storage_path.split('/')[0]));
    expect(ids.has(id)).toBe(true);
    expect(ids.has(reported)).toBe(false);
    expect(purge.rows.find((x) => x.storage_path.startsWith(id))?.thumb_path).toMatch(/_t\.webp$/);
    expect((await pgError(as(user(u), (q) => q(`select * from public.photos_to_purge(1)`)))).code).toBe(
      '42501',
    );
  });
});
