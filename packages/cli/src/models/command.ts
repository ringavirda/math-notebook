/** A command the executor can run. */
export interface Command {
  /** Words that run the command; the first one is its main name. */
  readonly selectors: readonly string[];
  /** Parameter names; a trailing `?` marks an optional one. */
  readonly params: readonly string[];
  /** One line for the command list. */
  readonly description: string;
  /** Called with the words after the selector. */
  action(...words: string[]): void | Promise<void>;
}

/** Where the executor prints. `CLI` fits it. */
export interface Output {
  echo(message?: string): void;
  echoError(message: string): void;
}

/** @returns whether a parameter name marks an optional parameter (ends with `?`). */
export const isOptional = (param: string): boolean => param.endsWith("?");

/** @returns the parameters as `<required> [optional]`, empty for none. */
export const formatParams = (params: readonly string[]): string =>
  params
    .map((p) => (isOptional(p) ? `[${p.slice(0, -1)}]` : `<${p}>`))
    .join(" ");

/** @returns `  <selectors> <params> - <description>`, one line of a command list. */
export const formatCommand = ({
  selectors,
  params,
  description,
}: Command): string =>
  `  ${[selectors.join(", "), formatParams(params)].filter(Boolean).join(" ")} - ${description}`;
