// CLI <-> API parity.
//
// The web must not drift from what was measured. eval/run-static.ts measures
// the check layer and SPEC section 7 reports those numbers; if the API route
// ever reimplemented, wrapped or reordered any of it, that table would stop
// describing the web and nothing would say so.
//
// So: the same prompt goes through the CLI exactly as a person runs it (a real
// subprocess, `--json`) and through the API route handler, and the findings
// must be identical.
//
//   npx tsx --test cli/parity.test.ts

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { POST } from "../app/api/check/route.ts";
import type { Finding } from "../src/lib/checks/types.ts";

const here = fileURLToPath(new URL(".", import.meta.url));
const CLI = join(here, "g0.ts");
const CORPUS = JSON.parse(
  readFileSync(new URL("../corpus/corpus.json", import.meta.url), "utf8"),
) as { tasks: Array<{ id: string; prompt_raw: string; metadata: Record<string, unknown> }> };

/**
 * Node only strips types natively from 22.6. Below that the CLI is run the way
 * the README says to run it there, through tsx, so this test exercises the real
 * command on either runtime instead of quietly skipping.
 */
function runCli(file: string): { findings: Finding[] } {
  const [maj, min] = process.versions.node.split(".").map(Number);
  const native = maj > 22 || (maj === 22 && min >= 6);

  const r = native
    ? spawnSync(process.execPath, ["--experimental-strip-types", CLI, file, "--json"], {
        encoding: "utf8",
      })
    : spawnSync("npx", ["--yes", "tsx", CLI, file, "--json"], {
        encoding: "utf8",
        shell: process.platform === "win32",
      });

  // The CLI exits 1 when there are blockers; that is success for our purposes.
  if (r.stdout.trim() === "") {
    throw new Error(`CLI produced no output. status=${r.status} stderr=${r.stderr}`);
  }
  return JSON.parse(r.stdout) as { findings: Finding[] };
}

async function runApi(prompt: string, slug?: string): Promise<{ findings: Finding[] }> {
  const res = await POST(
    new Request("http://localhost/api/check", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt, slug }),
    }),
  );
  assert.equal(res.status, 200);
  return (await res.json()) as { findings: Finding[] };
}

// Real corpus prompts, chosen to exercise different verdict paths: a clean
// positive, the input-path blocker, and two novel/concision cases.
const CASES = [
  "runner-failure-visibility",
  "vllm-deepseek-streaming",
  "raman-fitting",
  "prove-plus-comm",
];

for (const id of CASES) {
  test(`CLI and API agree on ${id}`, async () => {
    const task = CORPUS.tasks.find((t) => t.id === id);
    assert.ok(task, `${id} missing from corpus.json`);

    // The CLI takes a bare file, so no slug is inferred; pass none to the API
    // either, otherwise the two would legitimately differ on task_name.
    const dir = mkdtempSync(join(tmpdir(), "g0-parity-"));
    const file = join(dir, "instruction.md");
    writeFileSync(file, task.prompt_raw, "utf8");

    const cli = runCli(file);
    const api = await runApi(task.prompt_raw);

    assert.deepEqual(
      api.findings,
      cli.findings,
      `API and CLI disagree on ${id}. The web has drifted from the measured layer.`,
    );
  });
}

test("a slug reaches the same checks on both sides", async () => {
  const prompt = "Fix the thing.\n";
  const dir = mkdtempSync(join(tmpdir(), "g0-parity-slug-"));
  const file = join(dir, "instruction.md");
  writeFileSync(file, prompt, "utf8");

  const [maj, min] = process.versions.node.split(".").map(Number);
  const native = maj > 22 || (maj === 22 && min >= 6);
  const args = [file, "--slug", "way-too-many-tokens-here", "--json"];
  const r = native
    ? spawnSync(process.execPath, ["--experimental-strip-types", CLI, ...args], {
        encoding: "utf8",
      })
    : spawnSync("npx", ["--yes", "tsx", CLI, ...args], {
        encoding: "utf8",
        shell: process.platform === "win32",
      });
  const cli = JSON.parse(r.stdout) as { findings: Finding[] };
  const api = await runApi(prompt, "way-too-many-tokens-here");

  assert.ok(
    cli.findings.some((f) => f.check === "slug-tokens"),
    "expected the CLI to flag the slug",
  );
  assert.deepEqual(api.findings, cli.findings);
});
