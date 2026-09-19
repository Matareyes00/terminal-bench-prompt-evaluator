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
| 2 | Probes (OpenRouter) | in progress |
| 3 | Dial derivation | pending |
| 4 | Web UI + deploy | pending |

## Requirements

Node **>= 22.6** (`--experimental-strip-types`). Pinned in three places:
`engines.node` in `package.json`, `.nvmrc`, and the function runtime in
`vercel.json`. On an older Node the commands below fail with `bad option`; use
`npx tsx <file>` there, which leaves the global install alone.

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
cli/g0.ts                  the CLI: deterministic layer from the terminal
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
