// G0's output contract. Stable: the UI, the evaluation harness and the
// generated documentation all read exactly this.

/**
 * blocker : the prompt is wrong and the review will flag it. Fix it before
 *           building.
 * warn    : a real risk, but it depends on context G0 cannot see. The author
 *           decides.
 * todo    : mechanical, and belongs to the packaging stage. The team's tool
 *           covers it. Does not block someone still drafting the prompt.
 * info    : a signal with no verdict. Feeds the probe layer.
 */
export type Severity = "blocker" | "warn" | "todo" | "info";

export type Verdict = "pass" | "fail" | "unknown" | "na";

/** Where each criterion gets decided. See SPEC.md section 2. */
export type Scope = "decide" | "advise" | "out";

export interface Finding {
  /** Criterion name from rubric/task-implementation.toml. */
  criterion: string;
  /** Identifier of the check that produced it. */
  check: string;
  severity: Severity;
  /** 1-indexed over the prompt exactly as the author pasted it. */
  line?: number;
  /** The exact fragment that triggered the finding. */
  excerpt?: string;
  /** What is wrong, in one sentence. */
  message: string;
  /** What to do about it. Absent when there is no mechanical action. */
  fix?: string;
  /**
   * The rubric sentence or canonical check that justifies the finding.
   * No check may exist without this: the tool predicts the review the task is
   * going to receive, it does not invent criteria of its own.
   */
  rule: string;
}

export interface PromptInput {
  /** The text the author pasted. */
  prompt: string;
  /** Proposed slug, if there is one. Enables the task_name check. */
  slug?: string;
  /** [agent].timeout_sec, if already decided. Enables the exact trailer check. */
  agentTimeoutSec?: number;
  /** The environment's WORKDIR. Defaults to /app, same as the canonical check. */
  workingDir?: string;
}

export interface StaticResult {
  findings: Finding[];
  /** Per-criterion verdict, derived from the findings. */
  byCriterion: Record<string, Verdict>;
  /** Signals with no verdict, consumed by the probe layer. */
  signals: Record<string, number | string | boolean>;
}
