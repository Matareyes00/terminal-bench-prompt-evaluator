# G0 — Cómo evalúa prompts de Terminal-Bench 4.0, y por qué

Este documento es el contrato. No describe la arquitectura: describe qué mira
la herramienta, qué decide, qué se niega a decidir, y con qué evidencia.
Cualquier persona que continúe el build —acá, en Claude Code local, o en
Antigravity— trabaja contra esto.

---

## 1. El problema, medido

El pedido original fue: una web tool donde alguien pega su prompt y la
herramienta dice si tiene que subir o bajar la complejidad, para evitar dos
extremos — una tarea tan básica que no puede romper el benchmark, y una tan
difícil que fracasa por imposible en vez de por difícil.

Antes de construir eso conté los hallazgos bloqueantes del feedback de TB4 del
2026-09-16: **72 hallazgos en 6 tareas revisadas**.

| Familia | Hallazgos |
|---|---:|
| Arquitectura de verifier | ~30 |
| Explicaciones y README | ~18 |
| Metadata y policy | ~20 |
| Especificación (prompt ↔ tests) | ~9 |
| **Calibración de dificultad** | **1** |

Uno solo. Y ese uno (`essential_difficulty` en `hermes-stale-serve-accounting`)
dice "tests impose unstated creation-time tolerance, output sanitization, unit
syntax" — es un problema de especificación, no de calibración.

Ninguna de las 6 murió por trivial. Ninguna murió por imposible.

**Consecuencia de diseño.** El dial de complejidad sigue existiendo, porque el
desperdicio que describe es real: alguien quema tokens construyendo algo que no
puede romper el benchmark. Pero un dial solo daría luz verde a prompts que
después mueren por veinte criterios que el prompt no puede ver. El falso verde
es peor que no tener herramienta, porque la persona construye con permiso.

Por eso G0 **nunca aprueba una tarea**. G0 decide **si conviene empezar**. El
aprobar/rechazar del paquete completo pertenece a la tool de empaquetamiento
que construye el equipo.

---

## 2. Alcance: qué decide G0

Los 35 criterios de `rubric/task-implementation.toml` se reparten en tres.

### `decide` — G0 emite veredicto

`instruction_concision`, `typos`, `task_name`, `structured_data_schema`,
`difficult`, `interesting`, `novel`, `agentic`, `solvable`,
`essential_difficulty`, `category_and_tags`, `expert_time_estimate`,
`difficulty_explanation_quality`, `solution_explanation_quality`,
`verification_explanation_quality`.

### `advise` — G0 ve el síntoma, la prueba está en el paquete

`outcome_verified`, `test_instruction_alignment`, `do_not_modify_enforced`,
`reviewable`.

`outcome_verified` empezó en `decide` y bajó acá por evidencia, no por
prudencia: `prove-plus-comm` tiene una lista numerada de cuatro pasos en la
instrucción y el etiquetador humano igual le puso PASS en `outcome_verified`
(y FAIL en `instruction_concision`). El criterio pesa sobre todo si los *tests*
gradúan proceso, y G0 no ve los tests. Ver §7.

### `out` — de la tool de empaquetamiento

Los 16 restantes: verifier, Docker, `task.toml`, artifacts, reward.

### La frontera sin dueño

Cuatro criterios necesitan prompt **y** tests a la vez:
`test_instruction_alignment`, `outcome_verified`, `essential_difficulty`,
`do_not_modify_enforced`. Fueron 9 de los 72. Una tool mecánica de
empaquetamiento no los ve; el prompt solo tampoco.

**Decisión:** G0 los cubre **si el autor pega los tests**, en un campo opcional
colapsado, a partir de v1.1. Sólo producen findings `advise`, nunca `blocker`:
con los tests a la vista G0 puede señalar una assertion que ninguna oración del
prompt pide, pero no puede cerrar el criterio sin ver correr nada. Si el autor
no pega los tests, los cuatro quedan explícitamente **no cubiertos** y la UI lo
dice; no se simula cobertura.

---

## 3. Tres capas

| Capa | Costo | Qué decide |
|---|---|---|
| 1. Determinística | cero | Lo que un regex puede probar: headings, rutas, trailer, canary, slug, procedimiento enumerado, fuga de PR/commit |
| 2. Sondas | 3 llamadas | Derivabilidad y memorización |
| 3. Auditoría de rúbrica | 2 llamadas | Los criterios de juicio, con el `guidance` textual del TOML |

