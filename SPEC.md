# G0 — How it evaluates Terminal-Bench 4.0 prompts, and why

This document is the contract. It does not describe the architecture: it
describes what the tool looks at, what it decides, what it refuses to decide,
and on what evidence. Anyone continuing the build — here, in local Claude
Code, or in Antigravity — works against this.

---

## 1. The problem, measured

The original request was: a web tool where someone pastes their prompt and the
tool says whether to raise or lower the complexity, to avoid two extremes — a
task so basic it cannot break the benchmark, and one so hard it fails by being
impossible rather than by being difficult.

Before building that, we counted the blocking findings in the TB4 feedback of
2026-09-16: **72 findings across 6 reviewed tasks**.

| Family | Findings |
|---|---:|
| Verifier architecture | ~30 |
| Explanations and README | ~18 |
| Metadata and policy | ~20 |
| Specification (prompt <-> tests) | ~9 |
| **Difficulty calibration** | **1** |

One. And that one (`essential_difficulty` on `hermes-stale-serve-accounting`)
says "tests impose unstated creation-time tolerance, output sanitization, unit
syntax" — a specification problem, not a calibration problem.

None of the 6 died of being trivial. None died of being impossible.

**Design consequence.** The complexity dial still exists, because the waste it
describes is real: someone burns tokens building something that cannot break
the benchmark. But a dial on its own would give a green light to prompts that
then die on twenty criteria the prompt cannot see. A false green is worse than
having no tool, because the person builds with permission.

So G0 **never approves a task**. G0 decides **whether it is worth starting**.
Approving or rejecting the complete package belongs to the packaging tool the
team is building.

---

## 2. Scope: what G0 decides

The 35 criteria in `rubric/task-implementation.toml` split three ways.

### `decide` — G0 issues a verdict

`instruction_concision`, `typos`, `task_name`, `structured_data_schema`,
`difficult`, `interesting`, `novel`, `agentic`, `solvable`,
`essential_difficulty`, `category_and_tags`, `expert_time_estimate`,
`difficulty_explanation_quality`, `solution_explanation_quality`,
`verification_explanation_quality`.

### `advise` — G0 sees the symptom, the proof is in the package

`outcome_verified`, `test_instruction_alignment`, `do_not_modify_enforced`,
`reviewable`.

`outcome_verified` started in `decide` and moved here on evidence, not
caution: `prove-plus-comm` has a numbered four-step list in the instruction and
the human labeller still marked it PASS on `outcome_verified` (and FAIL on
`instruction_concision`). The criterion turns mainly on whether the *tests*
grade process, and G0 does not see the tests. See section 7.

### `out` — the packaging tool's job

The remaining 16: verifier, Docker, `task.toml`, artifacts, reward.

### The ownerless frontier

Four criteria need the prompt **and** the tests at once:
`test_instruction_alignment`, `outcome_verified`, `essential_difficulty`,
`do_not_modify_enforced`. They were 9 of the 72. A mechanical packaging tool
cannot see them; the prompt alone cannot either.

**Decision:** G0 covers them **if the author pastes the tests**, in an optional
collapsed field, from v1.1 on. They only produce `advise` findings, never
`blocker`: with the tests in view G0 can point at an assertion that no sentence
of the prompt asks for, but it cannot close the criterion without running
anything. If the author does not paste the tests, the four are explicitly
**not covered** and the UI says so; coverage is never simulated.

---

## 3. Three layers

| Layer | Cost | What it decides |
|---|---|---|
| 1. Deterministic | zero | What a regex can prove: headings, paths, trailer, canary, slug, enumerated procedure, PR/commit leakage |
| 2. Probes | 3 calls | Derivability and memorization |
| 3. Rubric audit | 2 calls | The judgement criteria, with the verbatim `guidance` from the TOML |

**Budget: ~5 calls per evaluation.** Not 90. The wrong shape is one call per
criterion: probe 3 sends the whole subset of criteria in a single structured
output per model, and probe 2 has no call of its own (section 4).

**No check exists without a citation.** Every `Finding` carries a `rule` field
with the rubric sentence or canonical script that justifies it. The tool
predicts the review the task is going to receive; it does not invent criteria
of its own. A check without a citation is an opinion, and an opinion that
blocks someone's work is exactly what this project cannot afford.

### Severities

| | Meaning |
|---|---|
| `blocker` | The prompt is wrong and the review will flag it. Fix before building. |
| `warn` | A real risk that depends on context G0 cannot see. The author decides. |
| `todo` | Mechanical, from the packaging stage. The team's tool covers it. |
| `info` | A signal with no verdict. Feeds the probe layer. |

