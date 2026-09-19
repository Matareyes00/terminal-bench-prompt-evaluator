// POST /api/check
//
// Imports the shared check layer. Nothing is reimplemented here: the findings
// this returns are the same objects cli/g0.ts prints, produced by the same
// `runStatic`. cli/parity.test.ts enforces that.

import { NextResponse } from "next/server";
import { evaluate } from "../../../src/lib/evaluate.ts";
import { save, dbConfigured } from "../../../src/lib/db.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Body {
  prompt?: unknown;
  slug?: unknown;
  agentTimeoutSec?: unknown;
}

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }

  const prompt = typeof body.prompt === "string" ? body.prompt : "";
  if (!prompt.trim()) {
    return NextResponse.json({ error: "The prompt is empty." }, { status: 400 });
  }

  const slug =
    typeof body.slug === "string" && body.slug.trim() ? body.slug.trim() : undefined;

  const rawTimeout = body.agentTimeoutSec;
  const parsedTimeout =
    typeof rawTimeout === "number"
      ? rawTimeout
      : typeof rawTimeout === "string" && rawTimeout.trim()
        ? Number(rawTimeout)
        : undefined;
  const agentTimeoutSec =
    parsedTimeout !== undefined && Number.isFinite(parsedTimeout) ? parsedTimeout : undefined;

  const result = evaluate({ prompt, slug, agentTimeoutSec });

  const stored = await save({
    prompt,
    slug,
    agentTimeoutSec,
    verdict: result.verdict,
    blockers: result.counts.blocker,
    warns: result.counts.warn,
    todos: result.counts.todo,
    findings: result.findings,
  });

  return NextResponse.json({
    ...result,
    // Say plainly whether the row was written, so a missing database never
    // looks like a successful save.
    storage: { configured: dbConfigured(), stored },
  });
}
