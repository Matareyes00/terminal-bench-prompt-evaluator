// Contrato de salida de G0. Estable: la UI, el harness de evaluacion y la
// documentacion generada leen exactamente esto.

/**
 * blocker : el prompt esta mal y la review lo va a marcar. Hay que arreglarlo
 *           antes de construir.
 * warn    : riesgo real, pero depende de contexto que G0 no ve. El autor decide.
 * todo    : mecanico y de la etapa de empaquetado. La tool del equipo lo cubre.
 *           No bloquea a alguien que todavia esta redactando el prompt.
 * info    : senal sin veredicto. Alimenta la capa de sondas.
 */
export type Severity = "blocker" | "warn" | "todo" | "info";

export type Verdict = "pass" | "fail" | "unknown" | "na";

/** Donde se decide cada criterio. Ver SPEC.md §2. */
export type Scope = "decide" | "advise" | "out";

export interface Finding {
  /** Nombre del criterio de rubric/task-implementation.toml. */
  criterion: string;
  /** Identificador del check que lo produjo. */
  check: string;
  severity: Severity;
  /** 1-indexado sobre el prompt tal como lo pego el autor. */
  line?: number;
  /** El fragmento exacto que disparo el hallazgo. */
  excerpt?: string;
  /** Que esta mal, en una oracion. */
  message: string;
  /** Que hacer. Ausente cuando no hay accion mecanica. */
  fix?: string;
  /**
   * La oracion de la rubrica o del check canonico que justifica el hallazgo.
   * Ningun check puede existir sin esto: la herramienta predice la review que
   * la tarea va a recibir, no inventa criterios propios.
   */
  rule: string;
}

export interface PromptInput {
  /** El texto que el autor pego. */
  prompt: string;
  /** Slug propuesto, si lo tiene. Habilita el check de task_name. */
  slug?: string;
  /** [agent].timeout_sec, si ya lo decidio. Habilita el check exacto del trailer. */
  agentTimeoutSec?: number;
  /** WORKDIR del entorno. Por defecto /app, igual que el check canonico. */
  workingDir?: string;
}

export interface StaticResult {
  findings: Finding[];
  /** Veredicto por criterio, derivado de los findings. */
  byCriterion: Record<string, Verdict>;
  /** Senales sin veredicto que consume la capa de sondas. */
  signals: Record<string, number | string | boolean>;
}
