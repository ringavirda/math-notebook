import type { HttpRequest, Reply } from "../models/request.js";
import type { Route } from "../models/route.js";
import type { Middleware } from "./middleware.js";

const notFound: Reply = {
  status: 404,
  body: { error: { stage: "request", message: "Not found" } },
};

const segmentsOf = (path: string): string[] =>
  path === "/" ? [] : path.split("/").slice(1);

/**
 * Keeps the route table and runs one request through the middleware pipeline into the matching
 * route's handler.
 */
export class Router {
  private readonly routes: Route[] = [];
  private readonly middlewares: Middleware[] = [];

  /**
   * Adds a route.
   *
   * @param method the HTTP method, upper case.
   * @param pattern a path of `/`-separated segments, each a literal or `:name`.
   * @param handler answers a request the route matches.
   * @throws {Error} when the pattern does not start with `/`, or when a route with the same
   * method and the same shape of pattern (parameter names aside) is already added.
   */
  public route(
    method: string,
    pattern: string,
    handler: Route["handler"],
  ): void {
    if (!pattern.startsWith("/")) {
      throw new Error(`The pattern ${pattern} must start with /`);
    }
    const shape = (route: Route) =>
      segmentsOf(route.pattern)
        .map((s) => (s.startsWith(":") ? ":" : s))
        .join("/");
    const added: Route = { method, pattern, handler };
    const existing = this.routes.find(
      (r) => r.method === method && shape(r) === shape(added),
    );
    if (existing !== undefined) {
      throw new Error(
        `The route ${method} ${existing.pattern} is already added`,
      );
    }
    this.routes.push(added);
  }

  /**
   * Adds a step around every route's handler. The first one added is the outermost.
   *
   * @param middleware the step.
   */
  public use(middleware: Middleware): void {
    this.middlewares.push(middleware);
  }

  /**
   * Answers one request. A trailing slash is ignored and an empty segment matches nothing.
   *
   * @param call the request as read from the wire; `url` is the path and query as sent.
   * @returns the reply of the pipeline around the matching route, 404 with stage `request`
   * when no route has the path and the method (no middleware runs), 400 with stage `request`
   * when a path segment is not valid percent-encoding. Errors from the pipeline are thrown.
   */
  public async handle(call: {
    method: string;
    url: string;
    body: string;
  }): Promise<Reply> {
    const url = new URL(call.url, "http://localhost");
    let parts: string[];
    try {
      parts = segmentsOf(url.pathname).map((part) => decodeURIComponent(part));
    } catch {
      return {
        status: 400,
        body: { error: { stage: "request", message: "Bad path encoding" } },
      };
    }
    if (parts.at(-1) === "") parts.pop();
    if (parts.includes("")) return notFound;

    for (const route of this.routes) {
      if (route.method !== call.method) continue;
      const params = match(segmentsOf(route.pattern), parts);
      if (params === undefined) continue;
      const request: HttpRequest = {
        method: call.method,
        path: `/${parts.join("/")}`,
        params,
        query: url.searchParams,
        body: call.body,
      };
      const context = { route, request };
      const dispatch = (index: number): Promise<Reply> => {
        const middleware = this.middlewares[index];
        return middleware
          ? middleware(context, () => dispatch(index + 1))
          : route.handler(request);
      };
      return dispatch(0);
    }
    return notFound;
  }
}

function match(
  pattern: readonly string[],
  parts: readonly string[],
): Record<string, string> | undefined {
  if (pattern.length !== parts.length) return undefined;
  const params: Record<string, string> = {};
  for (const [i, segment] of pattern.entries()) {
    if (segment.startsWith(":")) params[segment.slice(1)] = parts[i]!;
    else if (segment !== parts[i]) return undefined;
  }
  return params;
}
