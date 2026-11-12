import { RequestError, readString, type Router } from "@mathbook/http";
import type { NotebookService } from "@mathbook/notebook";

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

/**
 * Adds the notebook routes: `GET /notebooks`, `POST /notebooks` with `{ "name" }` (201),
 * `GET /notebooks/:name`, `PATCH /notebooks/:name` with `{ "name" }`, `DELETE /notebooks/:name`
 * (204), `POST /notebooks/:name/run` with `{ "line" }`, `DELETE /notebooks/:name/definitions/:def`
 * (204), `GET /notebooks/:name/dependencies/:def`,
 * `GET /notebooks/:name/history?limit=10&failed` (`failed=true` also counts) and
 * `DELETE /notebooks/:name/history` (204). No route creates a notebook but `POST /notebooks`.
 * A body that is not JSON with the needed string, a bad `limit` or a bad `failed` answers 400
 * with stage `request` through the router's `RequestError`.
 * @param router the router to add the routes to.
 * @param service the notebook use cases the routes call.
 * @throws {Error} when the router already has one of these routes.
 */
export function addNotebookRoutes(
  router: Router,
  service: NotebookService,
): void {
  router.route("GET", "/notebooks", async () => ({
    status: 200,
    body: { notebooks: await service.list() },
  }));
  router.route("POST", "/notebooks", async ({ body }) => {
    const name = readString(body, "name");
    await service.create(name);
    return { status: 201, body: { name } };
  });
  router.route("GET", "/notebooks/:name", async ({ params }) => ({
    status: 200,
    body: {
      name: params.name,
      definitions: await service.show(params.name),
    },
  }));
  router.route("PATCH", "/notebooks/:name", async ({ params, body }) => {
    const name = readString(body, "name");
    await service.rename(params.name, name);
    return { status: 200, body: { name } };
  });
  router.route("DELETE", "/notebooks/:name", async ({ params }) => {
    await service.drop(params.name);
    return { status: 204 };
  });
  router.route("POST", "/notebooks/:name/run", async ({ params, body }) => ({
    status: 200,
    body: await service.run(params.name, readString(body, "line")),
  }));
  router.route(
    "DELETE",
    "/notebooks/:name/definitions/:definition",
    async ({ params }) => {
      await service.remove(params.name, params.definition);
      return { status: 204 };
    },
  );
  router.route(
    "GET",
    "/notebooks/:name/dependencies/:definition",
    async ({ params }) => ({
      status: 200,
      body: await service.dependencies(params.name, params.definition),
    }),
  );
  router.route(
    "GET",
    "/notebooks/:name/history",
    async ({ params, query }) => ({
      status: 200,
      body: {
        history: await service.history(params.name, {
          limit: parseLimit(query.get("limit")),
          failedOnly: parseFailed(query.get("failed")),
        }),
      },
    }),
  );
  router.route("DELETE", "/notebooks/:name/history", async ({ params }) => {
    await service.clearHistory(params.name);
    return { status: 204 };
  });
}