The canary and the trailer are `todo`, not `blocker`. A draft prompt does not
have them yet, and marking them red teaches people to ignore the tool. What
does block is a trailer that is **present and malformed**: that is an author
error.

---

## 4. The three probes (phases 2-3)

The central methodological decision: **we never ask a model "how hard is this,
one to ten".** Models are bad at judging difficulty, and we measured it last
week: trimming a task's graded set lowered its difficulty through the prompt,
not through the denominator. It is measured, not opined.

### Probe 1 — Blind solve

**N = 3.** The prompt alone goes to three models, with no repo and no
environment, and they are asked for the complete solution. They are not asked
for an opinion.

Each model returns `{file_or_symbol, semantic_change_in_one_sentence}`.

**Convergence is structural, not textual:** two answers converge if **the place
and the semantics** match. Two models that write the same patch in different
styles converge. Two that touch the same file for different reasons do not.
Comparing diffs as text would measure prose style.

| Result | Reading | Verdict |
|---|---|---|
| The 3 converge on the same concrete fix | derivable from the prose; the agent does not need the environment | **RAISE** |
| The 3 diverge from each other | the prompt underdetermines the contract | not difficulty: specify the interface |
| The 3 ask to see the code | genuinely agentic | **OK** |

This is the derivability rule made mechanical: *once read, does the fix become
an obvious local transformation?* Feeds `difficult`, `agentic`,
`essential_difficulty`.

### Probe 2 — Recognition

**It has no call of its own.** It rides in the same completion as probe 1, but
**after** the attempt: "first produce the fix; then, separately, tell me
whether you recognize this codebase or problem". Asking first contaminates the
attempt — the model stops trying and starts remembering. Asking after is free.

**Probe 2 never emits a `blocker` on its own.** A model can name a PR that does
not exist with total confidence, and a false positive here blocks legitimate
work, which is exactly what section 3 says this project cannot afford.

The evidence that counts is not that the model **names** a PR — that is
verifiable but expensive, and hallucinable — but that it **produces the
concrete fix of a codebase it never saw**. That is memorization whatever the PR
is called.

| Evidence | Output |
|---|---|
| One model claims to recognize it | `warn`, with the claim quoted verbatim |
| Two models independently converge on the same concrete fix | `blocker` |

Same convergence rule as probe 1.

`novel` is where the deterministic layer has 0% recall (section 7), so this
probe is its only source of signal. In the TB4 feedback, `novel` came up in 2
of the 6 reviewed tasks, both for "the exact public PR".

**Recorded trap.** 20 of the 27 `tb2` tasks carry `pr_numbers` / `pr_urls` in
`labels.json`. It looks like memorization ground truth and **it is not**: those
are the PRs contributing the task *to* `laude-institute/terminal-bench`
(`build-stp` -> PR 934, `query-optimize` -> PR 968), not the upstream PR of the
fix a model might have memorized. Using them to validate probe 2 would produce
false positives en masse. What does work: `novel` is labelled on 7 `tb2` tasks,
3 fail and 4 pass. It is small, it is human evidence, and it is already in the
pack — it is the set this probe is calibrated against before the key exists.

### Probe 3 — Contract audit

The judgement criteria applied to the prose, with the **verbatim** `guidance`
from the TOML as the prompt. No rewording: rewording invents a new criterion.

One call per model with the whole subset of criteria in a structured output.
One call per criterion buys nothing and multiplies the cost by fifteen.

### Consensus

**`anthropic/claude-opus-5` + `openai/gpt-5.6-sol`**, cross-vendor mandatory.
If they disagree, the verdict is `NEEDS_HUMAN`, never an average.

The cross is not a preference. The rubric, under `verifiable`, accepts
LLM-as-a-judge only if it can be shown to almost never be wrong, and offers as
evidence that *"multiple different LLMs always make the same determination"*.
Two models from the same family are not "different LLMs" in any useful sense:
they share data and post-training, and their agreement is not independent.
These two are also exactly what upstream CI runs, so their agreement rate can
be compared against ours.

---

## 5. The dial

The dial is **derived** from the probes. It is not asked for.

**RAISE** if probe 1 converges or probe 2 recognizes the problem.
Criteria: `difficult`, `novel`, `agentic`.

**LOWER** if the difficulty comes from volume of work or from unstated detail.
The rubric defines both limits; there is no need to invent them:

- `solvable`: *"solvable in a few hours at most by an expert human who knows
  the idea of the answer in advance… the difficulty should not be measured by
  how much work there is to be done."*
- `essential_difficulty`: *"FAIL if most failures would come from formatting
  edge cases, output precision, or clerical details rather than the core
  problem."*

