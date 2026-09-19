#!/usr/bin/env node
// G0 — capa determinística sobre un instruction.md, desde la terminal.
//
// Sin API, sin key, sin red. Es la Capa 1 del SPEC y nada más: NO emite
// EMPEZAR. Ese veredicto necesita las sondas (§4), y un verde acá sería
// exactamente el falso verde que el §1 dice que es peor que no tener
// herramienta.
//
//   g0 <ruta>              instruction.md, o el directorio que lo contiene
//   g0 -                   lee el prompt de stdin
//
//   --slug <s>        slug propuesto; habilita el check de task_name
//   --timeout <n>     [agent].timeout_sec; habilita el check exacto del trailer
//   --workdir <d>     WORKDIR del entorno (default /app)
//   --cites           muestra la cita de la rúbrica de cada hallazgo
//   --json            salida cruda para scripts
//
// Salida: 0 si no hay blockers, 1 si hay alguno.

import { readFileSync, existsSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { runStatic } from "../src/lib/checks/static.ts";
import type { Finding, Severity } from "../src/lib/checks/types.ts";

// ---------------------------------------------------------------------------
// presentación

const TTY = process.stdout.isTTY === true && !process.env.NO_COLOR;
const c = (code: string) => (s: string) => (TTY ? `\x1b[${code}m${s}\x1b[0m` : s);
const bold = c("1");
const dim = c("2");
const red = c("31");
const yellow = c("33");
const blue = c("34");
const green = c("32");

const SEV: Record<Severity, { label: string; paint: (s: string) => string; blurb: string }> = {
  blocker: {
    label: "BLOQUEA",
    paint: red,
    blurb: "La review lo va a marcar. Arreglalo antes de construir.",
  },
  warn: {
    label: "RIESGO",
    paint: yellow,
    blurb: "Riesgo real que depende de contexto que G0 no ve. Decidís vos.",
  },
  todo: {
    label: "PENDIENTE",
    paint: blue,
    blurb: "Mecánico, de la etapa de empaquetado. No bloquea el borrador.",
  },
  info: { label: "DATO", paint: dim, blurb: "Señal sin veredicto." },
};

const ORDER: Severity[] = ["blocker", "warn", "todo", "info"];

function render(findings: Finding[], showCites: boolean): void {
  for (const sev of ORDER) {
    const group = findings.filter((f) => f.severity === sev);
    if (!group.length) continue;

    const { label, paint, blurb } = SEV[sev];
    console.log(`\n${paint(bold(label))} ${dim("— " + blurb)}\n`);

    for (const f of group) {
      const where = f.line ? dim(` (línea ${f.line})`) : "";
      console.log(`  ${paint("•")} ${f.message}${where}`);
      if (f.excerpt) console.log(`    ${dim("en:")} ${JSON.stringify(f.excerpt)}`);
      if (f.fix) console.log(`    ${green("→")} ${f.fix}`);
      if (showCites) console.log(`    ${dim("rúbrica: " + f.rule)}`);
      console.log(`    ${dim(`[${f.criterion} · ${f.check}]`)}`);
      console.log();
    }
  }
}

// ---------------------------------------------------------------------------
// entrada

interface Args {
  path?: string;
  slug?: string;
  timeout?: number;
  workdir?: string;
  cites: boolean;
  json: boolean;
  help: boolean;
}

function parseArgs(argv: string[]): Args {
  const a: Args = { cites: false, json: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t === "--cites") a.cites = true;
    else if (t === "--json") a.json = true;
    else if (t === "-h" || t === "--help") a.help = true;
    else if (t === "--slug") a.slug = argv[++i];
    else if (t === "--workdir") a.workdir = argv[++i];
    else if (t === "--timeout") a.timeout = Number(argv[++i]);
    else if (!a.path) a.path = t;
  }
  return a;
}

const USAGE = `
G0 — chequeo determinístico de un prompt de Terminal-Bench 4.0

  g0 <instruction.md | directorio>
  cat prompt.md | g0 -

  --slug <s>       slug propuesto (si das un directorio, se toma su nombre)
  --timeout <n>    [agent].timeout_sec (si hay task.toml al lado, se lee solo)
  --workdir <d>    WORKDIR del entorno (default /app)
  --cites          muestra la cita textual de la rúbrica en cada hallazgo
  --json           salida cruda

Sale 0 si no hay blockers, 1 si hay alguno.
`;

