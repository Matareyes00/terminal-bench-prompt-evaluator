// Does blind-solve convergence predict the human `novel` labels?
//
// This is the one measurement that can invalidate G0's premise, so it runs
// before anything is built on top of it (SPEC section 9.4). It reports the
// denominator at every step: the corpus has 63 tasks, but only 7 carry a human
// `novel` label, and that 7 is the denominator here.
//
//   npx tsx eval/run-probes.ts [--limit N] [--out FILE]
//
// Raw model output is written to eval/results/ so the numbers can be audited
// without paying for the run again.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { probe1 } from "../src/lib/probes/probe1.ts";
import { convergence } from "../src/lib/probes/convergence.ts";
import { MODELS, activeBackend, backendConfigured } from "../src/lib/probes/provider.ts";

interface Task {
  id: string;
  source: string;
  prompt_raw: string;
  prompt: string;
  labels: Record<string, string>;
}

const corpus = JSON.parse(
  readFileSync(new URL("../corpus/corpus.json", import.meta.url), "utf8"),
) as { tasks: Task[] };

const argv = process.argv.slice(2);
const limit = argv.includes("--limit") ? Number(argv[argv.indexOf("--limit") + 1]) : Infinity;
const outArg = argv.includes("--out") ? argv[argv.indexOf("--out") + 1] : undefined;

if (!backendConfigured()) {
  console.error(
    "No model key configured. Set OPENROUTER_API_KEY (or ANTHROPIC_API_KEY) in the environment.",
  );
  process.exit(2);
}

// The measurement set: tb2 tasks a human labelled on `novel`. Nothing else has
// authoritative ground truth for this question.
const labelled = corpus.tasks
  .filter((t) => t.source === "tb2" && (t.labels.novel === "pass" || t.labels.novel === "fail"))
  .slice(0, limit);

console.log(`backend: ${activeBackend()}`);
console.log(`probe 1 models (N=${MODELS.probe1.length}): ${MODELS.probe1.join(", ")}`);
console.log(`convergence judges: ${MODELS.consensus.join(", ")}`);
console.log(`\ncorpus: ${corpus.tasks.length} tasks`);
console.log(`labelled on novel: ${labelled.length}  <- this is the denominator`);
const nFail = labelled.filter((t) => t.labels.novel === "fail").length;
console.log(`  novel=fail (not novel): ${nFail}`);
console.log(`  novel=pass (novel):     ${labelled.length - nFail}\n`);

interface Row {
  id: string;
  truth: "pass" | "fail";
  answered: number;
  abstained: string[];
  largestCluster: number;
  converged: boolean;
  needsHuman: boolean;
  recognizedBy: string[];
  claims: Array<{ model: string; claim: string; named_reference: string }>;
  errors: Array<{ model: string; error: string }>;
}

const rows: Row[] = [];
const raw: unknown[] = [];

for (const t of labelled) {
  process.stdout.write(`  ${t.id.padEnd(30)} `);
  const { responses, errors } = await probe1(t.prompt);

  if (responses.length < 2) {
    console.log(`SKIPPED - only ${responses.length} model(s) answered`);
    rows.push({
      id: t.id,
      truth: t.labels.novel as "pass" | "fail",
      answered: responses.length,
      abstained: [],
      largestCluster: 0,
      converged: false,
      needsHuman: true,
      recognizedBy: [],
      claims: [],
      errors,
    });
    raw.push({ id: t.id, responses, errors });
    continue;
  }

  const conv = await convergence(responses);
  const recognizedBy = responses.filter((r) => r.recognition.recognized).map((r) => r.model);

  rows.push({
    id: t.id,
    truth: t.labels.novel as "pass" | "fail",
    answered: responses.length,
    abstained: conv.abstained,
    largestCluster: conv.largestCluster,
    converged: conv.converged,
    needsHuman: conv.needsHuman,
    recognizedBy,
    claims: responses
      .filter((r) => r.recognition.recognized)
      .map((r) => ({
        model: r.model,
        claim: r.recognition.claim,
        named_reference: r.recognition.named_reference,
      })),
    errors,
  });
  raw.push({ id: t.id, responses, convergence: conv });

  console.log(
    `truth=novel:${t.labels.novel.padEnd(4)} answered=${responses.length - conv.abstained.length}/${responses.length} ` +
      `cluster=${conv.largestCluster} converged=${String(conv.converged).padEnd(5)} ` +
      `recognized=${recognizedBy.length}` +
      (conv.abstained.length === responses.length ? "  [all abstained: agentic]" : "") +
      (conv.needsHuman ? "  [judges disagreed]" : ""),
  );
}