"Impossible to solve" is almost never conceptual. It is undeclared tolerance.

**Output:** a three-state global verdict.

| | When |
|---|---|
| `START` | No blockers, and the probes flag neither derivability nor memorization |
| `DO NOT START` | There is at least one `blocker` |
| `REVIEW` | No blockers, but the two models disagree on some criterion (`NEEDS_HUMAN`) |

Never `approved`: that belongs to the complete package, not to G0.

**No numeric scale.** The dial comes out as text plus the concrete criterion
that motivated it. A score invites optimizing the score, and what we want the
author to optimize is the task.

---

## 6. Corpus

`corpus/build_corpus.py` -> `corpus/corpus.json`. 63 tasks, three sources, all
with an authoritative label.

| Source | n | What it is |
|---|---:|---|
| `synthetic` | 34 | Fixtures from `scripts/checks/test-tasks/`. Each fails one criterion on purpose. Extreme negatives. |
| `tb2` | 27 | Real terminal-bench tasks with human-evidence labels in `labels.json`. Seven labelled across 15-17 criteria with a mix of pass and fail. **This is the set that calibrates.** |
| `tb4-positive` | 2 | `example/runner-failure-visibility` and `reference/vllm-deepseek-streaming`. A blocker here is a false positive. |

The bodies of the 27 tb2 tasks do not ship in the starter pack; `labels.json`
references them by `ref.repo` + `ref.path`. They are recovered from
`laude-institute/terminal-bench` under `original-tasks/`, where all 27 live.
They use `task.yaml` with the instruction embedded, not `instruction.md`.

`template/repo-fix-task` is **not** among the positives: it is scaffolding full
of placeholders (`<slug>`, `<Symptom first, …>`), not a task. Including it was
a mistake in the first version and produced a legitimate false positive in the
slug check. It is out because it is not a task, not because the check was
inconvenient.

### Honest limit of the corpus

The 34 synthetic fixtures are extremes: FizzBuzz for `novel`, `reverse_string`
for `difficult`. Telling FizzBuzz apart from a real task proves very little.
They verify that a check **fires and is attributed to the right criterion**,
not that the fine boundary is calibrated. Real calibration depends on the 27
tb2 tasks, and on the tasks the team delivers from here on.

---

## 7. Measured results — phase 1

`node --experimental-strip-types eval/run-static.ts`

| Criterion | n | precision | recall |
|---|---:|---:|---:|
| `instruction_concision` | 10 | 100 % | 100 % |
| `task_name` | 3 | 100 % | 100 % |
| `structured_data_schema` | 10 | 100 % | 100 % |
| `novel` | 10 | — | **0 %** |

**Phase 1 gate: PASS.** Zero blockers on the TB4 positives.

Remaining false negatives: the four on `novel` (FizzBuzz, `solve-sudoku`,
`prove-plus-comm`, `nginx-request-logging`). The `instruction_concision` one
(`raman-fitting`) was closed by the `input-path-missing` check — see 8.2.

**The four `novel` ones are deliberately left unfixed.** They could be turned
green with a blacklist of known problems, and that would make the table prettier
without improving anything: the list does not generalize to task 501. `novel` is
decided by probe 2 or it is not decided.

### Conclusion of the phase

The deterministic layer decides **3 of the 15 criteria G0 claims to decide**
(total scope is 19: 15 `decide` + 4 `advise`), and **nothing** about difficulty
or novelty. It is cheap safety, not the product. All the signal the original
request was after — raise or lower complexity — lives in the probe layer.

---

## 8. Open

1. **OpenRouter key.** A trial key now exists; see 9.1. **OpenRouter is the
   production policy, not the development policy:** the probes are developed
   against whatever key the team has — Anthropic direct works — behind the
   two-backend abstraction, and moving to OpenRouter is an environment
   variable. The key lives **only** in a server-side env var: never in the
   client, never in the repo, never in a log. This project has its own key; do
   not reuse another project's.