**Presupuesto: ~5 llamadas por evaluación.** No 90. La forma equivocada es una
llamada por criterio: la Sonda 3 manda el subconjunto entero de criterios en una
sola salida estructurada por modelo, y la Sonda 2 no tiene llamada propia (§4).

**Ningún check existe sin una cita.** Cada `Finding` lleva un campo `rule` con
la oración de la rúbrica o del script canónico que lo justifica. La herramienta
predice la review que la tarea va a recibir; no inventa criterios propios. Un
check sin cita es una opinión, y una opinión que bloquea el trabajo de alguien
es exactamente lo que este proyecto no puede permitirse.

### Severidades

| | Significado |
|---|---|
| `blocker` | El prompt está mal y la review lo va a marcar. Arreglar antes de construir. |
| `warn` | Riesgo real que depende de contexto que G0 no ve. Decide el autor. |
| `todo` | Mecánico, de la etapa de empaquetado. La tool del equipo lo cubre. |
| `info` | Señal sin veredicto. Alimenta la capa de sondas. |

El canary y el trailer son `todo`, no `blocker`. Un prompt en borrador todavía
no los tiene, y marcarlos en rojo enseña a ignorar la herramienta. Lo que sí
bloquea es un trailer **presente y deformado**: eso es un error del autor.

---

## 4. Las tres sondas (Fase 2–3)

La decisión metodológica central: **nunca le preguntamos a un modelo "qué tan
difícil es esto del 1 al 10".** Los modelos son malos juzgando dificultad, y la
semana pasada lo medimos: recortar el set graduado de una tarea bajó su
dificultad a través del prompt, no del denominador. Se mide, no se opina.

### Sonda 1 — Resolución a ciegas

**N = 3.** Se le da el prompt solo a tres modelos, sin repo ni entorno, y se les
pide la solución completa. No se les pide opinión.

Cada modelo devuelve `{archivo_o_símbolo, cambio_semántico_en_una_oración}`.

**Convergencia es estructural, no textual:** dos respuestas convergen si
coinciden **el lugar y la semántica**. Dos modelos que escriben el mismo parche
con distinto estilo convergen. Dos que tocan el mismo archivo por razones
distintas, no. Comparar diffs como texto mediría estilo de redacción.

| Resultado | Lectura | Veredicto |
|---|---|---|
| Los 3 convergen en el mismo fix concreto | derivable desde la prosa; el agente no necesita el entorno | **SUBIR** |
| Los 3 divergen entre sí | el prompt subdetermina el contrato | no es dificultad: especificar la interfaz |
| Los 3 piden ver el código | genuinamente agéntico | **OK** |

Es la regla de derivabilidad vuelta mecánica: *una vez leído, ¿el fix se
vuelve una transformación local obvia?* Alimenta `difficult`, `agentic`,
`essential_difficulty`.

### Sonda 2 — Reconocimiento

**No tiene llamada propia.** Va en la misma completion de la Sonda 1, pero
**después** del intento: "primero producí el fix; después, por separado, decime
si reconocés este codebase o problema". Preguntar antes contamina el intento —
el modelo deja de intentar y empieza a recordar. Preguntar después es gratis.

**La Sonda 2 nunca emite `blocker` por sí sola.** Un modelo puede nombrar con
total seguridad un PR que no existe, y un falso positivo acá bloquea trabajo
legítimo, que es exactamente lo que §3 dice que este proyecto no puede
permitirse.

La evidencia que cuenta no es que el modelo **nombre** un PR — eso es
verificable pero caro, y alucinable — sino que **produzca el fix concreto de un
codebase que no vio**. Eso es memorización se llame como se llame el PR.

| Evidencia | Salida |
|---|---|
| Un modelo dice reconocerlo | `warn`, con la afirmación citada textual |
| Dos modelos convergen independientemente en el mismo fix concreto | `blocker` |

Misma regla de convergencia que la Sonda 1.

`novel` es donde la capa determinística tiene 0 % de recall (§7), así que esta
sonda es su única fuente de señal. En el feedback de TB4, `novel` apareció en 2
de las 6 tareas revisadas, las dos por "the exact public PR".

