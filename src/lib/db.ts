// Persistence for evaluations. SPEC section 9.2.
//
// Stores prompt, verdict, findings, timestamp and a model column that stays
// null until the probes exist.
//
// Two backends, picked from the environment, same shape as the model provider:
//
//   postgres  preferred, and what section 9.2 asks for. Used whenever
//             POSTGRES_URL / DATABASE_URL is set.
//   blob      fallback. Provisioning Postgres on Vercel goes through a
//             marketplace integration that needs a human to accept terms in a
//             browser, and waiting for that would have left the deployed web
//             storing nothing. Vercel Blob could be created and wired without
//             a human, so it is what runs today: one JSON object per
//             evaluation, listed newest-first.
//
// Attaching Postgres later needs no code change and no export/import dance for
// the reader: whichever backend is configured is the one that answers, and the
// UI says which. Blob rows do not migrate themselves, so the CSV export is the
// bridge if you switch.
//
// Degrades on purpose: with neither configured, `save` returns false instead of
// throwing, the API still answers, and the response says the row was not
// stored so nobody assumes it was.

// `pg` is CommonJS and its exports are assigned dynamically, so Node's ESM
// named-export detection does not find `Pool`. The bundler resolves it either
// way, but the CLI-side tests import this module under plain ESM. Default
// import and destructure, which works in both.
import pg from "pg";
import type { Pool as PgPool } from "pg";
import { put, get as blobGet, list as blobList } from "@vercel/blob";
import type { Finding } from "./checks/types.ts";

export type StorageBackend = "postgres" | "blob" | "none";

export interface EvaluationRow {
  id: number | string;
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

export interface NewEvaluation {
  prompt: string;
  slug?: string;
  agentTimeoutSec?: number;
  verdict: string;
  blockers: number;
  warns: number;
  todos: number;
  findings: Finding[];
}

const { Pool } = pg;

function connectionString(): string | undefined {
  return (
    process.env.POSTGRES_URL ??
    process.env.DATABASE_URL ??
    process.env.POSTGRES_PRISMA_URL ??
    undefined
  );
}

function blobToken(): string | undefined {
  return process.env.BLOB_READ_WRITE_TOKEN ?? undefined;
}

export function backend(): StorageBackend {
  if (connectionString()) return "postgres";
  if (blobToken()) return "blob";
  return "none";
}

export function dbConfigured(): boolean {
  return backend() !== "none";
}

// --------------------------------------------------------------------- postgres

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

async function savePostgres(p: PgPool, row: NewEvaluation): Promise<boolean> {
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
}

async function listPostgres(p: PgPool, limit: number): Promise<EvaluationRow[]> {
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
}

// ------------------------------------------------------------------------- blob

const PREFIX = "evaluations/";

/**
 * The key carries the timestamp so a plain lexicographic sort is a chronological
 * sort, and a random suffix so two evaluations in the same millisecond cannot
 * overwrite each other.
 */
function blobKey(now: Date): string {
  const rand = Math.random().toString(36).slice(2, 10);
  return `${PREFIX}${now.toISOString().replace(/[:.]/g, "-")}-${rand}.json`;
}

async function saveBlob(token: string, row: NewEvaluation): Promise<boolean> {
  const now = new Date();
  const body: EvaluationRow = {
    id: blobKey(now),
    created_at: now.toISOString(),
    prompt: row.prompt,
    slug: row.slug ?? null,
    agent_timeout_sec: row.agentTimeoutSec ?? null,
    verdict: row.verdict,
    blockers: row.blockers,
    warns: row.warns,
    todos: row.todos,
    findings: row.findings,
    model: null,
  };
  // Private: these are unpublished team prompts. A public blob URL is
  // world-readable by anyone who learns it, which is not a property we want
  // for this content even with unguessable keys.
  await put(body.id as string, JSON.stringify(body), {
    access: "private",
    token,
    contentType: "application/json",
    addRandomSuffix: false,
  });
  return true;
}

async function listBlob(token: string, limit: number): Promise<EvaluationRow[]> {
  const found: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await blobList({ prefix: PREFIX, token, cursor, limit: 1000 });
    found.push(...page.blobs.map((b) => b.pathname));
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor && found.length < 10000);

  // Keys are timestamp-prefixed, so this is newest-first without fetching.
  found.sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
  const wanted = found.slice(0, limit);

  // One fetch per record. Fine at this volume; if it stops being fine, that is
  // the signal to attach Postgres rather than to optimise this.
  const out: EvaluationRow[] = [];
  const CHUNK = 20;
  for (let i = 0; i < wanted.length; i += CHUNK) {
    const batch = await Promise.allSettled(
      wanted.slice(i, i + CHUNK).map(async (pathname) => {
        // Private blobs are not readable from their URL; the SDK authenticates.
        const r = await blobGet(pathname, { access: "private", token });
        if (!r || r.statusCode !== 200 || !r.stream) {
          throw new Error(`blob ${pathname}: not readable`);
        }
        return (await new Response(r.stream).json()) as EvaluationRow;
      }),
    );
    for (const r of batch) {
      if (r.status === "fulfilled") out.push(r.value);
      else console.error("[db] blob read failed:", r.reason);
    }
  }
  return out;
}

// ------------------------------------------------------------------------ public

export async function save(row: NewEvaluation): Promise<boolean> {
  try {
    const p = getPool();
    if (p) return await savePostgres(p, row);
    const t = blobToken();
    if (t) return await saveBlob(t, row);
    return false;
  } catch (e) {
    // Never fail the evaluation because storage failed.
    console.error("[db] save failed:", e instanceof Error ? e.message : e);
    return false;
  }
}

export async function list(limit = 200): Promise<EvaluationRow[]> {
  try {
    const p = getPool();
    if (p) return await listPostgres(p, limit);
    const t = blobToken();
    if (t) return await listBlob(t, limit);
    return [];
  } catch (e) {
    console.error("[db] list failed:", e instanceof Error ? e.message : e);
    return [];
  }
}
