import { MathError, parse, type Stage } from "@mathbook/interpreter";
import type {
  DefinitionView,
  ErrorStage,
  EvaluationRecord,
  RunResult,
} from "@mathbook/notebook";

const STAGE_NAMES: Record<Stage, string> = {
  lexical: "Lexical",
  syntax: "Syntax",
  semantic: "Semantic",
  evaluation: "Evaluation",
};

/** @returns the value with up to 12 significant digits and no trailing zeros. */
export function formatNumber(value: number): string {
  return String(Number(value.toPrecision(12)));
}

/** @returns `name = value` for a variable, `f(a, b) = <body>` for a function. */
export function formatDefinition(definition: DefinitionView): string {
  if (definition.value !== undefined) {
    return `${definition.name} = ${formatNumber(definition.value)}`;
  }
  const line = parse(definition.source);
  const body = line.kind === "definition" ? line.body.toString() : "";
  return `${definition.name}(${definition.params.join(", ")}) = ${body}`;
}

/** @returns the lines printed for a run: the value, or the definition then each recomputed variable indented. */
export function formatResult(result: RunResult): string[] {
  if (result.kind === "expression") return [formatNumber(result.value)];
  return [
    formatDefinition(result.definition),
    ...result.recomputed.map(
      ({ name, value }) => `  ${name} = ${formatNumber(value)}`,
    ),
  ];
}

/**
 * @param error what the command line threw.
 * @param line the input line the error came from.
 * @returns for a `MathError` `<Stage> error: <message>`, the line and a caret line under the
 * span; else the message.
 */
export function describeError(error: Error, line: string): string[] {
  if (!(error instanceof MathError)) return [error.message];
  const width = Math.max(1, error.span.end - error.span.start);
  return [
    `${STAGE_NAMES[error.stage]} error: ${error.message}`,
    line,
    `${" ".repeat(error.span.start)}${"^".repeat(width)}`,
  ];
}

function describeFailure(error: {
  stage: ErrorStage;
  message: string;
}): string {
  return error.stage === "domain"
    ? error.message
    : `${STAGE_NAMES[error.stage]} error: ${error.message}`;
}

const pad = (n: number): string => String(n).padStart(2, "0");

/** @returns `YYYY-MM-DD HH:MM:SS` in the machine's time zone. */
function formatLocalTime(at: Date): string {
  const date = `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
  return `${date} ${pad(at.getHours())}:${pad(at.getMinutes())}:${pad(at.getSeconds())}`;
}

/** @returns `<local time> <source> => <result or error>` for one history entry. */
export function formatRecord(record: EvaluationRecord): string {
  const time = formatLocalTime(record.at);
  const outcome = record.error
    ? describeFailure(record.error)
    : record.result === null
      ? "defined"
      : formatNumber(record.result);
  return `${time} ${record.source} => ${outcome}`;
}