**Trampa registrada.** 20 de las 27 tareas `tb2` traen `pr_numbers` / `pr_urls`
en `labels.json`. Parece ground truth de memorización y **no lo es**: son los
PRs de contribución de la tarea a `laude-institute/terminal-bench`
(`build-stp` → PR 934, `query-optimize` → PR 968), no el PR upstream del fix que
un modelo podría haber memorizado. Usarlos para validar la Sonda 2 daría falsos
positivos en masa. Lo que sí sirve: `novel` está etiquetado en 7 tareas `tb2`,
3 fail y 4 pass. Es chico, es evidencia humana, y ya está en el pack — es el
set contra el que se calibra esta sonda antes de que exista la key.

### Sonda 3 — Auditoría de contrato

Los criterios de juicio aplicados a la prosa, con el `guidance` **textual** del
TOML como prompt. Sin reformular: reformular es inventar un criterio nuevo.

Una llamada por modelo con todo el subconjunto de criterios en una salida
estructurada. Una llamada por criterio no compra nada y multiplica el costo por
quince.

### Consenso

**`anthropic/claude-opus-5` + `openai/gpt-5.6-sol`**, cruzado de vendor
obligatorio. Si discrepan, el veredicto es `NEEDS_HUMAN`, nunca un promedio.

El cruce no es preferencia. La rúbrica, en `verifiable`, acepta LLM-as-a-judge
sólo si puede mostrarse que casi nunca se equivoca, y propone como evidencia que
*"multiple different LLMs always make the same determination"*. Dos modelos de
la misma familia no son "different LLMs" en ningún sentido útil: comparten datos
y post-entrenamiento, y su acuerdo no es independiente. Estos dos además son
exactamente los que corre la CI de upstream, así que la coincidencia se puede
comparar con la de ellos.

---

## 5. El dial

El dial se **deriva** de las sondas. No se pregunta.

**SUBIR** si la Sonda 1 converge o la Sonda 2 reconoce el problema.
Criterios: `difficult`, `novel`, `agentic`.

**BAJAR** si la dificultad viene del volumen de trabajo o de detalle no
enunciado. La rúbrica define los dos límites, no hace falta inventarlos:

- `solvable`: *"solvable in a few hours at most by an expert human who knows
  the idea of the answer in advance… the difficulty should not be measured by
  how much work there is to be done."*
- `essential_difficulty`: *"FAIL if most failures would come from formatting
  edge cases, output precision, or clerical details rather than the core
  problem."*

"Imposible de resolver" casi nunca es conceptual. Es tolerancia no declarada.

**Salida:** veredicto global de tres estados.

| | Cuándo |
|---|---|
| `EMPEZAR` | Sin blockers, y las sondas no marcan derivabilidad ni memorización |
| `NO EMPEZAR` | Hay al menos un `blocker` |
| `REVISAR` | Sin blockers, pero los dos modelos discrepan en algún criterio (`NEEDS_HUMAN`) |

Nunca `aprobada`: eso pertenece al paquete completo, no a G0.

**Sin escala numérica.** El dial sale como texto más el criterio concreto que lo
motivó. Un score invita a optimizar el score, y lo que queremos que el autor
optimice es la tarea.

---

## 6. Corpus

`corpus/build_corpus.py` → `corpus/corpus.json`. 63 tareas, tres fuentes, todas
con etiqueta autoritativa.

| Fuente | n | Qué es |
|---|---:|---|
| `synthetic` | 34 | Fixtures de `scripts/checks/test-tasks/`. Cada uno falla un criterio a propósito. Negativos extremos. |
| `tb2` | 27 | Tareas reales de terminal-bench con etiquetas de evidencia humana en `labels.json`. Siete etiquetadas en 15–17 criterios con mezcla de pass y fail. **Este es el set que calibra.** |
| `tb4-positive` | 2 | `example/runner-failure-visibility` y `reference/vllm-deepseek-streaming`. Un blocker acá es falso positivo. |

Los cuerpos de las 27 tb2 no viajan en el starter pack; `labels.json` los
referencia por `ref.repo` + `ref.path`. Se recuperan de
`laude-institute/terminal-bench` bajo `original-tasks/`, donde las 27 están.
Usan `task.yaml` con la instrucción embebida, no `instruction.md`.

