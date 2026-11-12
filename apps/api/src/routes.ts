import { MathError } from "@mathbook/interpreter";
import {
  DomainError,
  InvalidNameError,
  NotFoundError,
  type NotebookService,
} from "@mathbook/notebook";

/** A JSON answer: the status code and the body, or no body for 204. */
export interface Reply {
  status: number;
  body?: unknown;
}

/** What the server read from one request. */
export interface Call {
  method: string;
  /** Path and query, as sent. */
  url: string;
  /** The raw body text; empty when there was none. */
  body: string;
}

/** A failure of the request itself, as opposed to the notebook. */
class RequestError extends Error {}

const requestError = (message: string): Reply => ({
  status: 400,
  body: { error: { stage: "request", message } },
});

function parseString(body: string, key: string): string {
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

function parseFailed(value: string | null): boolean {
  if (value === null) return false;
  if (value === "" || value === "true") return true;
  throw new RequestError("failed must be absent, failed or failed=true");
}

function parseLimit(value: string | null): number {
  if (value === null) return 10;
  const limit = Number(value);
  if (!Number.isInteger(limit) || limit < 1) {
    throw new RequestError("limit must be an integer of at least 1");
  }
  return limit;
}

async function dispatch(service: NotebookService, call: Call): Promise<Reply> {
  const url = new URL(call.url, "http://localhost");
  const parts = url.pathname
    .split("/")
    .slice(1)
    .map((part) => decodeURIComponent(part));
  if (parts.at(-1) === "") parts.pop();
  const [root, name, section, item] = parts;
  const notFound: Reply = {
    status: 404,
    body: { error: { stage: "request", message: "Not found" } },
  };
  if (root !== "notebooks" || parts.includes("")) return notFound;

  if (name === undefined) {
    if (call.method === "POST") {
      const created = parseString(call.body, "name");
      await service.create(created);
      return { status: 201, body: { name: created } };
    }
    if (call.method !== "GET") return notFound;
    return { status: 200, body: { notebooks: await service.list() } };
  }
  if (section === undefined) {
    if (call.method === "DELETE") {
      await service.drop(name);
      return { status: 204 };
    }
    if (call.method === "PATCH") {
      const renamed = parseString(call.body, "name");
      await service.rename(name, renamed);
      return { status: 200, body: { name: renamed } };
    }
    if (call.method !== "GET") return notFound;
    return {
      status: 200,
      body: { name, definitions: await service.show(name) },
    };
  }
  if (section === "run" && item === undefined && call.method === "POST") {
    return {
      status: 200,
      body: await service.run(name, parseString(call.body, "line")),
    };
  }
  if (section === "definitions" && item !== undefined && parts.length === 4) {
    if (call.method !== "DELETE") return notFound;
    await service.remove(name, item);
    return { status: 204 };
  }
  if (section === "dependencies" && item !== undefined && parts.length === 4) {
    if (call.method !== "GET") return notFound;
    return { status: 200, body: await service.dependencies(name, item) };
  }
  if (section === "history" && item === undefined && call.method === "DELETE") {
    await service.clearHistory(name);
    return { status: 204 };
  }
  if (section === "history" && item === undefined && call.method === "GET") {
    const history = await service.history(name, {
      limit: parseLimit(url.searchParams.get("limit")),
      failedOnly: parseFailed(url.searchParams.get("failed")),
    });
    return { status: 200, body: { history } };
  }
  return notFound;
}

/**
 * Answers one request from the notebook service.
 *
 * Routes: `GET /notebooks`, `POST /notebooks` with `{ "name" }` (201), `GET /notebooks/:name`,
 * `PATCH /notebooks/:name` with `{ "name" }`, `DELETE /notebooks/:name` (204),
 * `POST /notebooks/:name/run` with `{ "line" }`, `DELETE /notebooks/:name/definitions/:def`,
 * `GET /notebooks/:name/dependencies/:def`, `GET /notebooks/:name/history?limit=10&failed` (`failed=true` also counts),
 * `DELETE /notebooks/:name/history` (204). No route creates a notebook but `POST /notebooks`.
 * A `MathError` answers 400, an `InvalidNameError` 400 with stage `domain`, a `NotFoundError` 404,
 * any other `DomainError` 409, a bad request 400 with stage `request`, an unknown route 404.
 * @param service the notebook use cases.
 * @param call the request as read from the wire.
 * @param onUnexpected called with any other error, which answers 500 `Unexpected error`.
 * @returns the status and the JSON body of the answer.
 */
export async function handle(
  service: NotebookService,
  call: Call,
  onUnexpected: (error: unknown) => void,
): Promise<Reply> {
  try {
    return await dispatch(service, call);
  } catch (error) {
    if (error instanceof RequestError) return requestError(error.message);
    if (error instanceof URIError) return requestError("Bad path encoding");
    if (error instanceof MathError) {
      return {
        status: 400,
        body: {
          error: {
            stage: error.stage,
            message: error.message,
            span: error.span,
          },
        },
      };
    }
    if (error instanceof DomainError) {
      return {
        status:
          error instanceof NotFoundError
            ? 404
            : error instanceof InvalidNameError
              ? 400
              : 409,
        body: { error: { stage: "domain", message: error.message } },
      };
    }
    onUnexpected(error);
    return {
      status: 500,
      body: { error: { stage: "server", message: "Unexpected error" } },
    };
  }
}
