# G0 — Terminal-Bench 4.0 prompt check

**https://terminal-bench-prompt-evaluator.vercel.app**

Paste the instruction you are thinking of building. The tool reads the prose
and tells you what a reviewer is going to flag, before you spend a day on the
verifier, the Docker image and the tests.

Two things happen, and you choose whether to run the second.

1. **What the review will flag** — 25 checks over the prose. Instant, free.
2. **Whether it is hard enough** — three frontier models get the prompt with no
   code and try to solve it. If they land on the same fix, the task is
   derivable from the prose and needs to be harder. About a minute, costs
   money, so you press a button for it.

It does **not** approve tasks. Clearing both still leaves the verifier, the
tests and the metadata unchecked.

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

### The difficulty reading

Press **Measure difficulty** and the prompt goes to `claude-opus-5`,
`gpt-5.6-sol` and `gemini-3.1-pro` with no repository attached. None of them is
asked how hard the task is — models are bad at that. They are asked to solve
it, and the reading comes from what they did:

| What the three models did | Reading |
|---|---|
| Two or more produced the same concrete fix | **Raise the difficulty** — derivable from the prose, or memorised |
| They all asked to see the code | **Genuinely agentic** — nothing to change on this axis |
| They each committed to a different fix | **Specify the interface** — the prompt leaves the contract open, which is not the same as being hard |
| The judges disagreed, or only one committed | **No reading** — shown as such, never averaged into a verdict |

Whether a fix counts as "the same" is judged on **place and semantics
separately**, by two models from different vendors that have to agree. Same
file for different reasons does not count as agreement, and identical wording
does not either.

You can open the workings and read what each model actually answered.

**How much to trust it.** This rule was validated once, against the 7 corpus
tasks carrying a human `novel` label. Five produced a usable answer and it
separated all five correctly — but at that size there is roughly a 1-in-10
chance of that happening by luck, and runs are not perfectly stable: the same
task can come back `raise` once and `no reading` the next time when the judges
split. Treat it as a strong hint, not a verdict. The page says so too.

One more caveat worth knowing before quoting the number. Of the corpus tasks
that carry both a `difficult` and a `novel` label, all five move together —
`difficult=fail` always with `novel=fail`, `pass` always with `pass`. The two
are collinear in the only data available, so this measurement cannot say which
of them the probe is tracking.

### What it still cannot tell you: is it hard *with* the code?

Blind-solve answers "is the fix derivable from your prose". When all three
models ask to see the code, that is read as *genuinely agentic* — and that
reading is an assumption, not a measurement. A one-line fix behind a vague
prompt produces the same answer as a genuinely hard task.

Closing that needs the repository. A probe for it is written and works
(`src/lib/probes/github.ts`, `src/lib/probes/withcode.ts`,
`POST /api/probe/code`): give it a public PR URL and it fetches the touched
files **at the base commit**, mixes them unlabelled with their siblings so
locating the defect is still part of the job, and scores server-side whether
each model named a file the PR actually changed.

It is not reachable from the web. Two reasoning models reading a repository run
past what a request is allowed to last — measured, the connection closes around
340s — so it has to become a background job first. The field is disabled in the
UI with that explanation rather than shipping a control that always fails.

### What it checks today

25 checks across 7 rubric criteria. The ones that block:

- **Instruction concision** — markdown headings; relative paths instead of
  absolute; an input the task says to read with no path given for it;
  step-by-step procedures; numbered lists of steps to follow; explicit hints at
  the approach; a trailer in the wrong place or carrying the wrong timeout.
- **Novelty** — a link to a public PR, or a reference to an upstream commit.
- **Task name** — a slug that is not lowercase kebab-case.
- **Structured output** — the task asks for JSON/CSV output but never documents
  the schema.
- **Environment hygiene** — a malformed canary, or the old TB2 canary.

The ones that only warn: roleplay preamble, listing available tools,
prescribing the method instead of the outcome, generic slugs, **slugs longer
than 3 tokens**, bare filenames that may or may not be paths, and `do not
modify` statements that the verifier will have to enforce.

The slug length one used to block. Two approved TB4 deliveries were run through
the tool and both came back blocked on it — both have four-token names and both
shipped. The rubric text is on the check's side (*"Names must be at most 3
words (hyphen-separated tokens)"*), but a rule that blocks two of two approved
tasks is not predicting the review. You still see it; you decide.

### How well it works

Measured against 63 labelled tasks — 34 synthetic fixtures, 27 real
terminal-bench tasks with human labels, 2 reference TB4 packages.

| Criterion | n | precision | recall |
|---|---:|---:|---:|
| `instruction_concision` | 10 | 100 % | 100 % |
| `task_name` | 3 | — | 0 % |
| `structured_data_schema` | 10 | 100 % | 100 % |
| `novel` | 10 | — | **0 %** |

Zero false positives on the two reference packages that clear every gate. That
is the number that matters most here: a tool that flags good work gets ignored.

`task_name` reads 0 % because its only detection was the slug-length rule, and
that dropped to a warning after it blocked two approved tasks (above). Its one
remaining miss is a synthetic fixture built to fail exactly that check.

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
| Is it too easy / too hard? | running, on the evidence described above |
| Is it genuinely agentic? | running, same caveat |
| Is it genuinely novel? | partial — a model claiming recognition is reported, but a claim alone never blocks |
| Does the difficulty come from the real problem or from clerical detail? | not running |
| Typos, category and tags, time estimate, the explanation criteria | not running |
| Verifier, Docker, `task.toml`, artifacts, reward | out of scope — the packaging tool |
| Do the tests match the instruction? | out of scope until you can paste the tests |

The difficulty reading gets stronger as more labelled tasks arrive to check it
against; today it rests on five. Details in [SPEC.md](SPEC.md), section 9.4.

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