`template/repo-fix-task` **no** está entre los positivos: es un andamio con
marcadores (`<slug>`, `<Symptom first, …>`), no una tarea. Incluirlo fue un
error de la primera versión y producía un falso positivo legítimo en el check
de slug. Se sacó porque no es una tarea, no porque el check molestara.

### Límite honesto del corpus

Los 34 fixtures sintéticos son extremos: FizzBuzz para `novel`,
`reverse_string` para `difficult`. Separar FizzBuzz de una tarea real no prueba
gran cosa. Sirven para verificar que un check **dispara y se atribuye al
criterio correcto**, no para calibrar el límite fino. La calibración real
depende de las 27 tb2, y de las tareas que el equipo entregue a partir de ahora.

---

## 7. Resultados medidos — Fase 1

`node --experimental-strip-types eval/run-static.ts`

| Criterio | n | precisión | recall |
|---|---:|---:|---:|
| `instruction_concision` | 10 | 100 % | 100 % |
| `task_name` | 3 | 100 % | 100 % |
| `structured_data_schema` | 10 | 100 % | 100 % |
| `novel` | 10 | — | **0 %** |

**Gate de Fase 1: PASA.** Cero blockers sobre los positivos TB4.

Falsos negativos restantes: los cuatro de `novel` (FizzBuzz, `solve-sudoku`,
`prove-plus-comm`, `nginx-request-logging`). El de `instruction_concision`
(`raman-fitting`) se cerró con el check `input-path-missing` — ver §8.2.

**Los cuatro de `novel` se dejan sin arreglar a propósito.** Se podrían pasar a
verde con una lista negra de problemas conocidos, y eso haría la tabla más
linda sin mejorar nada: la lista no generaliza a la tarea 501. `novel` se
decide en la Sonda 2 o no se decide.

### La conclusión de la fase

La capa determinística decide **3 de los 15 criterios que G0 pretende decidir**
(el scope total es 19: 15 `decide` + 4 `advise`), y **nada** sobre dificultad ni
sobre novedad. Es seguro de bajo costo, no es el producto. Toda la señal que el
pedido original buscaba —subir o bajar complejidad— vive en la capa de sondas.

---

## 8. Abierto

1. **Key de OpenRouter.** Sin ETA. **OpenRouter es la política de producción,
   no la de desarrollo:** las sondas se desarrollan contra la key que tenga el
   equipo —Anthropic directo sirve— detrás de la abstracción de dos backends, y
   pasar a OpenRouter es una variable de entorno. En paralelo, las corridas
   contra el corpus se graban como fixtures para que la web quede demoable punta
   a punta sin ninguna key. La key vive **sólo** en env var del servidor: nunca
   en el cliente, nunca en el repo, nunca en un log. Este proyecto tiene su
   propia key; no reutilizar la de otro proyecto.

2. **`raman-fitting` — cerrado.** El fallo de `instruction_concision` es
   que **la instrucción nunca da la ruta del archivo de entrada**: dice *"You
   are given the output file of a Raman Setup"* y jamás lo nombra. El check de
   rutas busca rutas relativas y no puede ver una ruta **ausente**. Hace falta
   un check nuevo, no un ajuste del existente: *la tarea referencia un insumo
   que hay que leer y no da ninguna ruta absoluta para él*. Cita:
   `instruction_concision` — "They must use absolute paths (e.g., /app/data.csv,
   not data.csv)".

   **Implementado** como `checkInputPathMissing` (check 11 de `static.ts`). No
   alcanza con exigir "alguna ruta absoluta": `raman-fitting` **tiene** una,
   `/app/results.json`, pero es la salida. El check separa rutas de escritura
   de rutas de lectura por el verbo que las precede, y dispara sólo si el
   prompt referencia un insumo y **todas** sus rutas absolutas son de
   escritura. Sobre las 63 del corpus dispara en una sola tarea:
   `raman-fitting`, la etiquetada `fail`. Cero falsos positivos, y
   `instruction_concision` pasa de 75 % a 100 % de recall.

   **Descansa sobre n=1, y hay que decirlo.** "Dispara en 1 de 63" no es
   precision: 63 es el corpus, no el denominador. Medido, el denominador es 5 —
   solo 5 de las 63 cumplen la precondicion (el prompt referencia un insumo), y
   las 5 son `tb2`. De esas, dispara en 1: `raman-fitting`, la que lo motivo.
   Las otras 4 (`query-optimize`, `cartpole-rl-training`, `solve-sudoku`,
   `mailman`) no disparan porque si dan ruta de lectura, y eso se verifico a
   mano — pero las 4 tienen `instruction_concision` **sin etiquetar**, asi que
   ni siquiera son negativos confirmados. Lo que esta medido es que la
   discriminacion lectura/escritura funciona en 5 casos. Lo que no esta medido
   es la precision. Hasta que entren tareas nuevas que cumplan la precondicion,
   este check es una hipotesis bien fundada, no un resultado.

   Emite `blocker` aunque ningún script canónico lo emita, lo que diverge de la
   convención del check 2. La evidencia es distinta: acá hay un FAIL humano en
   `labels.json`, no un patrón de un script con bug. G0 predice la review, y la
   review es humana antes que CI.

