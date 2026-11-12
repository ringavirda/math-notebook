import { describe, expect, it } from "vitest";

import {
  Router,
  type HttpRequest,
  type Middleware,
  type Reply,
} from "../../src/index.js";

const ok = async (): Promise<Reply> => ({ status: 200 });
const call = (method: string, url: string, body = "") => ({
  method,
  url,
  body,
});

function echoing() {
  const router = new Router();
  const seen: HttpRequest[] = [];
  router.route("POST", "/notebooks/:name/definitions/:def", async (request) => {
    seen.push(request);
    return { status: 200, body: request.params };
  });
  return { router, seen };
}

describe("Router.handle", () => {
  it("passes decoded params, path, query and body to the handler", async () => {
    const { router, seen } = echoing();
    const reply = await router.handle(
      call("POST", "/notebooks/a%20b/definitions/x%2Fy?limit=3", "{}"),
    );
    expect(reply).toEqual({ status: 200, body: { name: "a b", def: "x/y" } });
    expect(seen[0]!.path).toBe("/notebooks/a b/definitions/x/y");
    expect(seen[0]!.query.get("limit")).toBe("3");
    expect(seen[0]!.body).toBe("{}");
    expect(seen[0]!.method).toBe("POST");
  });

  it("ignores one trailing slash", async () => {
    const { router } = echoing();
    expect(
      (await router.handle(call("POST", "/notebooks/a/definitions/b/"))).status,
    ).toBe(200);
  });

  it("answers 404 for an empty segment", async () => {
    const { router } = echoing();
    for (const url of [
      "/notebooks//definitions/b",
      "/notebooks/a/definitions//",
      "//notebooks/a/definitions/b",
    ]) {
      expect((await router.handle(call("POST", url))).status, url).toBe(404);
    }
  });

  it("reads a leading double slash as an empty segment, not a host", async () => {
    const router = new Router();
    router.route("GET", "/notebooks", ok);
    expect((await router.handle(call("GET", "//x/notebooks"))).status).toBe(404);
  });

  it("answers 404 for an empty leading segment a parameter would take", async () => {
    const router = new Router();
    router.route("GET", "/:a/b", ok);
    expect((await router.handle(call("GET", "//b"))).status).toBe(404);
    expect((await router.handle(call("GET", "/x/b"))).status).toBe(200);
  });

  it("answers 404 stage request for a wrong method", async () => {
    const { router } = echoing();
    expect(
      await router.handle(call("GET", "/notebooks/a/definitions/b")),
    ).toEqual({
      status: 404,
      body: { error: { stage: "request", message: "Not found" } },
    });
  });

  it("answers 404 for a path of another length", async () => {
    const { router } = echoing();
    expect(
      (await router.handle(call("POST", "/notebooks/a/definitions"))).status,
    ).toBe(404);
    expect(
      (await router.handle(call("POST", "/notebooks/a/definitions/b/c")))
        .status,
    ).toBe(404);
  });

  it("matches the root path", async () => {
    const router = new Router();
    router.route("GET", "/", ok);
    expect((await router.handle(call("GET", "/"))).status).toBe(200);
  });

  it("answers 400 for a bad percent-encoding", async () => {
    const { router } = echoing();
    expect(
      await router.handle(call("POST", "/notebooks/%E0%A4%A/definitions/b")),
    ).toEqual({
      status: 400,
      body: { error: { stage: "request", message: "Bad path encoding" } },
    });
  });

  it("does not run the middleware for an unknown route", async () => {
    const { router } = echoing();
    let ran = false;
    router.use(async (_context, next) => {
      ran = true;
      return next();
    });
    await router.handle(call("GET", "/nope"));
    expect(ran).toBe(false);
  });

  it("runs the first added middleware outermost, around the handler", async () => {
    const router = new Router();
    const order: string[] = [];
    const step =
      (name: string): Middleware =>
      async (context, next) => {
        order.push(`${name} in ${context.route.pattern}`);
        const reply = await next();
        order.push(`${name} out`);
        return reply;
      };
    router.use(step("a"));
    router.use(step("b"));
    router.route("GET", "/x/:id", async () => {
      order.push("handler");
      return { status: 200 };
    });
    await router.handle(call("GET", "/x/1"));
    expect(order).toEqual([
      "a in /x/:id",
      "b in /x/:id",
      "handler",
      "b out",
      "a out",
    ]);
  });

  it("lets a middleware answer without the handler", async () => {
    const router = new Router();
    router.use(async () => ({ status: 418 }));
    router.route("GET", "/x", async () => {
      throw new Error("handler ran");
    });
    expect((await router.handle(call("GET", "/x"))).status).toBe(418);
  });

  it("throws what the pipeline throws", async () => {
    const router = new Router();
    router.route("GET", "/x", async () => {
      throw new Error("boom");
    });
    await expect(router.handle(call("GET", "/x"))).rejects.toThrow("boom");
  });
});

describe("Router.route", () => {
  it("throws on a duplicate method and pattern", () => {
    const router = new Router();
    router.route("GET", "/a/:id", ok);
    expect(() => router.route("GET", "/a/:id", ok)).toThrow(
      "The route GET /a/:id is already added",
    );
  });

  it("throws when only the parameter name differs", () => {
    const router = new Router();
    router.route("GET", "/a/:id", ok);
    expect(() => router.route("GET", "/a/:name", ok)).toThrow("already added");
  });

  it("accepts the same pattern with another method and another literal", async () => {
    const router = new Router();
    const byId = async (): Promise<Reply> => ({ status: 200, body: "id" });
    const list = async (): Promise<Reply> => ({ status: 200, body: "list" });
    router.route("GET", "/a/:id", byId);
    router.route("DELETE", "/a/:id", ok);
    router.route("GET", "/a/list", list);
    expect((await router.handle(call("GET", "/a/list"))).body).toBe("id");
  });

  it("answers with the literal route when it is added before the parameter route", async () => {
    const router = new Router();
    router.route("GET", "/a/list", async () => ({ status: 200, body: "list" }));
    router.route("GET", "/a/:id", async () => ({ status: 200, body: "id" }));
    expect((await router.handle(call("GET", "/a/list"))).body).toBe("list");
    expect((await router.handle(call("GET", "/a/7"))).body).toBe("id");
  });

  it("throws on a pattern without a leading slash", () => {
    expect(() => new Router().route("GET", "a", ok)).toThrow(
      "must start with /",
    );
  });
});