/**
 * [agent].timeout_sec de un task.toml.
 *
 * Tiene que ser consciente de la seccion: un task.toml real trae varios
 * `timeout_sec` —[verifier] y [verifier.environment] vienen ANTES que [agent]—
 * y agarrar el primero hace que el check del trailer compare contra el numero
 * equivocado. Eso produjo un blocker falso sobre runner-failure-visibility,
 * que es uno de los positivos del corpus.
 */
export function agentTimeout(toml: string): number | undefined {
  let inAgent = false;
  for (const raw of toml.split("\n")) {
    const line = raw.trim();
    if (line.startsWith("[")) {
      inAgent = line === "[agent]";
      continue;
    }
    if (!inAgent) continue;
    const m = line.match(/^timeout_sec\s*=\s*(\d+(?:\.\d+)?)/);
    if (m) return Number(m[1]);
  }
  return undefined;
}

/** Resuelve la entrada: archivo, directorio de tarea, o stdin. */
function load(p: string | undefined): { prompt: string; slug?: string; timeout?: number } {
  if (!p || p === "-") {
    return { prompt: readFileSync(0, "utf8") };
  }
  const abs = resolve(p);
  if (!existsSync(abs)) {
    console.error(`No existe: ${abs}`);
    process.exit(2);
  }

  // Un directorio de tarea trae más contexto que el prompt suelto: el nombre
  // del directorio ES el slug por convención de TB, y el task.toml de al lado
  // tiene el timeout. Aprovecharlos habilita dos checks que si no quedan mudos.
  if (statSync(abs).isDirectory()) {
    const md = join(abs, "instruction.md");
    if (!existsSync(md)) {
      console.error(`No hay instruction.md en ${abs}`);
      process.exit(2);
    }
    const toml = join(abs, "task.toml");
    let timeout: number | undefined;
    if (existsSync(toml)) timeout = agentTimeout(readFileSync(toml, "utf8"));
    return { prompt: readFileSync(md, "utf8"), slug: basename(abs), timeout };
  }

  return { prompt: readFileSync(abs, "utf8") };
}

// ---------------------------------------------------------------------------

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(USAGE.trim());
    return;
  }

  const src = load(args.path);
  const prompt = src.prompt;
  if (!prompt.trim()) {
    console.error("El prompt está vacío.");
    process.exit(2);
  }

  const slug = args.slug ?? src.slug;
  const res = runStatic({
    prompt,
    slug,
    agentTimeoutSec: args.timeout ?? src.timeout,
    workingDir: args.workdir,
  });

  if (args.json) {
    console.log(JSON.stringify({ ...res, slug }, null, 2));
    process.exit(res.findings.some((f) => f.severity === "blocker") ? 1 : 0);
  }

  const n = (s: Severity) => res.findings.filter((f) => f.severity === s).length;
  const blockers = n("blocker");

  console.log(bold(`\nG0 · capa determinística`));
  console.log(
    dim(
      `${args.path && args.path !== "-" ? args.path : "stdin"}` +
        `${slug ? ` · slug '${slug}'` : ""} · ${res.signals.words} palabras`,
    ),
  );

  if (!res.findings.length) {
    console.log(green("\nSin hallazgos en la capa determinística."));
  } else {
    render(res.findings, args.cites);
  }

  console.log(
    `${bold("Resumen:")} ${blockers} bloquean · ${n("warn")} riesgos · ${n("todo")} pendientes de empaquetado`,
  );

  // Lo que esta capa NO decide. Sin esto, un "sin hallazgos" se lee como
  // permiso para construir, y ese es el falso verde del SPEC §1.
  console.log(
    dim(
      "\nEsto es la Capa 1: lo que un regex puede probar. No dice si conviene\n" +
        "empezar — dificultad, novedad y derivabilidad se deciden en las sondas,\n" +
        "que todavía no están. Un cero acá no es luz verde.",
    ),
  );
  if (!args.cites) console.log(dim("Con --cites ves la oración de la rúbrica detrás de cada hallazgo."));

  process.exit(blockers > 0 ? 1 : 0);
}

// Solo corre si lo invocaron directo. Sin esto, importar el modulo —un test,
// o la futura ruta de API— dispara main() y se queda colgado leyendo stdin.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
