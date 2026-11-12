import chalk, { chalkStderr } from "chalk";
import type { Readable, Writable } from "node:stream";
import { createInterface } from "node:readline/promises";

import type { EchoOptions } from "./models/echo.js";

/**
 * Terminal input and output: a prompt that reads one line at a time and
 * colored message helpers.
 */
export class CLI {
  private readonly _rl;
  private readonly _lines;
  private _closed = false;
  private _shut = false;

  /**
   * @param _input where lines come from.
   * @param _output where prompts and messages go.
   * @param _errors where error messages go.
   */
  constructor(
    input: Readable = process.stdin,
    private readonly _output: Writable = process.stdout,
    private readonly _errors: Writable = process.stderr,
  ) {
    this._rl = createInterface({ input, output: this._output });
    this._lines = this._rl[Symbol.asyncIterator]();
    this._rl.on("close", () => {
      this._closed = true;
    });
  }

  /**
   * Shows the prompt and waits for the next line.
   *
   * @param prompt text shown before the cursor.
   * @returns the line, or `null` when the input has ended (Ctrl+D, end of a
   * pipe, Ctrl+C) or after `close()`.
   */
  public async read(prompt: string): Promise<string | null> {
    if (this._closed) {
      this._output.write(`${prompt} `);
      if (this._shut) return null;
    } else {
      this._rl.setPrompt(`${prompt} `);
      this._rl.prompt();
    }
    const { value, done } = await this._lines.next();
    return done ? null : value;
  }

  /**
   * Prints a line to the output.
   *
   * @param message text to print, an empty line when omitted.
   * @param options color and style of the text.
   */
  public echo(message: string = "", options?: EchoOptions): void {
    let text = message;
    if (options?.color) text = chalk[options.color](text);
    if (options?.underline) text = chalk.underline(text);
    if (options?.bold) text = chalk.bold(text);
    this._output.write(`${text}\n`);
  }

  /** Prints a line to the output in green. */
  public echoSuccess(message: string): void {
    this.echo(chalk.green(message));
  }

  /** Prints a line to the output in yellow, after an underlined `Warn:`. */
  public echoWarn(message: string): void {
    this.echo(chalk.yellow(`${chalk.underline("Warn:")} ${message}`));
  }

  /** Prints a line to the error stream in red, after an underlined `Err:`. */
  public echoError(message: string): void {
    this._errors.write(
      `${chalkStderr.red(`${chalkStderr.underline("Err:")} ${message}`)}\n`,
    );
  }

  /** Prints a line to the output in bold red. */
  public echoTitle(message: string): void {
    this.echo(chalk.bold.red(message));
  }

  /** Closes the input. Safe to call more than once. */
  public close(): void {
    this._shut = true;
    this._rl.close();
  }
}
