#!/usr/bin/env node
// G0 - the deterministic layer over an instruction.md, from the terminal.
//
// No API, no key, no network. This is Layer 1 of the SPEC and nothing more: it
// does NOT emit START. That verdict needs the probes (section 4), and a green
// here would be exactly the false green that section 1 calls worse than having
// no tool at all.
//
//   g0 <path>              instruction.md, or the directory containing it
//   g0 -                   read the prompt from stdin
//
//   --slug <s>        proposed slug; enables the task_name check
//   --timeout <n>     [agent].timeout_sec; enables the exact trailer check
//   --workdir <d>     the environment's WORKDIR (default /app)
//   --cites           show the rubric sentence behind each finding
//   --json            raw output for scripts
//
// Exit: 0 if there are no blockers, 1 if there is at least one.

import { readFileSync, existsSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { runStatic } from "../src/lib/checks/static.ts";
import type { Finding, Severity } from "../src/lib/checks/types.ts";

// ---------------------------------------------------------------------------
// presentation

const TTY = process.stdout.isTTY === true && !process.env.NO_COLOR;
const c = (code: string) => (s: string) => (TTY ? `\x1b[${code}m${s}\x1b[0m` : s);
const bold = c("1");
const dim = c("2");
const red = c("31");
const yellow = c("33");
const blue = c("34");
const green = c("32");

const SEV: Record<Severity, { label: string; paint: (s: string) => string; blurb: string }> = {
  blocker: {
    label: "BLOCKS",
    paint: red,
    blurb: "The review will flag this. Fix it before building.",
  },
  warn: {
    label: "RISK",
    paint: yellow,
    blurb: "A real risk that depends on context G0 cannot see. Your call.",
  },
  todo: {
    label: "PENDING",
    paint: blue,
    blurb: "Mechanical, from the packaging stage. Does not block a draft.",
  },
  info: { label: "NOTE", paint: dim, blurb: "A signal with no verdict." },
};

const ORDER: Severity[] = ["blocker", "warn", "todo", "info"];

function render(findings: Finding[], showCites: boolean): void {
  for (const sev of ORDER) {
    const group = findings.filter((f) => f.severity === sev);
    if (!group.length) continue;

    const { label, paint, blurb } = SEV[sev];
    console.log(`\n${paint(bold(label))} ${dim("- " + blurb)}\n`);

    for (const f of group) {
      const where = f.line ? dim(` (line ${f.line})`) : "";
      console.log(`  ${paint("*")} ${f.message}${where}`);
      if (f.excerpt) console.log(`    ${dim("at:")} ${JSON.stringify(f.excerpt)}`);
      if (f.fix) console.log(`    ${green("->")} ${f.fix}`);
      if (showCites) console.log(`    ${dim("rubric: " + f.rule)}`);
      console.log(`    ${dim(`[${f.criterion} / ${f.check}]`)}`);
      console.log();
    }
  }
}

// ---------------------------------------------------------------------------
// input

interface Args {
  path?: string;
  slug?: string;
  timeout?: number;
  workdir?: string;
  cites: boolean;
  json: boolean;
  help: boolean;
}

function parseArgs(argv: string[]): Args {
  const a: Args = { cites: false, json: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t === "--cites") a.cites = true;
    else if (t === "--json") a.json = true;
    else if (t === "-h" || t === "--help") a.help = true;
    else if (t === "--slug") a.slug = argv[++i];
    else if (t === "--workdir") a.workdir = argv[++i];
    else if (t === "--timeout") a.timeout = Number(argv[++i]);
    else if (!a.path) a.path = t;
  }
  return a;
}

const USAGE = `
G0 - deterministic check of a Terminal-Bench 4.0 prompt

  g0 <instruction.md | directory>
  cat prompt.md | g0 -

  --slug <s>       proposed slug (given a directory, its name is used)
  --timeout <n>    [agent].timeout_sec (read from task.toml if one sits alongside)
  --workdir <d>    the environment's WORKDIR (default /app)
  --cites          show the verbatim rubric sentence on each finding
  --json           raw output

Exits 0 if there are no blockers, 1 if there is at least one.
`;

/**
 * [agent].timeout_sec from a task.toml.
 *
 * This has to be section-aware: a real task.toml carries several `timeout_sec`
 * keys - [verifier] and [verifier.environment] both come BEFORE [agent] - and
 * grabbing the first one makes the trailer check compare against the wrong
 * number. That produced a false blocker on runner-failure-visibility, which is
 * one of the corpus positives.
 */
