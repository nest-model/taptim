#!/usr/bin/env bash
# Spins up a throwaway PostgreSQL cluster, applies the Supabase stub + all migrations,
# then runs the database security tests (RLS / IDOR / privilege escalation / state machines).
# Requires PostgreSQL 15+ server binaries (initdb, pg_ctl). Alternative: `supabase test db`.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIR="$ROOT/.db-test"
PORT="${TEST_DB_PORT:-54329}"
PGBIN="${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
export PATH="$PGBIN:$PATH"

# initdb refuses to run as root: drop to an unprivileged user in that case.
RUN=()
if [ "$(id -u)" = "0" ]; then RUN=(runuser -u "${PG_RUN_USER:-postgres}" --); fi

cleanup() { "${RUN[@]}" "$PGBIN/pg_ctl" -D "$DIR/data" -m immediate stop >/dev/null 2>&1 || true; }
trap cleanup EXIT

rm -rf "$DIR" && mkdir -p "$DIR/sock"
if [ "${#RUN[@]}" -gt 0 ]; then chown -R "${PG_RUN_USER:-postgres}" "$DIR"; fi
"${RUN[@]}" "$PGBIN/initdb" -D "$DIR/data" -U postgres --auth=trust --encoding=UTF8 --locale=C.UTF-8 >/dev/null
"${RUN[@]}" "$PGBIN/pg_ctl" -D "$DIR/data" -o "-p $PORT -k $DIR/sock -c listen_addresses=''" -l "$DIR/pg.log" -w start >/dev/null

PSQL=(psql -v ON_ERROR_STOP=1 -q -h "$DIR/sock" -p "$PORT" -U postgres)
"${PSQL[@]}" -d postgres -c "create database taptim_test" >/dev/null
"${PSQL[@]}" -d taptim_test -f "$ROOT/supabase/tests/supabase_stub.sql" >/dev/null
for f in "$ROOT"/supabase/migrations/*.sql; do
  echo "→ $(basename "$f")"
  "${PSQL[@]}" -d taptim_test -f "$f" >/dev/null
done

export DATABASE_URL="postgresql://postgres@localhost:$PORT/taptim_test?host=$DIR/sock"
if [ "${1:-}" = "--keep" ]; then
  echo "DATABASE_URL=$DATABASE_URL  (Ctrl+C to stop)"; trap - EXIT; exit 0
fi
cd "$ROOT" && npx vitest run tests/db
