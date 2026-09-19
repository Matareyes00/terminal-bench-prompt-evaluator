# prompt-evaluator-tbench4

G0 gate for Terminal-Bench 4.0 tasks: someone pastes the prompt they are
thinking of building, and the tool says **whether it is worth starting**.

It does not approve tasks. Approving or rejecting the complete package belongs
to the team's packaging tool. Why that split exists, and on what evidence it
was drawn, is in **[SPEC.md](SPEC.md)** — that is the document to read, not
this one.

## Status

| Phase | What | State |
|---|---|---|
| 0 | Labelled corpus | done — 63 tasks |
| 1 | Deterministic layer | done — gate green |
| 2 | Probes (OpenRouter) | next |
| 3 | Dial derivation | pending |
| 4 | Web UI + deploy | done — v0, no dial |

## Requirements

Node **>= 22.6** (`--experimental-strip-types`). Pinned in `engines.node` in
`package.json` and in `.nvmrc`. On Vercel, `engines.node` is what selects the
build and runtime Node for a Next.js project — there is no `vercel.json` field
that pins it for App Router route handlers, so `vercel.json` stays minimal
rather than carrying a `functions` glob that can fail the build by matching
nothing.

On an older Node the commands below fail with `bad option`; use `npx tsx
<file>` there, which leaves the global install alone.

## The CLI

What the team can use today: the deterministic layer over an `instruction.md`,
with no key and no network.

```bash
npm run g0 -- path/to/the-task            # directory: picks up slug and timeout
npm run g0 -- path/to/instruction.md
cat prompt.md | npm run g0 -- -           # via stdin
npm run g0 -- path/to/the-task --cites    # with the rubric citation
npm run g0 -- path/to/instruction.md --json
```

Pointed at a task **directory** it pulls two more things from context: the
directory name as the slug (enables `task_name`) and `[agent].timeout_sec` from
the `task.toml` alongside it (enables the exact trailer check).

It exits **0** when there are no blockers and **1** when there is at least one,
so it works in a hook or in CI. It never emits `START`: that needs the probes,
and a green from Layer 1 is not a green light (SPEC sections 1 and 5).

## The web (v0)

One page: a textarea, an optional slug, an optional `[agent].timeout_sec`, and
a button. The verdict sits at the top, findings are grouped by severity with
blockers first, and each finding's rubric citation is collapsed behind a
disclosure rather than leading with it.

```bash
npm run dev     # http://localhost:3000
npm run build
npm start
```

**v0 has no dial.** No RAISE/LOWER, no START. The probes are not wired, and the
page says so in the open. A result with zero findings is never presented as
approval: the panel states that the deterministic layer decides 3 of the 15
criteria G0 is meant to decide, and that none of them are difficulty, novelty
or derivability.

`POST /api/check` imports `src/lib/checks` — the web reimplements nothing. The
findings the page renders are the same objects the CLI prints, and
`cli/parity.test.ts` runs the same prompts through a real CLI subprocess and
through the route handler and asserts the findings are identical. Without that
test the web could drift from the layer SPEC section 7 measured and nobody
would notice.

### Records and export

Evaluations are stored with prompt, verdict, findings, timestamp and a `model`
column that stays null until the probes exist (SPEC section 9.2). The table is
created on first write, so there is no migration step.

- `/records-7c41f9a2` — the records view
- `/records-7c41f9a2/export` — the same rows as CSV

v1 has no auth, so that unguessable path is the only barrier and the page is
not linked from anywhere. It is obscurity, not security: anyone with the URL
can read it.

Persistence needs a Postgres store attached to the project, which sets
`POSTGRES_URL` (or `DATABASE_URL`). **Without one the check still works** — the
API answers normally and reports `storage: { configured: false, stored: false }`
rather than pretending the row was saved.

## Running what exists

```bash
python3 corpus/build_corpus.py                       # rebuilds corpus.json
node --experimental-strip-types eval/run-static.ts   # measures against the corpus
node --experimental-strip-types eval/run-static.ts --verbose
npm test                                             # CLI regressions
```

Phase 1 results live in `eval/results/`, and are discussed in SPEC.md section 7.

## Layout

```
app/page.tsx               the one page
app/api/check/route.ts     POST endpoint; imports the shared check layer
app/records-7c41f9a2/      records view + CSV export
cli/g0.ts                  the CLI: deterministic layer from the terminal
cli/parity.test.ts         asserts the CLI and the API return identical findings
src/lib/evaluate.ts        the single definition of an evaluation
src/lib/db.ts              persistence; degrades to a no-op with no database
corpus/build_corpus.py     assembles the labelled set from three sources
corpus/corpus.json         63 tasks with rubric labels
src/lib/checks/types.ts    the output contract (Finding, Severity, Verdict)
src/lib/checks/static.ts   the deterministic layer
eval/run-static.ts         measurement harness + gate
SPEC.md                    how it evaluates, and why
```

## Rebuilding the corpus from scratch

`corpus/build_corpus.py` reads two external trees:

- the TB4 starter pack (`PACK`), which supplies the 34 fixtures and the 2
  positives;
- the `laude-institute/terminal-bench` repo (`TB2REF`), which supplies the
  bodies of the 27 labelled tb2 tasks.

Both paths are hardcoded at the top of the script and point at the machine it
was first written on, so set them before running. For the second, a blobless
clone is enough:

```bash
git clone --filter=blob:none --no-checkout --depth 1 \
  https://github.com/laude-institute/terminal-bench.git tb2ref
```

plus a sparse-checkout of `original-tasks/<name>/task.yaml` for the 27.

## Secrets

The OpenRouter key lives in a server-side env var and is read only from API
routes. It never reaches the browser, never enters the repo, never appears in
a log. Locally it goes in `.env.local`, which `.gitignore` already covers. This
project has its own key: do not reuse another project's.
