import type { Reply } from "@mathbook/http";
import { MathError } from "@mathbook/interpreter";
import {
  DomainError,
  InvalidNameError,
  NotFoundError,
} from "@mathbook/notebook";

/**
 * Maps an error of the notebook to its answer: a `MathError` 400 with its stage, message and
 * span, an `InvalidNameError` 400 with stage `domain`, a `NotFoundError` 404, any other
 * `DomainError` 409.
 * @param error anything thrown while a route ran.
 * @returns the reply, or `undefined` when the error is none of these.
 */
export function describeNotebookError(error: unknown): Reply | undefined {
  if (error instanceof MathError) {
    return {
      status: 400,
      body: {
        error: {
          stage: error.stage,
          message: error.message,
          span: error.span,
        },
      },
    };
  }
  if (error instanceof DomainError) {
    return {
      status:
        error instanceof NotFoundError
          ? 404
          : error instanceof InvalidNameError
            ? 400
            : 409,
      body: { error: { stage: "domain", message: error.message } },
    };
  }
  return undefined;
}
