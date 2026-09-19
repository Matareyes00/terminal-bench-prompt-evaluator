# G0 — Terminal-Bench 4.0 prompt check

**https://terminal-bench-prompt-evaluator.vercel.app**

Paste the instruction you are thinking of building. The tool reads the prose
and tells you what a reviewer is going to flag, before you spend a day on the
verifier, the Docker image and the tests.

It does **not** approve tasks, and it does not yet tell you whether a task is
too easy or too hard. What it does today is catch the mechanical problems that
made up most of the blocking feedback on the last round — in about a second,
for free.

---

## How to use it

Three inputs, two of them optional.

| Field | Needed? | What it unlocks |
|---|---|---|
| **instruction.md** | yes | everything below |
| **Slug** | optional | the `task_name` checks (length, kebab-case, generic names) |
| **[agent].timeout_sec** | optional | the exact trailer check — whether the number in your prompt matches `task.toml` |

Paste the prompt exactly as it will ship, canary and trailer included if you
already have them. Leaving them out while drafting is fine: they come back as
*pending*, not as errors.

---

## How it evaluates

### It predicts a review. It does not have opinions.

Every finding carries the sentence from `rubric/task-implementation.toml`, or
from the upstream CI script, that justifies it. You can open that citation on
any finding — it sits collapsed under **Rubric citation**. If a check cannot
cite a rule, it does not exist. This matters: a tool that blocks your work on
its own taste is worse than no tool.

### Four severities, and they mean different things

| | What it means | What to do |
|---|---|---|
| **Blocks** | The prompt is wrong and the review will flag it | Fix before building |
| **Risk** | A real risk, but it depends on context the tool cannot see | Your call |
| **Pending packaging** | Mechanical, belongs to the packaging stage | Ignore while drafting |
| **Note** | A signal, no verdict | — |

The canary and the trailer come back as *pending*, not *blocking*. A draft does
not have them yet, and painting a draft red teaches people to ignore the tool.
A trailer that is **present and malformed** does block, because that is a real
mistake rather than an unfinished step.

### What it checks today

25 checks across 7 rubric criteria. The ones that block:

- **Instruction concision** — markdown headings; relative paths instead of
  absolute; an input the task says to read with no path given for it;
  step-by-step procedures; numbered lists of steps to follow; explicit hints at
  the approach; a trailer in the wrong place or carrying the wrong timeout.
- **Novelty** — a link to a public PR, or a reference to an upstream commit.
- **Task name** — a slug over 3 tokens, or not lowercase kebab-case.
- **Structured output** — the task asks for JSON/CSV output but never documents
  the schema.
- **Environment hygiene** — a malformed canary, or the old TB2 canary.

The ones that only warn: roleplay preamble, listing available tools,
prescribing the method instead of the outcome, generic slugs, bare filenames
that may or may not be paths, and `do not modify` statements that the verifier
will have to enforce.

### How well it works

Measured against 63 labelled tasks — 34 synthetic fixtures, 27 real
terminal-bench tasks with human labels, 2 reference TB4 packages.

| Criterion | n | precision | recall |
|---|---:|---:|---:|
| `instruction_concision` | 10 | 100 % | 100 % |
| `task_name` | 3 | 100 % | 100 % |
| `structured_data_schema` | 10 | 100 % | 100 % |
| `novel` | 10 | — | **0 %** |

Zero false positives on the two reference packages that clear every gate. That
is the number that matters most here: a tool that flags good work gets ignored.

`novel` at 0 % recall is deliberate. The deterministic layer only catches a
pasted PR link. Whether a problem is *actually* novel cannot be settled by a
regex, and faking it with a blacklist of known problems would look better on
this table without helping on the task you write tomorrow.

---

## What it does **not** decide

This is the part to read before trusting a clean result.

**A clean result is not approval.** The layer running today decides **3 of the
15 criteria** the tool is eventually meant to decide, and **none of them are
about difficulty**. Zero findings means "nothing a regex can prove is wrong",
not "go build it".

Still missing:

| | Status |
|---|---|
| Is it too easy / too hard? (the dial) | **not running** |
| Is it genuinely novel? | not running — needs the probes |
| Is it genuinely agentic? | not running |
| Does the difficulty come from the real problem or from clerical detail? | not running |
| Verifier, Docker, `task.toml`, artifacts, reward | out of scope — the packaging tool |
| Do the tests match the instruction? | out of scope until you can paste the tests |

The machinery behind the difficulty questions exists and has been measured
once, against the 7 tasks that carry a human `novel` label. On the 5 of those 7
that produced a usable answer it separated them perfectly — encouraging, and
**not** enough to switch on: at that size the result has a 1-in-10 chance of
happening at random. It gets wired in when there are more labelled tasks to
check it against. Details in [SPEC.md](SPEC.md), section 9.4.

---

## Where the submissions go

Every check is stored: the prompt, the verdict, the findings and the timestamp.
The team reads them to see what is actually being submitted.

- Records: `/records-7c41f9a2`
- CSV of everything: `/records-7c41f9a2/export`

That path is unguessable and linked from nowhere, which is the only thing
protecting it — there is no login yet. Treat the URL as a secret. If that is
not good enough for what people are pasting, say so and it gets auth.

---

## For developers

The same checks run from the terminal with no key and no network, which is
useful in a pre-commit hook or in CI — it exits non-zero when there are
blockers:

```bash
npm run g0 -- path/to/the-task         # a task dir: picks up slug and timeout
cat prompt.md | npm run g0 -- -
npm run g0 -- path/to/task --cites     # show the rubric citation inline
```

Requires Node >= 22.6 (`--experimental-strip-types`); on an older Node use
`npx tsx <file>`. The web route and the CLI import the same module, and a test
asserts they return identical findings, so the table above describes both.

```bash
npm run build        # next build
npm test             # CLI regressions + CLI/API parity
npm run eval:static  # re-measure against the 63-task corpus
npm run probes       # the probe measurement (needs a model key)
```

Storage is Postgres when `POSTGRES_URL` is set and Vercel Blob otherwise; with
neither, the check still answers and reports that nothing was stored. Design
decisions, the evidence behind them, and what is deliberately left undone are
in **[SPEC.md](SPEC.md)**.
