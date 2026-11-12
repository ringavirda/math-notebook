import { describe, expect, it } from "vitest";
import { LexError, tokenize } from "../src/index.js";

describe("tokenize", () => {
  it.each([
    ["12", [["number", "12", 0, 2]]],
    ["3.5", [["number", "3.5", 0, 3]]],
    [".5", [["number", ".5", 0, 2]]],
    ["1e-3", [["number", "1e-3", 0, 4]]],
    ["2E+4", [["number", "2E+4", 0, 4]]],
    ["_a1", [["name", "_a1", 0, 3]]],
    [
      "f(a, b) = a",
      [
        ["name", "f", 0, 1],
        ["lparen", "(", 1, 2],
        ["name", "a", 2, 3],
        ["comma", ",", 3, 4],
        ["name", "b", 5, 6],
        ["rparen", ")", 6, 7],
        ["equals", "=", 8, 9],
        ["name", "a", 10, 11],
      ],
    ],
    [
      "1 + 2^3",
      [
        ["number", "1", 0, 1],
        ["operator", "+", 2, 3],
        ["number", "2", 4, 5],
        ["operator", "^", 5, 6],
        ["number", "3", 6, 7],
      ],
    ],
  ])("splits %j", (line, expected) => {
    const tokens = tokenize(line).map((t) => [
      t.kind,
      t.text,
      t.span.start,
      t.span.end,
    ]);
    expect(tokens.slice(0, -1)).toEqual(expected);
  });

  it("ends with an end token at the line length", () => {
    expect(tokenize("1  ").at(-1)).toEqual({
      kind: "end",
      text: "",
      span: { start: 3, end: 3 },
    });
    expect(tokenize("")).toHaveLength(1);
  });

  it.each([
    ["2 $ 3", "Unknown character '$'", 2, 3],
    ["1.2.3", "Malformed number '1.2.3'", 0, 5],
    ["1e", "Malformed number '1e'", 0, 2],
    ["2x", "Malformed number '2x'", 0, 2],
    ["1 + .", "Malformed number '.'", 4, 5],
  ])("rejects %j", (line, message, start, end) => {
    const error = (() => {
      try {
        tokenize(line);
      } catch (e) {
        return e;
      }
    })();
    expect(error).toBeInstanceOf(LexError);
    expect(error).toMatchObject({
      message,
      span: { start, end },
      stage: "lexical",
    });
  });
});
