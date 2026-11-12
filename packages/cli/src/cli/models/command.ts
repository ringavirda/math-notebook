/** A command the executor can run. */
export interface Command {
  /** Words that run the command; the first one is its main name. */
  readonly selectors: readonly string[];
  /** Parameter names; a trailing `?` marks an optional one. */
  readonly params: readonly string[];
  /** One line for the command list. */
  readonly description: string;
  /** Extra lines shown by `help <command>`. */
  readonly help?: readonly string[];
  /** Called with the words after the selector. */
  action(...words: string[]): void | Promise<void>;
}

/** Where the executor prints. `CLI` fits it. */
export interface Output {
  echo(message?: string): void;
  echoError(message: string): void;
}
