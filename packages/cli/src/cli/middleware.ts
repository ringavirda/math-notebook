import type { Command } from "./models/command.js";

/** What one command line looked like to the pipeline. */
export interface CommandContext {
  readonly command: Command;
  /** The word the user typed to pick the command. */
  readonly selector: string;
  /** The words after the selector. */
  readonly words: readonly string[];
  /** Starts as `"ok"`; a step that handles an error sets it. */
  status: "ok" | "usage" | "failed";
}

/** One step around a command. Calling `next` runs the rest of the pipeline. */
export type Middleware = (
  context: CommandContext,
  next: () => Promise<void>,
) => Promise<void>;

/** The result of `Executor.execute`. */
export type CommandStatus = "ok" | "empty" | "unknown" | "usage" | "failed";

/** A command used wrongly: unknown word, too few or too many arguments. */
export class UsageError extends Error {
  override name = "UsageError";
}

export const isOptional = (param: string): boolean => param.endsWith("?");

export const formatParams = (params: readonly string[]): string =>
  params
    .map((p) => (isOptional(p) ? `[${p.slice(0, -1)}]` : `<${p}>`))
    .join(" ");

/**
 * Checks the word count against the command's params.
 *
 * @throws {UsageError} `Usage: <selector> <params>` when there are fewer words
 * than required params or more than params.
 */
export const checkArguments: Middleware = async (context, next) => {
  const { command, words } = context;
  const required = command.params.filter((p) => !isOptional(p)).length;
  if (words.length < required || words.length > command.params.length) {
    const params = formatParams(command.params);
    throw new UsageError(
      `Usage: ${[command.selectors[0], params].filter(Boolean).join(" ")}`,
    );
  }
  await next();
};
