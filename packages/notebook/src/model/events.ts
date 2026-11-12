import type { ErrorStage } from "./errors.js";

/** What the service publishes after a change or an evaluation. */
export type NotebookEvent =
  | { type: "defined"; notebook: string; name: string; source: string }
  | { type: "recomputed"; notebook: string; name: string; value: number }
  | { type: "removed"; notebook: string; name: string }
  | { type: "evaluated"; notebook: string; source: string; value: number }
  | {
      type: "failed";
      notebook: string;
      source: string;
      stage: ErrorStage;
      message: string;
    };

/** One line of text for an event, starting with `[<notebook>]`. */
export function describeEvent(event: NotebookEvent): string {
  const prefix = `[${event.notebook}]`;
  switch (event.type) {
    case "defined":
      return `${prefix} defined ${event.name}: ${event.source}`;
    case "recomputed":
      return `${prefix} recomputed ${event.name} = ${event.value}`;
    case "removed":
      return `${prefix} removed ${event.name}`;
    case "evaluated":
      return `${prefix} evaluated ${event.source} = ${event.value}`;
    case "failed":
      return `${prefix} failed ${event.source}: ${event.stage} error: ${event.message}`;
  }
}
