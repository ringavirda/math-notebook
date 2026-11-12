import { describe, expect, it } from "vitest";

import {
  RequestError,
  Router,
  mapErrors,
  timing,
  type Reply,
} from "../../src/index.js";
import { RecordingLogger } from "../helpers.js";

class ExpectedError extends Error {}

function failing(error: unknown) {
  const router = new Router();
  router.route("GET", "/boom", async () => {
    throw error;
  });
  return router;
}
const get = (router: Router, url = "/boom") =>
  router.handle({ method: "GET", url, body: "" });

describe("mapErrors", () => {
  it("answers a RequestError with 400 stage request", async () => {
    const logger = new RecordingLogger();
    const router = failing(new RequestError("bad"));
    router.use(mapErrors(logger, () => ({ status: 409 })));
    expect(await get(router)).toEqual({
      status: 400,
      body: { error: { stage: "request", message: "bad" } },
    });
    expect(logger.lines).toEqual([]);
  });

  it("answers what describe returns for an error it knows", async () => {
    const logger = new RecordingLogger();
    const router = failing(new ExpectedError("nope"));
    const describe = (error: unknown): Reply | undefined =>
      error instanceof ExpectedError
        ? { status: 409, body: { message: error.message } }
        : undefined;
    router.use(mapErrors(logger, describe));
    expect(await get(router)).toEqual({
      status: 409,
      body: { message: "nope" },
    });
    expect(logger.lines).toEqual([]);
  });

  it("answers 500 and logs the stack for an error describe does not know", async () => {
    const logger = new RecordingLogger();
    const router = failing(new Error("secret"));
    router.use(mapErrors(logger, () => undefined));
    expect(await get(router)).toEqual({
      status: 500,
      body: { error: { stage: "server", message: "Unexpected error" } },
    });
    expect(logger.lines).toHaveLength(1);
    expect(logger.lines[0]![0]).toBe("error");
    expect(logger.lines[0]![1]).toContain("Error: secret");
  });

  it("logs a thrown non-error as text", async () => {
    const logger = new RecordingLogger();
    const router = failing("oops");
    router.use(mapErrors(logger, () => undefined));
    expect((await get(router)).status).toBe(500);
    expect(logger.lines).toEqual([["error", "oops"]]);
  });

  it("passes a reply through", async () => {
    const router = new Router();
    router.route("GET", "/fine", async () => ({ status: 204 }));
    router.use(mapErrors(new RecordingLogger(), () => undefined));
    expect(await get(router, "/fine")).toEqual({ status: 204 });
  });
});

describe("timing", () => {
  it("logs method, pattern and whole milliseconds at debug", async () => {
    const logger = new RecordingLogger();
    const router = new Router();
    router.route("GET", "/x/:id", async () => ({ status: 200 }));
    router.use(timing(logger));
    expect(await get(router, "/x/7")).toEqual({ status: 200 });
    expect(logger.lines).toHaveLength(1);
    expect(logger.lines[0]![0]).toBe("debug");
    expect(logger.lines[0]![1]).toMatch(/^GET \/x\/:id took \d+ ms$/);
  });

  it("logs also when the handler throws", async () => {
    const logger = new RecordingLogger();
    const router = failing(new Error("x"));
    router.use(timing(logger));
    await expect(get(router)).rejects.toThrow("x");
    expect(logger.lines[0]![1]).toMatch(/^GET \/boom took \d+ ms$/);
  });

  it("wraps the steps added after it", async () => {
    const logger = new RecordingLogger();
    const router = failing(new Error("x"));
    router.use(timing(logger));
    router.use(mapErrors(logger, () => undefined));
    expect((await get(router)).status).toBe(500);
    expect(logger.lines.map(([level]) => level)).toEqual(["error", "debug"]);
  });
});
