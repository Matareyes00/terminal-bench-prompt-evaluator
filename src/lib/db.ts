// Persistence for evaluations. SPEC section 9.2.
//
// Stores prompt, verdict, findings, timestamp and a model column that stays
// null until the probes exist.
//
// Degrades on purpose: with no connection string configured, `save` returns
// false instead of throwing, and the API still answers. A check that works is
// worth more than a check that refuses to run because a database is missing,
// and the response says whether the row was stored so nobody assumes it was.

// `pg` is CommonJS and its exports are assigned dynamically, so Node's ESM
// named-export detection does not find `Pool`. The bundler resolves it either
// way, but the CLI-side tests import this module under plain ESM. Default
// import and destructure, which works in both.
import pg from "pg";
import type { Pool as PgPool } from "pg";
import type { Finding } from "./checks/types.ts";

const { Pool } = pg;

export interface EvaluationRow {
  id: number;
  created_at: string;
  prompt: string;
  slug: string | null;
  agent_timeout_sec: number | null;
  verdict: string;
  blockers: number;
  warns: number;
  todos: number;
  findings: Finding[];
  model: string | null;
}

function connectionString(): string | undefined {
  return (
    process.env.POSTGRES_URL ??
    process.env.DATABASE_URL ??
    process.env.POSTGRES_PRISMA_URL ??
    undefined
  );
}

export function dbConfigured(): boolean {
  return Boolean(connectionString());
}

let pool: PgPool | undefined;
let ready: Promise<void> | undefined;

function getPool(): PgPool | undefined {
  const cs = connectionString();
  if (!cs) return undefined;
  pool ??= new Pool({
    connectionString: cs,
    ssl: cs.includes("localhost") ? undefined : { rejectUnauthorized: false },
    max: 1,
  });
  return pool;
}

/** Creates the table on first use, so deploying needs no migration step. */
function ensure(p: PgPool): Promise<void> {
  ready ??= p
    .query(
      `CREATE TABLE IF NOT EXISTS evaluations (
         id                BIGSERIAL PRIMARY KEY,
         created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
         prompt            TEXT        NOT NULL,
         slug              TEXT,
         agent_timeout_sec INTEGER,
         verdict           TEXT        NOT NULL,
         blockers          INTEGER     NOT NULL,
         warns             INTEGER     NOT NULL,
         todos             INTEGER     NOT NULL,
         findings          JSONB       NOT NULL,
         model             TEXT
       )`,
    )
    .then(() => undefined);
  return ready;
}

export async function save(row: {
  prompt: string;
  slug?: string;
  agentTimeoutSec?: number;
  verdict: string;
  blockers: number;
  warns: number;
  todos: number;
  findings: Finding[];
}): Promise<boolean> {
  const p = getPool();
  if (!p) return false;
  try {
    await ensure(p);
    await p.query(
      `INSERT INTO evaluations
         (prompt, slug, agent_timeout_sec, verdict, blockers, warns, todos, findings, model)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NULL)`,
      [
        row.prompt,
        row.slug ?? null,
        row.agentTimeoutSec ?? null,
        row.verdict,
        row.blockers,
        row.warns,
        row.todos,
        JSON.stringify(row.findings),
      ],
    );
    return true;
  } catch (e) {
    // Never fail the evaluation because storage failed.
    console.error("[db] save failed:", e instanceof Error ? e.message : e);
    return false;
  }
}

export async function list(limit = 200): Promise<EvaluationRow[]> {
  const p = getPool();
  if (!p) return [];
  try {
    await ensure(p);
    const r = await p.query<EvaluationRow>(
      `SELECT id, created_at, prompt, slug, agent_timeout_sec, verdict,
              blockers, warns, todos, findings, model
         FROM evaluations
        ORDER BY id DESC
        LIMIT $1`,
      [limit],
    );
    return r.rows;
  } catch (e) {
    console.error("[db] list failed:", e instanceof Error ? e.message : e);
    return [];
  }
}
