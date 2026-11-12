import { LexError, type Span } from "./errors.js";

export interface Token {
  kind:
    | "number"
    | "name"
    | "operator"
    | "lparen"
    | "rparen"
    | "comma"
    | "equals"
    | "end";
  text: string;
  span: Span;
}

const NUMBER = /(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/y;
const NAME = /[A-Za-z_][A-Za-z0-9_]*/y;
const WORD_CHAR = /[A-Za-z0-9_.]/;
const WORD_RUN = /[A-Za-z0-9_.]*/y;
const PUNCTUATION: Record<string, Token["kind"]> = {
  "(": "lparen",
  ")": "rparen",
  ",": "comma",
  "=": "equals",
};

function match(pattern: RegExp, line: string, at: number): string | undefined {
  pattern.lastIndex = at;
  return pattern.exec(line)?.[0];
}

/**
 * Splits one input line into tokens.
 * @param line the text to scan.
 * @returns the tokens in order, always ending with one `end` token at `line.length`.
 * @throws {LexError} on a character outside the language or a malformed number (`1.2.3`, `1e`, `2x`).
 */
export function tokenize(line: string): Token[] {
  const tokens: Token[] = [];
  let at = 0;
  while (at < line.length) {
    const char = line[at];
    if (/\s/.test(char)) {
      at += 1;
      continue;
    }
    const digitStart = /[\d.]/.test(char);
    if (digitStart) {
      const text = match(NUMBER, line, at);
      const run = match(WORD_RUN, line, at) ?? "";
      const glued =
        text !== undefined && WORD_CHAR.test(line[at + text.length] ?? "");
      if (text === undefined || glued) {
        const bad = run.length > 0 ? run : char;
        throw new LexError(`Malformed number '${bad}'`, {
          start: at,
          end: at + bad.length,
        });
      }
      tokens.push({
        kind: "number",
        text,
        span: { start: at, end: at + text.length },
      });
      at += text.length;
      continue;
    }
    const name = match(NAME, line, at);
    if (name !== undefined) {
      tokens.push({
        kind: "name",
        text: name,
        span: { start: at, end: at + name.length },
      });
      at += name.length;
      continue;
    }
    const kind = "+-*/%^".includes(char) ? "operator" : PUNCTUATION[char];
    if (kind === undefined) {
      throw new LexError(`Unknown character '${char}'`, {
        start: at,
        end: at + 1,
      });
    }
    tokens.push({ kind, text: char, span: { start: at, end: at + 1 } });
    at += 1;
  }
  tokens.push({
    kind: "end",
    text: "",
    span: { start: line.length, end: line.length },
  });
  return tokens;
}
