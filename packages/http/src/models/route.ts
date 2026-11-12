import type { HttpRequest, Reply } from "./request.js";

/** A method and a path pattern with the code that answers them. */
export interface Route {
  readonly method: string;
  /** Path segments that are literals or `:name`, which matches any one segment. */
  readonly pattern: string;
  handler(request: HttpRequest): Promise<Reply>;
}
