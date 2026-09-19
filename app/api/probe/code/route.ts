// POST /api/probe/code
//
// The with-code reading, on its own endpoint. Combined with the blind probe in
// one request it ran past the timeout: three reasoning models reading a
// repository is minutes of work, not seconds. Splitting it also matches how it
// is used - the blind reading comes back fast and this one is asked for.

import { NextResponse } from "next/server";
import { backendConfigured, MODELS } from "../../../../src/lib/probes/provider.ts";
import { bundleFromPr } from "../../../../src/lib/probes/github.ts";
import { withCode } from "../../../../src/lib/probes/withcode.ts";
import { deriveCodeDial, type ProbeReport } from "../../../../src/lib/dial.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 800;

export async function POST(req: Request) {
  if (!backendConfigured()) {
    return NextResponse.json({ error: "No model key configured on the server." }, { status: 503 });
  }

  let prompt = "";
  let prUrl = "";
  try {
    const body = (await req.json()) as { prompt?: unknown; prUrl?: unknown };
    prompt = String(body.prompt ?? "");
    prUrl = String(body.prUrl ?? "").trim();
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }
  if (!prompt.trim()) return NextResponse.json({ error: "The prompt is empty." }, { status: 400 });
  if (!prUrl) return NextResponse.json({ error: "A pull request URL is required." }, { status: 400 });

  let bundle;
  try {
    bundle = await bundleFromPr(prUrl);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 400 },
    );
  }

  // The cross-vendor pair rather than all three: this is the project's standard
  // for a judgement that has to be independent, and a third reasoning pass over
  // the same repository buys little for the minute it costs.
  const wc = await withCode(prompt, bundle, MODELS.consensus);

  const code: NonNullable<ProbeReport["code"]> = {
    repo: `${bundle.owner}/${bundle.repo}`,
    number: bundle.number,
    title: bundle.title,
    baseSha: bundle.baseSha.slice(0, 10),
    files: wc.bundle.files,
    decoys: wc.bundle.decoys,
    notes: bundle.notes,
    located: wc.located,
    attempted: wc.attempted,
    answers: wc.answers,
    errors: wc.errors,
  };

  return NextResponse.json({ codeDial: deriveCodeDial(wc), code });
}
