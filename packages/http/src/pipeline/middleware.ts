import type { HttpRequest, Reply } from "../models/request.js";
import type { Route } from "../models/route.js";

/** What one request looked like to the pipeline. */
export interface RequestContext {
  readonly route: Route;
  readonly request: HttpRequest;
}

/** One step around a handler. Calling `next` runs the rest of the pipeline. */
export type Middleware = (
  context: RequestContext,
  next: () => Promise<Reply>,
) => Promise<Reply>;

/** A request that is wrong in itself: a bad path, a body that is not what the route reads. */
export class RequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/**
 * Reads one string property of a JSON object body.
 *
 * @param body the raw body text.
 * @param key the property to read.
 * @returns the property's value.
 * @throws {RequestError} `Body is not valid JSON` when the text does not parse,
 * `Body needs a string "<key>"` when the property is missing or not a string.
 */
export function readString(body: string, key: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new RequestError("Body is not valid JSON");
  }
  const value = (parsed as Record<string, unknown> | null)?.[key];
  if (typeof value !== "string") {
    throw new RequestError(`Body needs a string "${key}"`);
  }
  return value;
}
