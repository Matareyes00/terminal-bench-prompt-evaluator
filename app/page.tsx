"use client";

import { useState } from "react";
import type { Finding, Severity } from "../src/lib/checks/types.ts";
import type { Evaluation } from "../src/lib/evaluate.ts";

type Result = Evaluation & { storage: { configured: boolean; stored: boolean } };

const SEV: Record<Severity, { heading: string; blurb: string }> = {
  blocker: {
    heading: "Blocks",
    blurb: "The review will flag this. Fix it before building.",
  },
  warn: {
    heading: "Risk",
    blurb: "A real risk that depends on context G0 cannot see. Your call.",
  },
  todo: {
    heading: "Pending packaging",
    blurb:
      "Mechanical, from the packaging stage. A draft prompt is not expected to have these yet.",
  },
  info: { heading: "Note", blurb: "A signal with no verdict." },
};

const ORDER: Severity[] = ["blocker", "warn", "todo", "info"];

export default function Page() {
  const [prompt, setPrompt] = useState("");
  const [slug, setSlug] = useState("");
  const [timeout_, setTimeout_] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/check", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          prompt,
          slug: slug || undefined,
          agentTimeoutSec: timeout_ || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(typeof data?.error === "string" ? data.error : "The check failed.");
      } else {
        setResult(data as Result);
      }
    } catch {
      setError("Could not reach the check endpoint.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="wrap">
      <header>
        <h1>G0 — Terminal-Bench 4.0 prompt check</h1>
        <p>Paste the instruction you are thinking of building.</p>
      </header>

      <div className="banner">
        <strong>This does not approve tasks, and it has no difficulty dial yet.</strong>{" "}
        Only the deterministic layer is running: what a regex can prove from the prose.
        The probes that decide difficulty, novelty and derivability are not wired up, so
        nothing here says whether to start.
      </div>

      <form onSubmit={submit}>
        <div>
          <label htmlFor="prompt">instruction.md</label>
          <textarea
            id="prompt"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Paste the full prompt, including the canary and trailer if you already have them."
            spellCheck={false}
          />
        </div>

        <div className="row">
          <div>
            <label htmlFor="slug">Slug (optional)</label>
            <input
              id="slug"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              placeholder="runner-failure-visibility"
              spellCheck={false}
            />
            <p className="hint">Enables the task_name checks.</p>
          </div>
          <div>
            <label htmlFor="timeout">[agent].timeout_sec (optional)</label>
            <input
              id="timeout"
              value={timeout_}
              onChange={(e) => setTimeout_(e.target.value)}
              placeholder="28800"
              inputMode="numeric"
            />
            <p className="hint">Enables the exact trailer check.</p>
          </div>
        </div>

        <button type="submit" disabled={busy || !prompt.trim()}>
          {busy ? "Checking…" : "Check prompt"}
        </button>
      </form>

      {error && <p className="error">{error}</p>}

      {result && <Results result={result} />}

      <footer>
        Layer 1 of {" "}
        <a href="https://github.com/Matareyes00/terminal-bench-prompt-evaluator">
          prompt-evaluator-tbench4
        </a>
        . Every finding cites the rubric sentence that justifies it; a check without a
        citation is an opinion.
      </footer>
    </div>
  );
}

function Results({ result }: { result: Result }) {
  const { counts, coverage, verdict, findings } = result;
  const blocked = verdict === "blockers";

  return (
    <div className="results">
      <div className={`verdict ${blocked ? "blockers" : ""}`}>
        <h2>
          {blocked
            ? `${counts.blocker} blocker${counts.blocker === 1 ? "" : "s"}`
            : "No static blockers"}
        </h2>
        <p>
          {blocked
            ? "The deterministic layer found problems the review will flag. Fix these before building."
            : "The deterministic layer found nothing it can prove wrong."}
        </p>

        <div className="tally">
          <span>
            <b>{counts.blocker}</b> blocking
          </span>
          <span>
            <b>{counts.warn}</b> risks
          </span>
          <span>
            <b>{counts.todo}</b> pending packaging
          </span>
        </div>
      </div>

      {/* A clean screen reads as permission unless it is contradicted here. */}
      <div className="not-approval">
        <strong>This is not approval.</strong>
        {blocked ? (
          <>
            Fixing these clears the deterministic layer, which decides{" "}
            <b>
              {coverage.decided} of the {coverage.decidable} criteria
            </b>{" "}
            G0 is meant to decide. It says nothing about whether the task is difficult,
            novel or agentic — those need the probes, which are not active.
          </>
        ) : (
          <>
            Zero static findings means the deterministic layer found nothing, and that
            layer decides{" "}
            <b>
              {coverage.decided} of the {coverage.decidable} criteria
            </b>{" "}
            G0 is meant to decide — and none of them are difficulty, novelty or
            derivability. Those need the probes, which are not active. A clean result
            here is not a green light to build.
          </>
        )}
      </div>

      {ORDER.map((sev) => {
        const group = findings.filter((f) => f.severity === sev);
        if (!group.length) return null;
        return (
          <section className={`group ${sev}`} key={sev}>
            <h3>{SEV[sev].heading}</h3>
            <p className="blurb">{SEV[sev].blurb}</p>
            {group.map((f, i) => (
              <FindingCard key={`${f.check}-${i}`} f={f} />
            ))}
          </section>
        );
      })}
    </div>
  );
}

function FindingCard({ f }: { f: Finding }) {
  return (
    <article className={`finding ${f.severity}`}>
      <p className="msg">
        {f.message}
        {f.line ? <span className="where">line {f.line}</span> : null}
      </p>
      {f.excerpt && <pre className="excerpt">{f.excerpt}</pre>}
      {f.fix && (
        <p className="fix">
          <b>What to do:</b> {f.fix}
        </p>
      )}
      <details>
        <summary>Rubric citation</summary>
        <p>{f.rule}</p>
      </details>
      <p className="tagline">
        {f.criterion} / {f.check}
      </p>
    </article>
  );
}
