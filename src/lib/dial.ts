// The dial. SPEC section 5.
//
// It is derived from the probes, never asked for. No model is asked "how hard
// is this" - the reading comes from what three models actually did when handed
// the prompt with no code.
//
// There is no score. A number invites optimising the number, and what we want
// optimised is the task.

import type { Probe1Response } from "./probes/probe1.ts";
import type { ConvergenceResult } from "./probes/convergence.ts";

export type Direction = "raise" | "specify" | "ok" | "needs_human";

export interface Dial {
  direction: Direction;
  /** One line, for the headline. */
  headline: string;
  /** Why, in the terms of the rubric criterion that motivated it. */
  because: string;
  /** Rubric criteria this reading bears on. */
  criteria: string[];
  /** What the author should actually do. */
  action: string;
  /**
   * How much weight this carries. Stated on the page, not buried: the rule was
   * validated on 5 tasks, which is a 1-in-10 chance of being luck.
   */
  evidence: string;
}

const EVIDENCE =
  "Validated once, against the 7 corpus tasks carrying a human `novel` label. " +
  "5 produced a usable answer and it separated all 5 correctly — at that size " +
  "there is roughly a 1-in-10 chance of that happening by luck. Treat this as a " +
  "strong hint, not a verdict.";

export function deriveDial(
  responses: Probe1Response[],
  conv: ConvergenceResult,
): Dial {
  const answered = responses.length - conv.abstained.length;
  const recognisers = responses.filter((r) => r.recognition.recognized);

  // Judges disagreed. The project's rule everywhere else is that disagreement
  // is reported, never averaged, so it is reported here too.
  if (conv.needsHuman) {
    return {
      direction: "needs_human",
      headline: "The probes disagree",
      because:
        "Two judges looked at the same pair of answers and reached different conclusions about whether they are the same fix.",
      criteria: ["difficult", "agentic"],
      action:
        "Read the model answers below and decide yourself. A disagreement here usually means the prompt is ambiguous about where the work goes.",
      evidence: EVIDENCE,
    };
  }

  // Convergence: the fix was derivable from the prose, or memorised. Either
  // way the agent does not need the environment, which is the definition of
  // too easy for this benchmark.
  if (conv.converged) {
    const memorised = recognisers.length > 0;
    return {
      direction: "raise",
      headline: "Raise the difficulty",
      because: memorised
        ? `${conv.largestCluster} of ${answered} models produced the same concrete fix without seeing the code, and ${recognisers.length} said they recognise the problem. That is memorisation, whatever the upstream change is called.`
        : `${conv.largestCluster} of ${answered} models produced the same concrete fix without seeing the code. If the fix is derivable from the prose, the agent never has to explore the environment.`,
      criteria: memorised ? ["difficult", "novel", "agentic"] : ["difficult", "agentic"],
      action:
        "Make the task require something the prose cannot give away: state the symptom and let the agent locate the cause, or pick a problem whose fix is not a local transformation.",
      evidence: EVIDENCE,
    };
  }

  // Everyone asked to see the code. SPEC section 4 reads that as the good case.
  if (answered === 0) {
    return {
      direction: "ok",
      headline: "Genuinely agentic",
      because:
        "Every model asked to see the code rather than guess. The task cannot be done from the prose alone, which is what this benchmark is for.",
      criteria: ["agentic", "difficult"],
      action:
        "Nothing to change on this axis. Whether the difficulty is the real problem or clerical detail is a separate question the probes do not answer.",
      evidence: EVIDENCE,
    };
  }

  // One attempt and the rest abstaining is not divergence either: there is no
  // pair to compare, so there is no convergence evidence in any direction.
  // SPEC section 4 covers all-converge, all-diverge and all-abstain; this mix
  // is not one of them, and inventing a verdict for it would be exactly the
  // kind of unearned confidence the rest of the project refuses.
  if (answered === 1) {
    const only = responses.find((r) => !r.attempt.needs_code);
    return {
      direction: "needs_human",
      headline: "Not enough attempts to compare",
      because: `Only 1 of ${responses.length} models committed to a fix; the rest asked to see the code. One answer cannot converge or diverge with anything, so there is no reading here.`,
      criteria: ["difficult", "agentic"],
      action: only
        ? `Read the single attempt below. If it is close to the fix you have in mind, the prose is giving too much away; if it is not, the task is probably agentic enough.`
        : "Read the answers below.",
      evidence: EVIDENCE,
    };
  }

  // Answers, but no two agree: the prompt does not pin down the contract.
  return {
    direction: "specify",
    headline: "Specify the interface",
    because: `${answered} models each committed to a fix and no two of them agreed. That is not difficulty — it means the prompt leaves the contract open.`,
    criteria: ["essential_difficulty", "solvable"],
    action:
      "Pin down what is underdetermined: exact paths, output format, tolerances, units. A task that fails because the tolerance was never stated fails for the wrong reason.",
    evidence: EVIDENCE,
  };
}

/** Everything the probe endpoint returns, so the page can show the workings. */
export interface ProbeReport {
  dial: Dial;
  models: string[];
  answers: Array<{
    model: string;
    needsCode: boolean;
    place: string;
    change: string;
    recognized: boolean;
    claim: string;
    namedReference: string;
  }>;
  convergence: {
    largestCluster: number;
    answered: number;
    abstained: string[];
    pairs: Array<{ a: string; b: string; verdict: string; why: string[] }>;
  };
  errors: Array<{ model: string; error: string }>;
}
