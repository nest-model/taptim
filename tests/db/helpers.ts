import { randomUUID } from 'node:crypto';
import pg from 'pg';

const url = process.env.DATABASE_URL;
export const dbAvailable = Boolean(url);

export const pool = new pg.Pool(url ? { connectionString: url, max: 4 } : undefined);

export type Q = <T extends pg.QueryResultRow = pg.QueryResultRow>(
  sql: string,
  params?: unknown[],
) => Promise<pg.QueryResult<T>>;

type Actor =
  | { role: 'anon' }
  | { role: 'authenticated'; uid: string }
  | { role: 'service_role' }
  | { role: 'superuser' };

/** Runs `fn` inside a transaction as the given actor — the same way PostgREST does it. */
export async function as<T>(actor: Actor, fn: (q: Q) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    if (actor.role !== 'superuser') {
      const claims =
        actor.role === 'authenticated' ? { sub: actor.uid, role: 'authenticated' } : { role: actor.role };
      await client.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(claims)]);
      await client.query(`set local role ${actor.role}`);
    }
    const q: Q = (sql, params) => client.query(sql, params as unknown[]);
    const result = await fn(q);
    await client.query('commit');
    return result;
  } catch (e) {
    await client.query('rollback').catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}

export const user = (uid: string): Actor => ({ role: 'authenticated', uid });
export const anon: Actor = { role: 'anon' };
export const service: Actor = { role: 'service_role' };
export const superuser: Actor = { role: 'superuser' };

export async function createUser(name = 'Тестовый пользователь'): Promise<string> {
  const id = randomUUID();
  await as(superuser, (q) =>
    q(`insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)`, [
      id,
      `${id.slice(0, 8)}@example.test`,
      { display_name: name, terms_version: '2026-10-13' },
    ]),
  );
  return id;
}

export async function makeRole(uid: string, role: 'moderator' | 'admin') {
  await as(superuser, (q) => q(`insert into public.user_roles (user_id, role) values ($1, $2)`, [uid, role]));
}

/** Resolves with the Postgres error (message/code) or fails the test if no error happened. */
export async function pgError(p: Promise<unknown>): Promise<{ message: string; code: string }> {
  try {
    await p;
  } catch (e) {
    const err = e as { message: string; code: string };
    return { message: err.message, code: err.code };
  }
  throw new Error('Expected a database error, but the operation succeeded');
}

export const today = () => new Date().toISOString().slice(0, 10);

export async function createListing(uid: string, overrides: Record<string, unknown> = {}): Promise<string> {
  const base: Record<string, unknown> = {
    type: 'giveaway',
    status: 'active',
    category_id: 'books',
    district_id: 'shym-abay',
    title: 'Учебники по математике',
    description: 'Отдам учебники за 9 класс, в хорошем состоянии.',
    item_condition: 'good',
    quantity: 1,
    ...overrides,
  };
  const keys = Object.keys(base);
  const cols = keys.join(', ');
  const vals = keys.map((_, i) => `$${i + 1}`).join(', ');
  const { rows } = await as(user(uid), (q) =>
    q<{ id: string }>(
      `insert into public.listings (${cols}) values (${vals}) returning id`,
      Object.values(base),
    ),
  );
  return rows[0]!.id;
}
