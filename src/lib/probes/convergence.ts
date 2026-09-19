// Structural convergence. SPEC section 4.
//
// "Two answers converge if the place and the semantics match. Two models that
// write the same patch in different styles converge. Two that touch the same
// file for different reasons do not."
//
// That cannot be string comparison: comparing the text would measure prose
// style, which is the thing the rule exists to avoid. So a judge is asked, and
// asked about place and semantics separately, so "same file, different reason"
// cannot be scored as agreement.
//
// The judge is the cross-vendor pair, and they have to agree. If they do not,
// the pair is NEEDS_HUMAN rather than an average - same rule the rest of the
// project uses, for the same reason.

import { complete, extractJson, MODELS } from "./provider.ts";
import type { Attempt, Probe1Response } from "./probe1.ts";

export type PairVerdict = "converge" | "diverge" | "needs_human";

export interface PairJudgement {
  a: string;
  b: string;
  verdict: PairVerdict;
  /** What each judge said, kept so a NEEDS_HUMAN can be inspected. */
  votes: Array<{ judge: string; same_place: boolean; same_semantics: boolean; why: string }>;
}

export interface ConvergenceResult {
  /** Models that declined to answer blind. Not divergence - a different signal. */
  abstained: string[];
  pairs: PairJudgement[];
  /** Largest set of mutually converging answers. */
  largestCluster: number;
  /** SPEC: probe 2 escalates to blocker only when two models converge. */
  converged: boolean;
  needsHuman: boolean;
}

const JUDGE_SYSTEM = `Two models were each asked to fix the same task from its written instruction alone, with no access to the code. You are comparing their answers.

Decide two things separately.

same_place: do both answers put the change in the same place? Treat a file path and a symbol inside that file as the same place. Different wording for the same location is the same place.

same_semantics: do both changes do the same thing? Judge the effect, not the phrasing. Two descriptions of the same behavioural change in different words are the same semantics. Two changes to the same location that alter different behaviour are NOT the same semantics.

Do not reward similar writing style. Do not reward both answers merely sounding confident.

Reply with one JSON object and nothing else:

{"same_place": true, "same_semantics": true, "why": "one sentence"}`;

function describe(a: Attempt): string {
  return `place: ${a.file_or_symbol || "(none given)"}\nchange: ${a.semantic_change || "(none given)"}`;
}

async function judgePair(
  x: Probe1Response,
  y: Probe1Response,
  judges: readonly string[],
): Promise<PairJudgement> {
  const user = `ANSWER 1\n${describe(x.attempt)}\n\nANSWER 2\n${describe(y.attempt)}`;

  const settled = await Promise.allSettled(
    judges.map(async (judge) => {
      const res = await complete({
        model: judge,
        system: JUDGE_SYSTEM,
        user,
        temperature: 0,
        maxTokens: 400,
      });
      const p = extractJson<{ same_place?: boolean; same_semantics?: boolean; why?: string }>(
        res.text,
      );
      return {
        judge,
        same_place: Boolean(p.same_place),
        same_semantics: Boolean(p.same_semantics),
        why: String(p.why ?? "").trim(),
      };
    }),
  );

  const votes = settled
    .filter((s): s is PromiseFulfilledResult<PairJudgement["votes"][number]> => s.status === "fulfilled")
    .map((s) => s.value);

  if (votes.length === 0) {
    return { a: x.model, b: y.model, verdict: "needs_human", votes };
  }

  const calls = votes.map((v) => v.same_place && v.same_semantics);
  const allAgree = calls.every((c) => c === calls[0]);

  return {
    a: x.model,
    b: y.model,
    // A single surviving judge is not consensus, so it cannot claim one.
    verdict: votes.length < 2 ? "needs_human" : allAgree ? (calls[0] ? "converge" : "diverge") : "needs_human",
    votes,
  };
}

export async function convergence(
  responses: Probe1Response[],
  judges: readonly string[] = MODELS.consensus,
): Promise<ConvergenceResult> {
  // A model that says it needs the code has not diverged; it has reported that
  // the task is agentic. Mixing the two would read "genuinely agentic" as
  // "underspecified", which is the opposite verdict (SPEC section 4).
  const abstained = responses.filter((r) => r.attempt.needs_code).map((r) => r.model);
  const answered = responses.filter((r) => !r.attempt.needs_code);

  const pairs: PairJudgement[] = [];
  for (let i = 0; i < answered.length; i++) {
    for (let j = i + 1; j < answered.length; j++) {
      pairs.push(await judgePair(answered[i], answered[j], judges));
    }
  }

  // Largest mutually-converging group, over the models that actually answered.
  const ids = answered.map((r) => r.model);
  const linked = (a: string, b: string) =>
    pairs.some(
      (p) => p.verdict === "converge" && ((p.a === a && p.b === b) || (p.a === b && p.b === a)),
    );
  let largest = ids.length ? 1 : 0;
  for (let mask = 1; mask < 1 << ids.length; mask++) {
    const set = ids.filter((_, k) => mask & (1 << k));
    if (set.length <= largest) continue;
    let ok = true;
    for (let i = 0; ok && i < set.length; i++) {
      for (let j = i + 1; ok && j < set.length; j++) ok = linked(set[i], set[j]);
    }
    if (ok) largest = set.length;
  }

  return {
    abstained,
    pairs,
    largestCluster: largest,
    converged: largest >= 2,
    needsHuman: pairs.some((p) => p.verdict === "needs_human"),
  };
}
