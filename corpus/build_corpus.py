#!/usr/bin/env python3
"""
Phase 0 - Builds the labelled corpus used to calibrate G0.

Three sources, all with authoritative labels:

  synthetic  34 fixtures from terminal-bench/scripts/checks/test-tasks/.
             Each one fails ONE criterion on purpose. The directory name is
             the label. These are extreme negatives: they verify that a check
             fires and is attributed to the right criterion, NOT that the fine
             boundary is calibrated.

  tb2        27 real terminal-bench tasks with human-evidence labels in
             labels.json. Seven of them are labelled across 15-17 criteria
             with a mix of pass and fail. This is the set that calibrates.

  tb4        Starter-pack packages that clear every gate. Positives. A check
             that fires here is a false positive.

Output: corpus.json
"""

import json
import re
import sys
from pathlib import Path

import yaml

# --- G0 scope ----------------------------------------------------------------
# decide : G0 emits a pass/fail verdict from the prompt (+ author metadata)
# advise : G0 spots the risk but cannot close it without the package
# out    : belongs to the team's packaging tool

SCOPE = {
    # --- decide ---
    "instruction_concision": "decide",
    "typos": "decide",
    "task_name": "decide",
    "structured_data_schema": "decide",
    "difficult": "decide",
    "interesting": "decide",
    "novel": "decide",
    "agentic": "decide",
    "solvable": "decide",
    "essential_difficulty": "decide",
    "category_and_tags": "decide",
    "expert_time_estimate": "decide",
    "difficulty_explanation_quality": "decide",
    "solution_explanation_quality": "decide",
    "verification_explanation_quality": "decide",
    # --- advise: the prompt shows the symptom, the package holds the proof ---
    "outcome_verified": "advise",
    "do_not_modify_enforced": "advise",
    "test_instruction_alignment": "advise",
    "reviewable": "advise",
    # --- out ---
    "verifiable": "out",
    "anti_cheat_robustness": "out",
    "functional_verification": "out",
    "deterministic_reproducible": "out",
    "environment_hygiene": "out",
    "solution_quality": "out",
    "resource_configuration": "out",
    "task_readme": "out",
    "no_extraneous_files": "out",
    "artifact_efficiency": "out",
    "verifier_execution_isolation": "out",
    "ctrf_reporting": "out",
    "binary_reward": "out",
    "task_security": "out",
    "task_toml_schema": "out",
    "separate_verifier_configured": "out",
}

CANARY_RE = re.compile(r"(harbor-canary|terminal-bench-canary)\s+GUID\s+[0-9a-f-]{36}")

PACK = Path("/home/claude/tb4/tb4-starter-pack")
FIXTURES = PACK / "sources/terminal-bench-ref/scripts/checks/test-tasks"
TB2REF = Path(
    "/tmp/claude-0/-home-claude/a0ef6c54-1899-5d93-b0d3-d32bd9415313/scratchpad/tb2ref"
)

# TB4 positives from the pack.
#
# template/repo-fix-task is deliberately NOT here: it is scaffolding full of
# placeholders (`<slug>`, `<Symptom first, ...>`), not a task. Including it as
# a positive was a mistake in the first version of this script and produced a
# legitimate false positive in the slug check. It is out because it is not a
# task, not because the check was inconvenient.
TB4_POSITIVES = [
    ("runner-failure-visibility", PACK / "example/runner-failure-visibility"),
    ("vllm-deepseek-streaming", PACK / "reference/vllm-deepseek-streaming"),
]


def strip_canary(text: str) -> str:
    """Drops the canary line. It is not part of the prompt the author writes,
    and the rubric explicitly says to ignore it when judging concision."""
    return "\n".join(
        ln for ln in text.splitlines() if not CANARY_RE.search(ln)
    ).strip()


def read_toml(p: Path) -> dict:
    if not p.exists():
        return {}
    try:
        import tomllib
    except ImportError:  # py<3.11
        return {}
    try:
        return tomllib.loads(p.read_text(encoding="utf-8"))
    except Exception as e:  # noqa: BLE001
        print(f"  ! unreadable toml {p}: {e}", file=sys.stderr)
        return {}


