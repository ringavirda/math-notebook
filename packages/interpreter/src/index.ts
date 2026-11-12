export { analyze } from "./semantic/analyzer.js";
export {
  BinaryNode,
  CallNode,
  ExprNode,
  NameNode,
  NumberNode,
  UnaryNode,
} from "./syntax/ast.js";
export {
  EvalError,
  LexError,
  MathError,
  ParseError,
  SemanticError,
} from "./errors.js";
export type { Span, Stage } from "./errors.js";
export { functionBinding } from "./evaluation/functionBinding.js";
export { tokenize } from "./lexical/lexer.js";
export type { Token } from "./lexical/lexer.js";
export { parse } from "./syntax/parser.js";
export type { Definition, Expression, Line } from "./syntax/parser.js";
export { builtins, isBuiltin, scopeOf } from "./semantic/scope.js";
export type { Binding, Scope } from "./semantic/scope.js";
