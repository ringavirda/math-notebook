import type { OutgoingHttpHeaders } from "node:http";

/** One request as a handler sees it. */
export interface HttpRequest {
  readonly method: string;
  /** The decoded path, without the query and the trailing slash. */
  readonly path: string;
  /** The values of the `:name` segments of the route's pattern, decoded. */
  readonly params: Readonly<Record<string, string>>;
  readonly query: URLSearchParams;
  /** The raw body text; empty when there was none. */
  readonly body: string;
}

/** A JSON answer: the status code and the body, or no body for an empty answer. */
export interface Reply {
  status: number;
  body?: unknown;
  headers?: OutgoingHttpHeaders;
}