// --------------------------------------------------------------------------
// The number

console.log("\n" + "=".repeat(74));
console.log("DOES BLIND-SOLVE CONVERGENCE PREDICT THE HUMAN `novel` LABEL?");
console.log("=".repeat(74));

// A task whose judges disagreed has no convergence verdict; counting it either
// way would invent a data point. It leaves the denominator and is reported.
const dropped = rows.filter((r) => r.needsHuman || r.answered < 2);
const scored = rows.filter((r) => !r.needsHuman && r.answered >= 2);

// Abstention is not divergence. SPEC section 4 reads "the models ask to see the
// code" as genuinely agentic - a different verdict from "they disagreed with
// each other". Folding the two together would let an agentic task count as
// evidence that convergence predicts the label, so these are reported on their
// own and kept out of the 2x2.
const allAbstained = scored.filter((r) => r.abstained.length === r.answered);
const usable = scored.filter((r) => r.abstained.length < r.answered);

console.log(`\nlabelled on novel ......... ${rows.length}`);
console.log(`unusable .................. ${dropped.length}${
  dropped.length ? "  (" + dropped.map((d) => d.id).join(", ") + ")" : ""
}`);
console.log(`all models abstained ...... ${allAbstained.length}${
  allAbstained.length ? "  (" + allAbstained.map((d) => `${d.id}:novel=${d.truth}`).join(", ") + ")" : ""
}`);
console.log(`   ^ read as agentic, not as divergence; excluded from the table below`);
console.log(`usable .................... ${usable.length}  <- the real denominator`);

if (usable.length === 0) {
  console.log("\nNothing usable. No claim can be made.");
  process.exit(1);
}

// Hypothesis: convergence means the fix was derivable/memorized => novel=fail.
const tp = usable.filter((r) => r.converged && r.truth === "fail").length;
const fp = usable.filter((r) => r.converged && r.truth === "pass").length;
const fn = usable.filter((r) => !r.converged && r.truth === "fail").length;
const tn = usable.filter((r) => !r.converged && r.truth === "pass").length;

console.log("\n                      truth novel=fail   truth novel=pass");
console.log(`  converged                 ${String(tp).padStart(2)}                 ${String(fp).padStart(2)}`);
console.log(`  did not converge          ${String(fn).padStart(2)}                 ${String(tn).padStart(2)}`);

const pct = (n: number, d: number) => (d === 0 ? "n/a" : `${((100 * n) / d).toFixed(0)}% (${n}/${d})`);
console.log(`\n  precision (converged -> novel=fail): ${pct(tp, tp + fp)}`);
console.log(`  recall    (novel=fail caught):       ${pct(tp, tp + fn)}`);
console.log(`  agreement (diagonal):                ${pct(tp + tn, usable.length)}`);

const recognized = usable.filter((r) => r.recognizedBy.length > 0);
console.log(`\n  probe 2: models claimed recognition on ${recognized.length}/${usable.length} tasks`);
for (const r of recognized) {
  for (const c of r.claims) {
    console.log(`    ${r.id} [${c.model}] ${c.named_reference || "(no reference named)"}`);
    console.log(`      "${c.claim.slice(0, 150)}"`);
  }
}

console.log(
  `\nRead this with the denominator in view: ${usable.length} tasks, ` +
    `${usable.filter((r) => r.truth === "fail").length} of them novel=fail. ` +
    `At this size a clean split is signal; an ambiguous one cannot tell a false\n` +
    `premise apart from too little data, and must be reported as indeterminate.`,
);

const outDir = new URL("./results/", import.meta.url);
mkdirSync(outDir, { recursive: true });
const out = outArg ?? `probe1-${new Date().toISOString().slice(0, 10)}.json`;
writeFileSync(
  new URL(out, outDir),
  JSON.stringify({ models: MODELS, generated: new Date().toISOString(), rows, raw }, null, 2),
);
console.log(`\nraw output: eval/results/${out}`);