3. **Fixtures grabados.** Un subconjunto demoable, no las 63: los 2 positivos y
   6 que ejerciten cada camino de veredicto. Clave del fixture = hash de
   (prompt + versión del prompt de sonda), para que se invaliden solos cuando
   cambie una sonda en vez de pudrirse en silencio.

4. **El loop de calibración.** La herramienta "predice la review que la tarea va
   a recibir", y hoy la única evidencia son las 6 tareas del feedback del
   2026-09-16. Sin reviews nuevas la calibración se congela donde está. El
   artefacto a pedirle al equipo es el `check_report.json` de `harbor check`:
   lo produce toda entrega, trae un veredicto por criterio, y no hay que
   inventar formato. Cadencia: uno por entrega.

5. **Calibración del dial** contra tareas con pass rate medido.
   `omnigent-host-lifecycle` de la semana pasada tiene 10 intentos y dos
   modelos; es el único prompt del que sabemos empíricamente qué hacen los
   modelos frontier. Vale más que cualquier fixture sintético. Lo que sirve de
   esa corrida es el `reward.txt` y el `summary.txt` por trial, más el conteo de
   F2P.

---

## 9. Cambios de alcance — cliente, 2026-09-18

Cuatro decisiones del cliente posteriores al §8. Donde contradicen algo de
arriba, mandan éstas.

### 9.1 Hay key de prueba

Las sondas se desarrollan **contra la API real**, no contra fixtures grabados.
Los fixtures siguen existiendo, pero su lugar son los tests, no el desarrollo:
un fixture grabado no descubre que una sonda estaba mal planteada. La key vive
en `.env.local` en la máquina donde corre el desarrollo, y en las env vars del
proyecto en Vercel. Nunca en el repo, nunca en el cliente, nunca en un log.

### 9.2 Los prompts se guardan

**Esto revierte la decisión de no persistir nada.** El motivo de no guardar era
proteger trabajo no publicado; el motivo de guardar es que el equipo necesita
ver qué están mandando los taskers, y ése gana.

Se guarda por evaluación: prompt, veredicto, findings, modelo y fecha. Vercel
Postgres, con un botón de export a CSV. Da el mismo resultado que una hoja de
cálculo sin manejar credenciales de Google. Si más adelante quieren que viva en
Drive, se agrega encima; no condiciona el esquema.

### 9.3 La UI es un textarea y un botón

El lector es alguien que **nunca leyó la rúbrica**. Cada finding dice qué está
mal y qué hacer, en español. La cita en inglés del campo `rule` va abajo y
colapsada: es la prueba de que el check no es una opinión, no es lo primero que
alguien necesita leer.

### 9.4 Orden: sondas primero, andamiaje después

`create-next-app` son cinco minutos y cero incertidumbre. Las sondas cargan
todo el riesgo: **si la convergencia del solve-a-ciegas no correlaciona con las
etiquetas de `novel` y `difficult`, la premisa de G0 cambia**, y una UI
construida encima es trabajo tirado. La medición es contra las 7 tareas `tb2`
con `novel` etiquetado — 3 fail, 4 pass (§4).

### 9.5 El CLI sale primero, esta semana

La capa determinística ya funciona y no necesita key. El ramp es del 18 al 22,
así que un comando sobre un `instruction.md` le sirve al equipo el lunes,
mientras la web todavía no existe. La web sirve cuando esté; el CLI sirve ahora.
