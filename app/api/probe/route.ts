// POST /api/probe
//
// The difficulty reading: three models are handed the prompt with no code and
// asked to solve it, then asked separately whether they recognise it. The dial
// is derived from what they did (SPEC sections 4 and 5).
//
// Separate from /api/check on purpose. The deterministic layer is free and
// instant; this one costs money and takes the better part of a minute, so the
// author asks for it rather than paying for it on every keystroke.

import { NextResponse } from "next/server";
import { probe1 } from "../../../src/lib/probes/probe1.ts";
import { convergence } from "../../../src/lib/probes/convergence.ts";
import { MODELS, backendConfigured } from "../../../src/lib/probes/provider.ts";
import { deriveDial, type ProbeReport } from "../../../src/lib/dial.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: Request) {
  if (!backendConfigured()) {
    return NextResponse.json(
      { error: "No model key configured on the server, so the probes cannot run." },
      { status: 503 },
    );
  }

  let prompt = "";
  try {
    prompt = String(((await req.json()) as { prompt?: unknown }).prompt ?? "");
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }
  if (!prompt.trim()) {
    return NextResponse.json({ error: "The prompt is empty." }, { status: 400 });
  }

  const { responses, errors } = await probe1(prompt);

  // Two answers is the minimum for any convergence statement at all.
  if (responses.length < 2) {
    return NextResponse.json(
      {
        error: `Only ${responses.length} of ${MODELS.probe1.length} models answered, which is not enough to compare.`,
        errors,
      },
      { status: 502 },
    );
  }

  const conv = await convergence(responses);
  const dial = deriveDial(responses, conv);

  const report: ProbeReport = {
    dial,
    models: [...MODELS.probe1],
    answers: responses.map((r) => ({
      model: r.model,
      needsCode: r.attempt.needs_code,
      place: r.attempt.file_or_symbol,
      change: r.attempt.semantic_change,
      recognized: r.recognition.recognized,
      claim: r.recognition.claim,
      namedReference: r.recognition.named_reference,
    })),
    convergence: {
      largestCluster: conv.largestCluster,
      answered: responses.length - conv.abstained.length,
      abstained: conv.abstained,
      pairs: conv.pairs.map((p) => ({
        a: p.a,
        b: p.b,
        verdict: p.verdict,
        why: p.votes.map((v) => `${v.judge}: ${v.why}`),
      })),
    },
    errors,
  };

  return NextResponse.json(report);
}
