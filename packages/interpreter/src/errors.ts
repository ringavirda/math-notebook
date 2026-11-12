/** A zero-based, end-exclusive character range over the input line. */
export interface Span {
  start: number;
  end: number;
}

/** The interpreter stage that raised an error. */
export type Stage = "lexical" | "syntax" | "semantic" | "evaluation";

/** Base of every error the interpreter raises about the input line. */
export abstract class MathError extends Error {
  abstract readonly stage: Stage;

  constructor(
    message: string,
    readonly span: Span,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

/** An unknown character or a malformed number. */
export class LexError extends MathError {
  readonly stage = "lexical";
}

/** A token sequence that does not fit the grammar. */
export class ParseError extends MathError {
  readonly stage = "syntax";
}

/** A tree that does not fit its scope: unknown name, wrong kind, wrong argument count. */
export class SemanticError extends MathError {
  readonly stage = "semantic";
}

/** A failure while computing a value: division by zero, a domain error, a non-finite result. */
export class EvalError extends MathError {
  readonly stage = "evaluation";
}
