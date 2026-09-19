// Probe 1 (blind solve) with probe 2 (recognition) folded into the same
// completion. SPEC section 4.
//
// Two rules are load-bearing and both live in the prompt order:
//
//   1. The model is never asked how hard the task is. It is asked to solve it.
//      Difficulty is measured from what the answers look like, not opined.
//   2. Recognition is asked AFTER the attempt. Asking first contaminates the
//      attempt - the model stops trying and starts remembering.

import { complete, extractJson, MODELS } from "./provider.ts";

export interface Attempt {
  /** Where the change goes: a path, or a symbol if no path is derivable. */
  file_or_symbol: string;
  /** What the change does, in one sentence. The semantics, not the diff. */
  semantic_change: string;
  /** True when the model says it cannot answer without reading the code. */
  needs_code: boolean;
}

export interface Recognition {
  recognized: boolean;
  /** The model's claim, verbatim. Quoted into the finding, never paraphrased. */
  claim: string;
  /** A PR, commit or repo the model named, if any. */
  named_reference: string;
}

export interface Probe1Response {
  model: string;
  attempt: Attempt;
  recognition: Recognition;
  raw: string;
}

const SYSTEM = `You are given the task instruction from a software benchmark, and nothing else: no repository, no file tree, no environment.

Do two things, strictly in this order.

FIRST, attempt the task. Produce the concrete fix you believe is correct. Commit to one answer. If the instruction genuinely does not determine where the change goes, say so by setting needs_code to true, but try first: "I would need to look at the code" is only acceptable when it is actually true, not as a way to avoid committing.

SECOND, and only after you have committed to an attempt, report whether you recognize this codebase, problem or upstream change. Answer honestly. If you do not recognize it, say so; do not guess at a plausible-sounding pull request.

You are never asked how difficult the task is. Do not rate it.

Reply with one JSON object and nothing else:

{
  "attempt": {
    "file_or_symbol": "the file path or symbol the change belongs in, as specifically as you can name it",
    "semantic_change": "one sentence describing what the change does",
    "needs_code": false
  },
  "recognition": {
    "recognized": false,
    "claim": "if you recognize it, state what you recognize in your own words; otherwise empty string",
    "named_reference": "the specific PR, commit or repository if you can name one; otherwise empty string"
  }
}`;

export async function probe1One(
  prompt: string,
  model: string,
  attempt = 0,
): Promise<Probe1Response> {
  // 1600 was not enough: three of twenty-one calls came back with the JSON cut
  // off mid-object, which the harness then counted as "the model did not
  // answer" and quietly dropped N from 3 to 2. A truncated reply is a harness
  // failure, not a data point, so the budget is generous and a parse failure
  // gets one retry with more room before it is reported as an error.
  const res = await complete({
    model,
    system: SYSTEM,
    user: prompt,
    temperature: 0,
    maxTokens: attempt === 0 ? 4000 : 8000,
  });

  let parsed: { attempt?: Partial<Attempt>; recognition?: Partial<Recognition> };
  try {
    parsed = extractJson(res.text);
  } catch (e) {
    if (attempt === 0) return probe1One(prompt, model, 1);
    throw e;
  }

  return {
    model,
    attempt: {
      file_or_symbol: String(parsed.attempt?.file_or_symbol ?? "").trim(),
      semantic_change: String(parsed.attempt?.semantic_change ?? "").trim(),
      needs_code: Boolean(parsed.attempt?.needs_code),
    },
    recognition: {
      recognized: Boolean(parsed.recognition?.recognized),
      claim: String(parsed.recognition?.claim ?? "").trim(),
      named_reference: String(parsed.recognition?.named_reference ?? "").trim(),
    },
    raw: res.text,
  };
}

/** N=3, run in parallel. A model that errors is reported, not silently dropped. */
export async function probe1(
  prompt: string,
  models: readonly string[] = MODELS.probe1,
): Promise<{ responses: Probe1Response[]; errors: Array<{ model: string; error: string }> }> {
  const settled = await Promise.allSettled(models.map((m) => probe1One(prompt, m)));
  const responses: Probe1Response[] = [];
  const errors: Array<{ model: string; error: string }> = [];
  settled.forEach((s, i) => {
    if (s.status === "fulfilled") responses.push(s.value);
    else errors.push({ model: models[i], error: String(s.reason?.message ?? s.reason) });
  });
  return { responses, errors };
}
