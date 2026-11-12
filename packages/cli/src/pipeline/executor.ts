import type { Command, Output } from "../models/command.js";
import {
  type CommandContext,
  type CommandStatus,
  type Middleware,
  UsageError,
} from "./middleware.js";

/**
 * Keeps the command list and runs one line of input through the middleware
 * pipeline into the command's action.
 */
export class Executor {
  private readonly commands: Command[] = [];
  private readonly middlewares: Middleware[] = [];
  private handler:
    ((line: string, context: CommandContext) => Promise<void>) | undefined;

  /** @param output where errors that leave the pipeline and unknown commands are printed. */
  constructor(private readonly output: Output) {}

  /**
   * Adds a command.
   *
   * @param command the command to add.
   * @throws {Error} when one of its selectors is already registered.
   */
  public registerCommand(command: Command): void {
    const existing = this.find(...command.selectors);
    if (existing !== undefined)
      throw new Error(
        `A command with the selectors ${existing.selectors.join(", ")} is already registered`,
      );
    this.commands.push(command);
  }

  /**
   * Adds a step around every command. The first one added is the outermost.
   *
   * @param middleware the step.
   */
  public use(middleware: Middleware): void {
    this.middlewares.push(middleware);
  }

  /**
   * Sets what runs for a line whose first word matches no command, in place of the `unknown`
   * status. The handler runs inside the middleware pipeline; the context's command is a stand-in
   * named after the first word that accepts any number of words.
   *
   * @param handler called with the trimmed line and the context.
   */
  public fallback(
    handler: (line: string, context: CommandContext) => Promise<void>,
  ): void {
    this.handler = handler;
  }

  /**
   * Runs one line of input. Problems are printed, never thrown.
   *
   * @param line the raw line, words split on whitespace.
   * @returns `"empty"` for a blank line, `"unknown"` for an unregistered
   * selector when no fallback is set (no middleware runs), `"usage"` or `"failed"` when an error left
   * the pipeline (a `UsageError` gives `"usage"`), else the status the
   * pipeline left in the context.
   */
  public async execute(line: string): Promise<CommandStatus> {
    const [selector, ...words] = line.trim().split(/\s+/);
    if (!selector) return "empty";

    const found = this.find(selector);
    const handler = this.handler;
    if (!found && !handler) {
      this.output.echoError(`Unknown command: ${selector}`);
      return "unknown";
    }

    const command: Command = found ?? {
      selectors: [selector],
      params: words.map(() => "word"),
      description: "",
      action: () => handler!(line.trim(), context),
    };
    const context: CommandContext = {
      command,
      selector,
      words,
      status: "ok",
    };
    const dispatch = async (index: number): Promise<void> => {
      const middleware = this.middlewares[index];
      if (middleware) await middleware(context, () => dispatch(index + 1));
      else await command.action(...words);
    };

    try {
      await dispatch(0);
    } catch (error) {
      this.output.echoError((error as Error).message);
      return error instanceof UsageError ? "usage" : "failed";
    }
    return context.status;
  }

  private find(...selectors: string[]): Command | undefined {
    return this.commands.find((c) =>
      c.selectors.some((s) => selectors.includes(s)),
    );
  }
}
