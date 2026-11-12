export { analyze } from "./analyzer.js";
export {
  BinaryNode,
  CallNode,
  ExprNode,
  NameNode,
  NumberNode,
  UnaryNode,
} from "./ast.js";
export {
  EvalError,
  LexError,
  MathError,
  ParseError,
  SemanticError,
} from "./errors.js";
export type { Span, Stage } from "./errors.js";
export { functionBinding } from "./functionBinding.js";
export { tokenize } from "./lexer.js";
export type { Token } from "./lexer.js";
export { parse } from "./parser.js";
export type { Definition, Expression, Line } from "./parser.js";
export { builtins, isBuiltin, scopeOf } from "./scope.js";
export type { Binding, Scope } from "./scope.js";