export function agentTimeout(toml: string): number | undefined {
  let inAgent = false;
  for (const raw of toml.split("\n")) {
    const line = raw.trim();
    if (line.startsWith("[")) {
      inAgent = line === "[agent]";
      continue;
    }
    if (!inAgent) continue;
    const m = line.match(/^timeout_sec\s*=\s*(\d+(?:\.\d+)?)/);
    if (m) return Number(m[1]);
  }
  return undefined;
}

/** [task].name from a task.toml, which is the slug the review sees. */
export function taskName(toml: string): string | undefined {
  let inTask = false;
  for (const raw of toml.split("\n")) {
    const line = raw.trim();
    if (line.startsWith("[")) {
      inTask = line === "[task]";
      continue;
    }
    if (!inTask) continue;
    const m = line.match(/^name\s*=\s*"([^"]+)"/);
    if (m) return m[1];
  }
  return undefined;
}

/** Resolves the input: a file, a task directory, or stdin. */
function load(p: string | undefined): { prompt: string; slug?: string; timeout?: number } {
  if (!p || p === "-") {
    return { prompt: readFileSync(0, "utf8") };
  }
  const abs = resolve(p);
  if (!existsSync(abs)) {
    console.error(`No such path: ${abs}`);
    process.exit(2);
  }

  // A task directory carries more context than a bare prompt: the directory
  // name IS the slug by TB convention, and the task.toml alongside it has the
  // timeout. Using both enables two checks that would otherwise stay mute.
  if (statSync(abs).isDirectory()) {
    const md = join(abs, "instruction.md");
    if (!existsSync(md)) {
      console.error(`No instruction.md in ${abs}`);
      process.exit(2);
    }
    const toml = join(abs, "task.toml");
    let timeout: number | undefined;
    let declared: string | undefined;
    if (existsSync(toml)) {
      const raw = readFileSync(toml, "utf8");
      timeout = agentTimeout(raw);
      declared = taskName(raw);
    }
    // [task].name wins over the directory. A delivery bundle puts the task in a
    // fixed folder - `harbor-task` - so the directory name says nothing about
    // the slug that will actually be reviewed.
    return { prompt: readFileSync(md, "utf8"), slug: declared ?? basename(abs), timeout };
  }

  return { prompt: readFileSync(abs, "utf8") };
}

// ---------------------------------------------------------------------------

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(USAGE.trim());
    return;
  }

  const src = load(args.path);
  const prompt = src.prompt;
  if (!prompt.trim()) {
    console.error("The prompt is empty.");
    process.exit(2);
  }

  const slug = args.slug ?? src.slug;
  const res = runStatic({
    prompt,
    slug,
    agentTimeoutSec: args.timeout ?? src.timeout,
    workingDir: args.workdir,
  });

  if (args.json) {
    console.log(JSON.stringify({ ...res, slug }, null, 2));
    process.exit(res.findings.some((f) => f.severity === "blocker") ? 1 : 0);
  }

  const n = (s: Severity) => res.findings.filter((f) => f.severity === s).length;
  const blockers = n("blocker");

  console.log(bold(`\nG0 / deterministic layer`));
  console.log(
    dim(
      `${args.path && args.path !== "-" ? args.path : "stdin"}` +
        `${slug ? ` / slug '${slug}'` : ""} / ${res.signals.words} words`,
    ),
  );

  if (!res.findings.length) {
    console.log(green("\nNo findings in the deterministic layer."));
  } else {
    render(res.findings, args.cites);
  }

  console.log(
    `${bold("Summary:")} ${blockers} blocking / ${n("warn")} risks / ${n("todo")} pending packaging`,
  );

  // What this layer does NOT decide. Without this, "no findings" reads as
  // permission to build, and that is the false green of SPEC section 1.
  console.log(
    dim(
      "\nThis is Layer 1: what a regex can prove. It does not say whether to\n" +
        "start - difficulty, novelty and derivability are decided by the probes,\n" +
        "which do not exist yet. A zero here is not a green light.",
    ),
  );
  if (!args.cites) console.log(dim("Use --cites to see the rubric sentence behind each finding."));

  process.exit(blockers > 0 ? 1 : 0);
}

// Only runs when invoked directly. Without this, importing the module - a
// test, or the future API route - fires main() and hangs reading stdin.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
