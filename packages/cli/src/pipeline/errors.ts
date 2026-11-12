import type { Logger } from "@mathbook/common";

import {
  UsageError,
  type CommandStatus,
  type Middleware,
} from "./middleware.js";
import type { Output } from "../models/command.js";

/**
 * Turns an error from the rest of the pipeline into printed lines and a status: `UsageError` is
 * `"usage"`, an instance of an expected class is `"failed"` with its own lines, anything else
 * prints `Unexpected error`, logs the stack at error level and is `"failed"`.
 *
 * @param cli where the error lines go.
 * @param logger where the stack of an unexpected error goes.
 * @param expected classes of errors that are the user's to read, not bugs.
 * @param describe the lines printed for an expected error; its message when omitted.
 */
export function mapErrors(
  cli: Output,
  logger: Logger,
  expected: readonly (abstract new (...args: never[]) => Error)[],
  describe: (error: Error) => string[] = (error) => [error.message],
): Middleware {
  return async (context, next) => {
    try {
      await next();
    } catch (error) {
      if (error instanceof UsageError) {
        cli.echoError(error.message);
        context.status = "usage";
      } else if (
        error instanceof Error &&
        expected.some((c) => error instanceof c)
      ) {
        for (const line of describe(error)) cli.echoError(line);
        context.status = "failed";
      } else {
        cli.echoError("Unexpected error");
        logger.error(
          error instanceof Error
            ? (error.stack ?? error.message)
            : String(error),
        );
        context.status = "failed";
      }
    }
  };
}

/**
 * Logs `<first selector> took <n> ms` at debug level around the rest of the pipeline, also when
 * it throws. `<n>` is whole milliseconds.
 *
 * @param logger where the line goes.
 */
export function timing(logger: Logger): Middleware {
  return async (context, next) => {
    const started = performance.now();
    try {
      await next();
    } finally {
      const elapsed = Math.round(performance.now() - started);
      logger.debug(`${context.command.selectors[0]} took ${elapsed} ms`);
    }
  };
}

/** Process exit code: 0 done, 1 the command failed, 2 the command was used wrongly. */
export type ExitCode = 0 | 1 | 2;

/**
 * @param status the result of running a command line.
 * @returns 0 for `ok` and `empty`, 1 for `failed`, 2 for `unknown` and `usage`.
 */
export function exitCode(status: CommandStatus): ExitCode {
  switch (status) {
    case "ok":
    case "empty":
      return 0;
    case "failed":
      return 1;
    case "unknown":
    case "usage":
      return 2;
  }
}
