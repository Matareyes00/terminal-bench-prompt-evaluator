# prompt-evaluator-tbench4

Compuerta G0 para tareas de Terminal-Bench 4.0: alguien pega el prompt que
piensa construir, y la herramienta dice **si conviene empezar**.

No aprueba tareas. El aprobar/rechazar del paquete completo pertenece a la tool
de empaquetamiento del equipo. Por qué esa división existe, y con qué evidencia
se tomó, está en **[SPEC.md](SPEC.md)** — ese es el documento a leer, no éste.

## Estado

| Fase | Qué | Estado |
|---|---|---|
| 0 | Corpus etiquetado | hecho — 63 tareas |
| 1 | Capa determinística | hecho — gate en verde |
| 2 | Sondas (OpenRouter) | pendiente, falta la key |
| 3 | Derivación del dial | pendiente |
| 4 | Web UI + deploy | pendiente |

## Requisitos

Node **>= 22.6** (`--experimental-strip-types`). Esta fijado en tres lados:
`engines.node` de `package.json`, `.nvmrc`, y el runtime de las funciones en
`vercel.json`. En un Node mas viejo los comandos de abajo fallan con
`bad option`; ahi corre con `npx tsx <archivo>`, que no toca la instalacion
global.

## El CLI

Lo que el equipo puede usar hoy: la capa deterministica sobre un
`instruction.md`, sin key y sin red.

```bash
npm run g0 -- path/a/la-tarea            # directorio: toma el slug y el timeout
npm run g0 -- path/a/instruction.md
cat prompt.md | npm run g0 -- -          # por stdin
npm run g0 -- path/a/la-tarea --cites    # con la cita de la rubrica
npm run g0 -- path/a/instruction.md --json
```

Apuntado a un **directorio** de tarea saca dos cosas mas del contexto: el
nombre del directorio como slug (habilita `task_name`) y `[agent].timeout_sec`
del `task.toml` de al lado (habilita el check exacto del trailer).

Sale **0** si no hay blockers y **1** si hay alguno, asi que sirve en un hook o
en CI. No emite `EMPEZAR`: eso necesita las sondas, y un verde de Capa 1 no es
luz verde (SPEC 1 y 5).

## Correr lo que hay

```bash
python3 corpus/build_corpus.py                       # reconstruye corpus.json
node --experimental-strip-types eval/run-static.ts   # mide contra el corpus
node --experimental-strip-types eval/run-static.ts --verbose
npm test                                             # regresiones del CLI
```

Resultados de Fase 1 en `eval/results/`, y comentados en SPEC.md 7.

## Estructura

```
cli/g0.ts                  el CLI: capa deterministica desde la terminal
corpus/build_corpus.py     arma el set etiquetado desde tres fuentes
corpus/corpus.json         63 tareas con etiquetas de rúbrica
src/lib/checks/types.ts    el contrato de salida (Finding, Severity, Verdict)
src/lib/checks/static.ts   la capa determinística
eval/run-static.ts         harness de medición + gate
SPEC.md                    cómo evalúa y por qué
```

## Reconstruir el corpus desde cero

`corpus/build_corpus.py` lee dos árboles externos:

- el starter pack TB4 (`PACK`), del que salen los 34 fixtures y los 2 positivos;
- el repo `laude-institute/terminal-bench` (`TB2REF`), del que salen los cuerpos
  de las 27 tareas tb2 etiquetadas.

Las rutas están al tope del script. Para el segundo alcanza un clone sin blobs:

```bash
git clone --filter=blob:none --no-checkout --depth 1 \
  https://github.com/laude-institute/terminal-bench.git tb2ref
```

y un sparse-checkout de `original-tasks/<nombre>/task.yaml` para las 27.

## Secretos

La key de OpenRouter va en env var del servidor y se lee sólo desde rutas de
API. Nunca llega al browser, nunca entra al repo, nunca aparece en un log.
Este proyecto tiene su propia key: no reutilizar la de otro proyecto.
