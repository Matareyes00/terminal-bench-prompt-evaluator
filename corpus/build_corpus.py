#!/usr/bin/env python3
"""
Fase 0 - Construye el corpus etiquetado para calibrar G0.

Tres fuentes, todas con etiqueta autoritativa:

  synthetic  34 fixtures de terminal-bench/scripts/checks/test-tasks/.
             Cada uno falla UN criterio a proposito. El nombre del directorio
             es la etiqueta. Son negativos extremos: sirven para verificar que
             un check dispara y se atribuye al criterio correcto, NO para
             calibrar el limite fino.

  tb2        27 tareas reales de terminal-bench con etiquetas de evidencia
             humana en labels.json. Siete de ellas estan etiquetadas en 15-17
             criterios con mezcla de pass y fail. Este es el set que calibra.

  tb4        3 paquetes del starter pack que pasan todas las compuertas.
             Positivos. Un check que dispara aca es falso positivo.

Salida: corpus.json
"""

import json
import re
import sys
from pathlib import Path

import yaml

# --- Alcance de G0 -----------------------------------------------------------
# decide : G0 emite veredicto pass/fail desde el prompt (+ metadata del autor)
# advise : G0 detecta el riesgo pero no puede cerrarlo sin el paquete
# out    : pertenece a la tool de empaquetamiento del equipo

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
    # --- advise: el prompt muestra el sintoma, el paquete tiene la prueba ---
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

# Positivos TB4 del pack.
#
# template/repo-fix-task NO esta aca a proposito: es un andamio con marcadores
# (`<slug>`, `<Symptom first, ...>`), no una tarea. Incluirlo como positivo fue
# un error de la primera version de este script y producia un falso positivo
# legitimo en el check de slug. Se saca porque no es una tarea, no porque el
# check moleste.
TB4_POSITIVES = [
    ("runner-failure-visibility", PACK / "example/runner-failure-visibility"),
    ("vllm-deepseek-streaming", PACK / "reference/vllm-deepseek-streaming"),
]


def strip_canary(text: str) -> str:
    """Quita la linea del canary. No es parte del prompt que el autor escribe
    y la rubrica dice explicitamente que se ignore al evaluar concision."""
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
        print(f"  ! toml ilegible {p}: {e}", file=sys.stderr)
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
            # check-task-slug.sh usa `basename "$task_dir"`. Cuando el fixture
            # no declara [task].name, el slug efectivo es el nombre del
            # directorio, igual que upstream.
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

    # Positivos TB4: sin entrada en labels.json, la etiqueta es "pasa todo".
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
                "Positivo: pasa todas las compuertas del pack. Un FAIL aqui es falso positivo.",
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

    print(f"corpus.json  {len(rows)} tareas")
    for s, rs in sorted(by_src.items()):
        print(f"  {s:<14} {len(rs):>3}   etiquetas en scope G0: {sum(r['n_labels_g0'] for r in rs)}")
    if missing:
        print(f"  SIN CUERPO: {len(missing)} -> {missing}")

    cov = {}
    for r in rows:
        for c, v in r["labels_g0"].items():
            a, b = cov.get(c, (0, 0))
            cov[c] = (a + 1, b + (v == "pass"))
    print("\ncobertura de criterios en scope G0 (total / pass):")
    for c, (n, p) in sorted(cov.items(), key=lambda kv: -kv[1][0]):
        bal = "balanceado" if 0 < p < n else ("solo pass" if p == n else "solo fail")
        print(f"  {n:>3} / {p:>3} pass   {SCOPE[c]:<6} {c:<34} {bal}")


if __name__ == "__main__":
    main()