2. **`raman-fitting` — closed.** The `instruction_concision` failure is that
   **the instruction never gives the path of the input file**: it says *"You
   are given the output file of a Raman Setup"* and never names it. The path
   check looks for relative paths and cannot see an **absent** one. This needed
   a new check, not an adjustment to the existing one: *the task references an
   input that has to be read and gives no absolute path for it*. Citation:
   `instruction_concision` — "They must use absolute paths (e.g., /app/data.csv,
   not data.csv)".

   **Implemented** as `checkInputPathMissing` (check 11 in `static.ts`).
   Demanding "some absolute path" is not enough: `raman-fitting` **has** one,
   `/app/results.json`, but it is the output. The check separates write paths
   from read paths by the verb preceding them, and fires only if the prompt
   references an input and **all** of its absolute paths are write paths.
   Across the 63 corpus tasks it fires on exactly one: `raman-fitting`, the one
   labelled `fail`. Zero false positives, and `instruction_concision` goes from
   75 % to 100 % recall.

   It emits `blocker` even though no canonical script emits it, which diverges
   from check 2's convention. The evidence is of a different kind: here there
   is a human FAIL in `labels.json`, not a pattern from a buggy script. G0
   predicts the review, and the review is human before it is CI.

   **It rests on n=1, and that has to be said.** "Fires on 1 of 63" is not
   precision: 63 is the corpus, not the denominator. Measured, the denominator
   is 5 — only 5 of the 63 satisfy the precondition (the prompt references an
   input), and all 5 are `tb2`. Of those, it fires on 1: `raman-fitting`, the
   one that motivated it. The other 4 (`query-optimize`, `cartpole-rl-training`,
   `solve-sudoku`, `mailman`) do not fire because they do give a read path, and
   that was verified by hand — but all 4 have `instruction_concision`
   **unlabelled**, so they are not even confirmed negatives. What is measured is
   that the read/write discrimination works in 5 cases. What is not measured is
   precision. Until new tasks that satisfy the precondition arrive, this check
   is a well-founded hypothesis, not a result.

3. **Recorded fixtures.** A demoable subset, not all 63: the 2 positives and 6
   that exercise each verdict path. Fixture key = hash of (prompt + probe prompt
   version), so they invalidate themselves when a probe changes instead of
   rotting silently.

4. **The calibration loop.** The tool "predicts the review the task is going to
   receive", and today the only evidence is the 6 tasks from the 2026-09-16
   feedback. Without new reviews the calibration freezes where it is. The
   artefact to request from the team is the `check_report.json` from
   `harbor check`: every delivery produces one, it carries a per-criterion
   verdict, and no format has to be invented. Cadence: one per delivery.

5. **Dial calibration** against tasks with a measured pass rate.
   `omnigent-host-lifecycle` from last week has 10 attempts and two models; it
   is the only prompt for which we know empirically what frontier models do. It
   is worth more than any synthetic fixture. What is useful from that run is the
   `reward.txt` and `summary.txt` per trial, plus the F2P count.

---

## 9. Scope changes — client, 2026-09-18

Four client decisions made after section 8. Where they contradict anything
above, these win.

### 9.1 There is a trial key

The probes are developed **against the real API**, not against recorded
fixtures. The fixtures still exist, but their place is the tests, not
development: a recorded fixture cannot discover that a probe was badly framed.
The key lives in `.env.local` on the development machine, and in the project's
env vars on Vercel. Never in the repo, never in the client, never in a log.

### 9.2 Prompts are stored

**This reverses the decision not to persist anything.** The reason not to store
was protecting unpublished work; the reason to store is that the team needs to
see what the taskers are sending, and that one wins.

Stored per evaluation: prompt, verdict, findings, model and date. Vercel
Postgres, with a CSV export button. Same result as a spreadsheet without
handling Google credentials. If they later want it to live in Drive, that is
added on top; it does not constrain the schema.

### 9.3 The UI is a textarea and a button

The reader is someone who **has never read the rubric**. Each finding says what
is wrong and what to do. The `rule` citation goes below, collapsed: it is the
proof that the check is not an opinion, not the first thing anyone needs to
read.

**Language: English.** An earlier decision had the UI and findings in Spanish
with only `rule` in English; the whole project is now in English, so findings,
UI copy, documentation and code comments are all English and `rule` stays
verbatim from the rubric as it always was.

### 9.4 Order: probes first, scaffolding after

`create-next-app` is five minutes and zero uncertainty. The probes carry all
the risk: **if blind-solve convergence does not correlate with the `novel` and
`difficult` labels, G0's premise changes**, and a UI built on top is wasted
work. The measurement is against the 7 `tb2` tasks with `novel` labelled — 3
fail, 4 pass (section 4).

With 7 tasks, 3 of them `fail`, statistical power is very low. If the
correlation comes out clean, that is real signal. If it comes out ambiguous, it
will not distinguish "the premise is false" from "there is not enough data", and
in that case it gets reported as indeterminate rather than forced into a
reading — the same standard applied to the n=1 of check 11.

### 9.5 The CLI ships first, this week

The deterministic layer already works and needs no key. The ramp runs the 18th
to the 22nd, so one command over an `instruction.md` is useful to the team on
Monday, while the web does not exist yet. The web helps when it is ready; the
CLI helps now.
