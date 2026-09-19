// Probe 4 - with-code solve.
//
// Blind-solve (probe 1) answers "is the fix derivable from the prose". When the
// models all ask to see the code, it has no answer at all, and the dial falls
// back on an assumption: that asking for the code means the task is genuinely
// hard. That assumption is what this probe replaces with a measurement.
//
// The models get the repository files as they stood BEFORE the fix, with the
// touched files unlabelled among their siblings, and are asked to locate the
// defect the instruction describes. If they find it, it was not hard once the
// code was in hand - whatever they said when they could not see it.
//
// Runs only after probe 1. Showing the code first would destroy the blind
// measurement, which is the one already validated.

import { complete, extractJson, MODELS } from "./provider.ts";
import type { CodeBundle } from "./github.ts";

export interface WithCodeAnswer {
  model: string;
  /** The file the model says holds the defect. */
  file: string;
  /** What it says is wrong and how to fix it. */
  fix: string;
  /** The model's own report of whether it had to search or saw it at once. */
  obvious: boolean;
  /** Scored server-side: was that file actually touched by the PR? */
  correct: boolean;
}

export interface WithCodeResult {
  answers: WithCodeAnswer[];
  errors: Array<{ model: string; error: string }>;
  /** How many models named a file the PR actually changed. */
  located: number;
  attempted: number;
  /** Models shown this many files, of which this many were really touched. */
  bundle: { files: number; changed: number; decoys: number };
}

const SYSTEM = `You are given a task instruction and the contents of several files from a repository, exactly as they stood before anyone fixed anything.

Find the defect the instruction is describing. Exactly one of the files shown contains it, or the change belongs in one of them. The files are not labelled and most of them are irrelevant.

Report which file, and what the fix is. Also report honestly whether the defect was immediately obvious on reading, or whether you had to work through the code to find it - answer for what actually happened, not for what sounds impressive.

Reply with one JSON object and nothing else:

{
  "file": "the exact path of the file that needs to change",
  "fix": "one or two sentences: what is wrong and what the change is",
  "obvious": false
}`;

function renderBundle(bundle: CodeBundle): string {
  return bundle.files
    .map((f) => `----- FILE: ${f.path} -----\n${f.content}`)
    .join("\n\n");
}

async function askOne(
  prompt: string,
  bundle: CodeBundle,
  model: string,
  attempt = 0,
): Promise<WithCodeAnswer> {
  const user = [
    "TASK INSTRUCTION",
    prompt.trim(),
    "",
    `REPOSITORY FILES (${bundle.files.length} files, state before the fix)`,
    renderBundle(bundle),
  ].join("\n");

  // These are reasoning models and the bundle is large, so most of the budget
  // goes to thinking before a single character of answer is emitted. At 4000
  // all three returned completely empty completions - the budget was spent
  // before the JSON started. Reading a repository needs room to think.
  const res = await complete({
    model,
    system: SYSTEM,
    user,
    temperature: 0,
    maxTokens: attempt === 0 ? 24000 : 40000,
  });

  let p: { file?: string; fix?: string; obvious?: boolean };
  try {
    p = extractJson(res.text);
  } catch (e) {
    if (attempt === 0) return askOne(prompt, bundle, model, 1);
    throw new Error(
      res.text.trim() === ""
        ? `${model} returned an empty completion even at 40000 tokens; the bundle is probably too large for it.`
        : `${model} returned no JSON: ${res.text.slice(0, 200)}`,
    );
  }
  const file = String(p.file ?? "").trim();

  // Scored here, not by the model: it never learns which files were touched.
  const norm = (s: string) => s.replace(/^\.?\//, "").toLowerCase();
  const correct = bundle.changedPaths.some(
    (c) => norm(c) === norm(file) || norm(c).endsWith("/" + norm(file)) || norm(file).endsWith("/" + norm(c)),
  );

  return {
    model,
    file,
    fix: String(p.fix ?? "").trim(),
    obvious: Boolean(p.obvious),
    correct,
  };
}

export async function withCode(
  prompt: string,
  bundle: CodeBundle,
  models: readonly string[] = MODELS.probe1,
): Promise<WithCodeResult> {
  const settled = await Promise.allSettled(models.map((m) => askOne(prompt, bundle, m)));
  const answers: WithCodeAnswer[] = [];
  const errors: Array<{ model: string; error: string }> = [];
  settled.forEach((s, i) => {
    if (s.status === "fulfilled") answers.push(s.value);
    else errors.push({ model: models[i], error: String(s.reason?.message ?? s.reason) });
  });

  return {
    answers,
    errors,
    located: answers.filter((a) => a.correct).length,
    attempted: answers.length,
    bundle: {
      files: bundle.files.length,
      changed: bundle.changedPaths.length,
      decoys: bundle.files.length - bundle.changedPaths.length,
    },
  };
}
