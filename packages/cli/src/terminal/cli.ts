import chalk, { chalkStderr } from "chalk";
import type { Readable, Writable } from "node:stream";
import { createInterface } from "node:readline/promises";

/**
 * Terminal input and output: a prompt that reads one line at a time, plain lines on the output,
 * red error lines on the error stream and bold red title lines.
 */
export class CLI {
  private readonly rl;
  private readonly lines;
  private closed = false;
  private shut = false;

  /**
   * @param input where lines come from.
   * @param output where prompts and messages go.
   * @param errors where error messages go.
   */
  constructor(
    input: Readable = process.stdin,
    private readonly output: Writable = process.stdout,
    private readonly errors: Writable = process.stderr,
  ) {
    this.rl = createInterface({ input, output: this.output });
    this.lines = this.rl[Symbol.asyncIterator]();
    this.rl.on("close", () => {
      this.closed = true;
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
    if (this.closed) {
      this.output.write(`${prompt} `);
      if (this.shut) return null;
    } else {
      this.rl.setPrompt(`${prompt} `);
      this.rl.prompt();
    }
    const { value, done } = await this.lines.next();
    return done ? null : value;
  }

  /**
   * Prints a line to the output.
   *
   * @param message text to print, an empty line when omitted.
   */
  public echo(message: string = ""): void {
    this.output.write(`${message}\n`);
  }

  /** Prints a line to the error stream in red, after an underlined `Err:`. */
  public echoError(message: string): void {
    this.errors.write(
      `${chalkStderr.red(`${chalkStderr.underline("Err:")} ${message}`)}\n`,
    );
  }

  /** Prints a line to the output in bold red. */
  public echoTitle(message: string): void {
    this.echo(chalk.bold.red(message));
  }

  /** Closes the input. Safe to call more than once. */
  public close(): void {
    this.shut = true;
    this.rl.close();
  }
}
