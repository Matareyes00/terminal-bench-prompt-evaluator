// CSV export of the evaluation records. Same obscure path as the view.

import { list, dbConfigured } from "../../../src/lib/db.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** RFC 4180: quote everything, double the inner quotes. Prompts have commas and newlines. */
function cell(v: unknown): string {
  if (v === null || v === undefined) return '""';
  return `"${String(v).replace(/"/g, '""')}"`;
}

const HEADERS = [
  "id",
  "created_at",
  "slug",
  "agent_timeout_sec",
  "verdict",
  "blockers",
  "warns",
  "todos",
  "model",
  "prompt",
  "findings_json",
];

export async function GET() {
  if (!dbConfigured()) {
    return new Response("No database configured; nothing has been stored.\n", {
      status: 503,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }

  const rows = await list(10000);
  const lines = [HEADERS.join(",")];
  for (const r of rows) {
    lines.push(
      [
        cell(r.id),
        cell(new Date(r.created_at).toISOString()),
        cell(r.slug),
        cell(r.agent_timeout_sec),
        cell(r.verdict),
        cell(r.blockers),
        cell(r.warns),
        cell(r.todos),
        cell(r.model),
        cell(r.prompt),
        cell(JSON.stringify(r.findings)),
      ].join(","),
    );
  }

  const stamp = new Date().toISOString().slice(0, 10);
  return new Response("﻿" + lines.join("\r\n") + "\r\n", {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="g0-evaluations-${stamp}.csv"`,
    },
  });
}
