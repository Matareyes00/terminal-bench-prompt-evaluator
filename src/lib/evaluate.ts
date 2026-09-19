// The one place an evaluation is defined. The API route and the CLI both go
// through `runStatic` from ./checks/static.ts — nothing is reimplemented on
// the web side. cli/parity.test.ts asserts the two produce identical findings,
// because if the web drifts from what was measured, the table in SPEC section
// 7 stops describing the web and nobody finds out.

import { runStatic } from "./checks/static.ts";
import type { Finding, PromptInput } from "./checks/types.ts";

/**
 * v0 has no dial. The probes are not wired, so there is no RAISE/LOWER and no
 * START — those need probe signal that does not exist yet (SPEC sections 4
 * and 5). All this reports is what Layer 1 saw.
 */
export type StaticVerdict = "blockers" | "clean";

export interface Evaluation {
  verdict: StaticVerdict;
  findings: Finding[];
  counts: { blocker: number; warn: number; todo: number; info: number };
  /** Criteria the deterministic layer can actually decide, out of `decidable`. */
  coverage: { decided: number; decidable: number };
  probesActive: false;
}

/**
 * Layer 1 decides 3 of the 15 criteria G0 claims to decide (SPEC section 7).
 * Carried in the payload so the UI cannot quietly present a clean result as
 * full coverage.
 */
export const COVERAGE = { decided: 3, decidable: 15 } as const;

export function evaluate(input: PromptInput): Evaluation {
  const res = runStatic(input);
  const counts = {
    blocker: res.findings.filter((f) => f.severity === "blocker").length,
    warn: res.findings.filter((f) => f.severity === "warn").length,
    todo: res.findings.filter((f) => f.severity === "todo").length,
    info: res.findings.filter((f) => f.severity === "info").length,
  };
  return {
    verdict: counts.blocker > 0 ? "blockers" : "clean",
    findings: res.findings,
    counts,
    coverage: { ...COVERAGE },
    probesActive: false,
  };
}