def record(task_id, source, prompt_raw, meta, labels, notes=""):
    in_scope = {
        c: v for c, v in labels.items() if SCOPE.get(c, "out") in ("decide", "advise")
    }
    return {
        "id": task_id,
        "source": source,
        "prompt_raw": prompt_raw,
        "prompt": strip_canary(prompt_raw),
        "has_canary": bool(CANARY_RE.search(prompt_raw)),
        "metadata": meta,
        "labels": labels,
        "labels_g0": in_scope,
        "n_labels": len(labels),
        "n_labels_g0": len(in_scope),
        "notes": notes,
    }


def build():
    src = json.loads((FIXTURES / "labels.json").read_text(encoding="utf-8"))
    tasks = src["tasks"]
    out = []
    missing = []

    for tid, entry in tasks.items():
        source = entry.get("source", "?")
        labels = entry.get("labels", {})
        notes = entry.get("notes", "")

        if source == "synthetic":
            d = FIXTURES / entry.get("path", tid)
            ip = d / "instruction.md"
            if not ip.exists():
                missing.append(tid)
                continue
            tom = read_toml(d / "task.toml")
            meta = dict(tom.get("metadata", {}))
            # check-task-slug.sh uses `basename "$task_dir"`. When the fixture
            # does not declare [task].name, the effective slug is the directory
            # name, same as upstream.
            meta["slug"] = tom.get("task", {}).get("name") or d.name
            out.append(record(tid, "synthetic", ip.read_text(encoding="utf-8"), meta, labels, notes))

        elif source == "tb2":
            name = entry["ref"]["path"].split("/")[-1]
            yp = TB2REF / "original-tasks" / name / "task.yaml"
            if not yp.exists():
                missing.append(tid)
                continue
            y = yaml.safe_load(yp.read_text(encoding="utf-8")) or {}
            prompt = y.get("instruction", "")
            meta = {
                "slug": name,
                "category": y.get("category", ""),
                "tags": y.get("tags", []) or [],
                "difficulty_declared": y.get("difficulty", ""),
                "expert_time_estimate_min": y.get("expert_time_estimate_min"),
                "agent_timeout_sec": y.get("max_agent_timeout_sec"),
            }
            out.append(record(tid, "tb2", prompt, meta, labels, notes))
        else:
            missing.append(tid)

    # TB4 positives: with no labels.json entry, the label is "passes everything".
    for tid, d in TB4_POSITIVES:
        ip = d / "instruction.md"
        if not ip.exists():
            missing.append(tid)
            continue
        tom = read_toml(d / "task.toml")
        meta = dict(tom.get("metadata", {}))
        meta["slug"] = tom.get("task", {}).get("name", tid)
        labels = {c: "pass" for c, s in SCOPE.items() if s == "decide"}
        out.append(
            record(
                tid,
                "tb4-positive",
                ip.read_text(encoding="utf-8"),
                meta,
                labels,
                "Positive: clears every gate in the pack. A FAIL here is a false positive.",
            )
        )

    return out, missing


def main():
    rows, missing = build()
    here = Path(__file__).parent
    (here / "corpus.json").write_text(
        json.dumps(
            {
                "schema": "g0-corpus/1",
                "scope": SCOPE,
                "n": len(rows),
                "tasks": rows,
            },
            indent=2,
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )

    by_src = {}
    for r in rows:
        by_src.setdefault(r["source"], []).append(r)

    print(f"corpus.json  {len(rows)} tasks")
    for s, rs in sorted(by_src.items()):
        print(f"  {s:<14} {len(rs):>3}   labels in G0 scope: {sum(r['n_labels_g0'] for r in rs)}")
    if missing:
        print(f"  NO BODY: {len(missing)} -> {missing}")

    cov = {}
    for r in rows:
        for c, v in r["labels_g0"].items():
            a, b = cov.get(c, (0, 0))
            cov[c] = (a + 1, b + (v == "pass"))
    print("\ncriterion coverage in G0 scope (total / pass):")
    for c, (n, p) in sorted(cov.items(), key=lambda kv: -kv[1][0]):
        bal = "balanced" if 0 < p < n else ("pass only" if p == n else "fail only")
        print(f"  {n:>3} / {p:>3} pass   {SCOPE[c]:<6} {c:<34} {bal}")


if __name__ == "__main__":
    main()
