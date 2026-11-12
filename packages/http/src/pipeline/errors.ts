import type { Logger } from "@mathbook/common";

import type { Reply } from "../models/request.js";
import { RequestError, type Middleware } from "./middleware.js";

/**
 * Turns an error from the rest of the pipeline into a reply: a `RequestError` answers 400 with
 * stage `request` and its message, an error `describe` knows answers what `describe` returns,
 * anything else answers 500 `Unexpected error` with stage `server` and logs the stack at error
 * level.
 *
 * @param logger where the stack of an unexpected error goes.
 * @param describe the reply for an error the app expects, or `undefined` for any other.
 */
export function mapErrors(
  logger: Logger,
  describe: (error: unknown) => Reply | undefined,
): Middleware {
  return async (_context, next) => {
    try {
      return await next();
    } catch (error) {
      if (error instanceof RequestError) {
        return {
          status: 400,
          body: { error: { stage: "request", message: error.message } },
        };
      }
      const reply = describe(error);
      if (reply !== undefined) return reply;
      logger.error(
        error instanceof Error ? (error.stack ?? error.message) : String(error),
      );
      return {
        status: 500,
        body: { error: { stage: "server", message: "Unexpected error" } },
      };
    }
  };
}

/**
 * Logs `<METHOD> <pattern> took <n> ms` at debug level around the rest of the pipeline, also
 * when it throws. `<n>` is whole milliseconds.
 *
 * @param logger where the line goes.
 */
export function timing(logger: Logger): Middleware {
  return async (context, next) => {
    const started = performance.now();
    try {
      return await next();
    } finally {
      const elapsed = Math.round(performance.now() - started);
      const { method, pattern } = context.route;
      logger.debug(`${method} ${pattern} took ${elapsed} ms`);
    }
  };
}
