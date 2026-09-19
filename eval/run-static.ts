// Measures the deterministic layer against the labelled corpus.
//
// Phase 1 gate: zero false positives on the TB4 positives.
// A false positive teaches the author to ignore the tool, which is worse than
// not having one.
//
//   node --experimental-strip-types eval/run-static.ts [--verbose]

import { readFileSync } from "node:fs";
import { runStatic } from "../src/lib/checks/static.ts";
import type { Verdict } from "../src/lib/checks/types.ts";

interface Task {
  id: string;
  source: string;
  prompt_raw: string;
  prompt: string;
  metadata: Record<string, unknown>;
  labels: Record<string, string>;
  labels_g0: Record<string, string>;
}

const corpus = JSON.parse(
  readFileSync(new URL("../corpus/corpus.json", import.meta.url), "utf8"),
) as { tasks: Task[]; scope: Record<string, string> };

const verbose = process.argv.includes("--verbose");

// Criteria the deterministic layer claims to decide.
// outcome_verified left the decidable set: it hinges on the tests, which G0
// never sees.
const DECIDED = ["instruction_concision", "task_name", "novel", "structured_data_schema"];

type Cell = { tp: number; fp: number; tn: number; fn: number };
const mat: Record<string, Cell> = {};
for (const c of DECIDED) mat[c] = { tp: 0, fp: 0, tn: 0, fn: 0 };

const falsePositives: Array<{ id: string; source: string; criterion: string; detail: string }> = [];
const falseNegatives: Array<{ id: string; source: string; criterion: string }> = [];

for (const t of corpus.tasks) {
  // Synthetic fixtures carry the slug in metadata; tb2 tasks use the dir name.
  const slug = (t.metadata.slug as string | undefined) ?? t.id;
  const res = runStatic({ prompt: t.prompt_raw, slug });

  for (const c of DECIDED) {
    const truth = t.labels[c] as Verdict | undefined;
    if (!truth) continue;
    const pred = res.byCriterion[c] ?? "pass";
    const cell = mat[c];
    if (truth === "fail" && pred === "fail") cell.tp++;
    else if (truth === "pass" && pred === "fail") {
      cell.fp++;
      falsePositives.push({
        id: t.id,
        source: t.source,
        criterion: c,
        detail: res.findings
          .filter((f) => f.severity === "blocker" && f.criterion === c)
          .map((f) => `${f.check}${f.line ? `:${f.line}` : ""} ${f.excerpt ?? ""}`)
          .join(" | "),
      });
    } else if (truth === "pass" && pred === "pass") cell.tn++;
    else if (truth === "fail" && pred === "pass") {
      cell.fn++;
      falseNegatives.push({ id: t.id, source: t.source, criterion: c });
    }
  }

  if (verbose) {
    const b = res.findings.filter((f) => f.severity === "blocker");
    const w = res.findings.filter((f) => f.severity === "warn");
    console.log(
      `\n${t.id}  [${t.source}]  ${res.signals.words}w  blockers=${b.length} warns=${w.length}`,
    );
    for (const f of [...b, ...w]) {
      console.log(`   ${f.severity.toUpperCase().padEnd(7)} ${f.check.padEnd(22)} ${f.message}`);
    }
  }
}

const pct = (n: number, d: number) => (d === 0 ? "  -  " : `${((100 * n) / d).toFixed(0).padStart(3)}%`);

console.log("\n====== Deterministic layer vs labelled corpus ======\n");
console.log("criterion                       n   TP  FP  TN  FN   precision  recall");
for (const c of DECIDED) {
  const { tp, fp, tn, fn } = mat[c];
  const n = tp + fp + tn + fn;
  if (n === 0) {
    console.log(`${c.padEnd(30)}  ${String(n).padStart(2)}    no labels`);
    continue;
  }
  console.log(
    `${c.padEnd(30)}  ${String(n).padStart(2)}   ${String(tp).padStart(2)}  ${String(fp).padStart(2)}  ${String(tn).padStart(2)}  ${String(fn).padStart(2)}     ${pct(tp, tp + fp)}     ${pct(tp, tp + fn)}`,
  );
}

const pos = corpus.tasks.filter((t) => t.source === "tb4-positive");
let gateFp = 0;
console.log(`\n-- Gate: false positives on the ${pos.length} TB4 positives --`);
for (const t of pos) {
  const res = runStatic({ prompt: t.prompt_raw, slug: (t.metadata.slug as string) ?? t.id });
  const b = res.findings.filter((f) => f.severity === "blocker");
  gateFp += b.length;
  console.log(
    `  ${t.id.padEnd(28)} blockers=${b.length}${b.length ? "  -> " + b.map((f) => `${f.check}${f.line ? ":" + f.line : ""}`).join(", ") : ""}`,
  );
}

if (falsePositives.length) {
  console.log("\n-- False positives (predicted FAIL, the label says pass) --");
  for (const f of falsePositives) console.log(`  ${f.id} [${f.source}] ${f.criterion}: ${f.detail}`);
}
if (falseNegatives.length) {
  console.log("\n-- False negatives (the label says fail, the layer missed it) --");
  for (const f of falseNegatives) console.log(`  ${f.id} [${f.source}] ${f.criterion}`);
}

console.log(
  `\nPHASE 1 GATE: ${gateFp === 0 ? "PASS" : "FAIL"} - ${gateFp} blockers on positives (required 0)`,
);
process.exit(gateFp === 0 ? 0 : 1);
