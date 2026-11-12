import type { CLI } from "./cli.js";
import { exitCode, type ExitCode } from "./errors.js";
import type { Executor } from "./executor.js";

/**
 * Runs the words as one command line.
 *
 * @param executor runs the line.
 * @param words the command and its arguments, as given on the command line.
 * @returns the exit code for the result.
 */
export async function runOnce(
  executor: Executor,
  words: readonly string[],
): Promise<ExitCode> {
  return exitCode(await executor.execute(words.join(" ")));
}

/** Texts and words of an interactive session. */
export interface InteractiveOptions {
  /** Title lines printed before the first prompt. */
  readonly banner: readonly string[];
  /** Title line printed after the last line is read. */
  readonly goodbye: string;
  /** Text shown before each line; a function is called before every line. */
  readonly prompt: string | (() => string);
  /** Lines that end the session, compared trimmed and lower-cased; `:q`, `:quit`, `:exit` when omitted. */
  readonly quitWords?: readonly string[];
}

/**
 * Reads and runs one command per line until the input ends or a quit word is typed, then prints
 * the goodbye.
 *
 * @param cli where the prompt and the output go.
 * @param executor runs each line.
 * @param options banner, goodbye, prompt and quit words.
 */
export async function runInteractive(
  cli: CLI,
  executor: Executor,
  options: InteractiveOptions,
): Promise<void> {
  const quitWords = options.quitWords ?? [":q", ":quit", ":exit"];
  for (const line of options.banner) cli.echoTitle(line);
  for (;;) {
    const prompt =
      typeof options.prompt === "function" ? options.prompt() : options.prompt;
    const line = await cli.read(prompt);
    if (line === null || quitWords.includes(line.trim().toLowerCase())) break;
    await executor.execute(line);
  }
  cli.echoTitle(options.goodbye);
}
