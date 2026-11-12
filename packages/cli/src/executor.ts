import {
  type CommandContext,
  type CommandStatus,
  type Middleware,
  UsageError,
  formatParams,
} from "./middleware.js";
import type { Command, Output } from "./models/command.js";

const formatCommand = ({ selectors, params, description }: Command): string =>
  `  ${[selectors.join(", "), formatParams(params)].filter(Boolean).join(" ")} - ${description}`;

/**
 * Keeps the command list and runs one line of input through the middleware
 * pipeline into the command's action.
 */
export class Executor {
  private readonly _commands: Command[] = [];
  private readonly _middlewares: Middleware[] = [];
  private _fallback:
    ((line: string, context: CommandContext) => Promise<void>) | undefined;

  /**
   * Registers the `help` and `h` command.
   *
   * @param _output where messages go.
   */
  constructor(private readonly _output: Output) {
    this.registerCommand({
      selectors: ["help", "h"],
      params: ["command?"],
      description: "Show the command list or one command.",
      action: (word?: string) => this.help(word),
    });
  }

  /**
   * Adds a command.
   *
   * @param command the command to add.
   * @param override replace the command that holds one of its selectors, in
   * its position, instead of throwing.
   * @throws {Error} when a selector is already registered and `override` is
   * not set.
   */
  public registerCommand(command: Command, override: boolean = false): void {
    const existing = this._commands.find((c) =>
      c.selectors.some((s) => command.selectors.includes(s)),
    );
    if (existing !== undefined) {
      if (!override)
        throw new Error(
          `Command with selectors (${existing.selectors.join(
            ", ",
          )}) already exists! Use override flag to replace it.`,
        );
      this._commands.splice(this._commands.indexOf(existing), 1, command);
      return;
    }
    this._commands.push(command);
  }

  /**
   * Removes the command that holds a selector.
   *
   * @param selector any selector of the command.
   * @throws {Error} when no command holds it.
   */
  public unregisterCommand(selector: string): void {
    const index = this._commands.findIndex((c) =>
      c.selectors.includes(selector),
    );
    if (index === -1)
      throw new Error(`Cannot find command with selector: ${selector}`);
    this._commands.splice(index, 1);
  }

  /**
   * Adds a step around every command. The first one added is the outermost.
   *
   * @param middleware the step.
   */
  public use(middleware: Middleware): void {
    this._middlewares.push(middleware);
  }

  /**
   * Sets what runs for a line whose first word matches no command, in place of the `unknown`
   * status. The handler runs inside the middleware pipeline; the context's command is a stand-in
   * named after the first word that accepts any number of words. The `help` and `h` commands
   * are registered, so a line starting with either never reaches the handler unless
   * `unregisterCommand` removed them.
   *
   * @param handler called with the trimmed line and the context.
   */
  public fallback(
    handler: (line: string, context: CommandContext) => Promise<void>,
  ): void {
    this._fallback = handler;
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
    const handler = this._fallback;
    if (!found && !handler) {
      this._output.echoError(`Unknown command: ${selector}`);
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
      const middleware = this._middlewares[index];
      if (middleware) await middleware(context, () => dispatch(index + 1));
      else await command.action(...words);
    };

    try {
      await dispatch(0);
    } catch (error) {
      this._output.echoError((error as Error).message);
      return error instanceof UsageError ? "usage" : "failed";
    }
    return context.status;
  }

  private find(selector: string): Command | undefined {
    return this._commands.find((c) => c.selectors.includes(selector));
  }

  private help(word?: string): void {
    if (!word) {
      for (const command of this._commands)
        this._output.echo(formatCommand(command));
      return;
    }
    const command = this.find(word);
    if (!command) throw new UsageError(`Unknown command: ${word}`);
    this._output.echo(formatCommand(command));
    for (const line of command.help ?? []) this._output.echo(line);
  }
}
