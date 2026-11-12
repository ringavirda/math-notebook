import { describe, expect, it } from "vitest";
import { EvalError } from "@mathbook/interpreter";
import { StorageError } from "@mathbook/notebook";
import { describeNotebookError } from "../../src/http/errors.js";

describe("describeNotebookError", () => {
  it("answers a MathError 400 with its stage, message and span", () => {
    const error = new EvalError("Division by zero", { start: 2, end: 3 });
    expect(describeNotebookError(error)).toEqual({
      status: 400,
      body: {
        error: {
          stage: "evaluation",
          message: "Division by zero",
          span: { start: 2, end: 3 },
        },
      },
    });
  });

  it("leaves an error it does not know to the pipeline", () => {
    expect(
      describeNotebookError(new StorageError("main", "x")),
    ).toBeUndefined();
    expect(describeNotebookError(new Error("boom"))).toBeUndefined();
  });
});
