import { afterEach, describe, expect, it } from "vitest";

import { HttpService, Router } from "../../src/index.js";
import { RecordingLogger } from "../helpers.js";

const stoppers: (() => Promise<void>)[] = [];

afterEach(async () => {
  for (const stop of stoppers.splice(0)) await stop();
});

async function serve(router: Router, maxBodyBytes?: number) {
  const logger = new RecordingLogger();
  const http = new HttpService(router, 0, logger, maxBodyBytes);
  await http.start();
  stoppers.push(() => http.stop());
  const port = /localhost:(\d+)/.exec(logger.lines[0]![1])![1];
  return { logger, base: `http://localhost:${port}` };
}

describe("HttpService", () => {
  it("logs the port on start and stopped on stop", async () => {
    const logger = new RecordingLogger();
    const http = new HttpService(new Router(), 0, logger);
    await http.start();
    await http.stop();
    expect(logger.lines[0]![0]).toBe("info");
    expect(logger.lines[0]![1]).toMatch(
      /^listening on http:\/\/localhost:\d+$/,
    );
    expect(logger.lines[1]).toEqual(["info", "stopped"]);
  });

  it("answers the router's reply as JSON with its headers", async () => {
    const router = new Router();
    router.route("POST", "/echo/:id", async (request) => ({
      status: 201,
      body: { id: request.params.id, text: request.body },
      headers: { "X-Seen": "yes" },
    }));
    const { base } = await serve(router);
    const response = await fetch(`${base}/echo/7`, {
      method: "POST",
      body: "hi",
    });
    expect(response.status).toBe(201);
    expect(response.headers.get("content-type")).toBe("application/json");
    expect(response.headers.get("x-seen")).toBe("yes");
    expect(await response.json()).toEqual({ id: "7", text: "hi" });
  });

  it("answers an empty reply without a body or content type", async () => {
    const router = new Router();
    router.route("DELETE", "/x", async () => ({ status: 204 }));
    const { base } = await serve(router);
    const response = await fetch(`${base}/x`, { method: "DELETE" });
    expect(response.status).toBe(204);
    expect(response.headers.get("content-type")).toBeNull();
  });

  it("answers 413 with Connection: close for a body over the limit", async () => {
    const router = new Router();
    router.route("POST", "/x", async () => ({ status: 200 }));
    const { base } = await serve(router, 10);
    const response = await fetch(`${base}/x`, {
      method: "POST",
      body: "x".repeat(11),
    });
    expect(response.status).toBe(413);
    expect(response.headers.get("connection")).toBe("close");
    expect(await response.json()).toEqual({
      error: { stage: "request", message: "Body is over 10 bytes" },
    });
  });

  it("accepts a body of exactly the limit", async () => {
    const router = new Router();
    router.route("POST", "/x", async () => ({ status: 200 }));
    const { base } = await serve(router, 10);
    const response = await fetch(`${base}/x`, {
      method: "POST",
      body: "x".repeat(10),
    });
    expect(response.status).toBe(200);
  });

  it("limits to 64 KiB by default", async () => {
    const router = new Router();
    router.route("POST", "/x", async () => ({ status: 200 }));
    const { base } = await serve(router);
    const at = (size: number) =>
      fetch(`${base}/x`, { method: "POST", body: "x".repeat(size) });
    expect((await at(64 * 1024)).status).toBe(200);
    expect((await at(64 * 1024 + 1)).status).toBe(413);
  });

  it("answers 500 and logs the stack when the router throws", async () => {
    const router = new Router();
    router.route("GET", "/x", async () => {
      throw new Error("boom");
    });
    const { logger, base } = await serve(router);
    const response = await fetch(`${base}/x`);
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: { stage: "server", message: "Unexpected error" },
    });
    const errors = logger.lines.filter(([level]) => level === "error");
    expect(errors).toHaveLength(1);
    expect(errors[0]![1]).toContain("Error: boom");
  });

  it("answers 500 and logs when the reply cannot be written", async () => {
    const router = new Router();
    router.route("GET", "/x", async () => ({ status: 200, body: [1n] }));
    const { logger, base } = await serve(router);
    const response = await fetch(`${base}/x`);
    expect(response.status).toBe(500);
    expect(logger.lines.some(([level]) => level === "error")).toBe(true);
  });

  it("rejects start when the port is taken", async () => {
    const { logger } = await serve(new Router());
    const port = Number(/localhost:(\d+)/.exec(logger.lines[0]![1])![1]);
    const second = new HttpService(new Router(), port, new RecordingLogger());
    await expect(second.start()).rejects.toThrow(/EADDRINUSE/);
  });
});
