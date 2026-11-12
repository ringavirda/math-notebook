import { describe, expect, it, vi } from "vitest";
import {
  DuplicateError,
  InvalidNameError,
  NotFoundError,
  StorageError,
  type NotebookService,
} from "@mathbook/notebook";
import type { Logger } from "@mathbook/common";
import { createRouter } from "../../src/services.js";

function handle(
  service: NotebookService,
  call: { method: string; url: string; body: string },
  onUnexpected: (error: unknown) => void,
) {
  const silent = () => {};
  const logger: Logger = {
    debug: silent,
    info: silent,
    warn: silent,
    error: onUnexpected,
  };
  return createRouter(service, logger).handle(call);
}

describe("handle", () => {
  it("answers 500 Unexpected error and reports the cause for a storage failure", async () => {
    const cause = new StorageError("notebook main", "broken");
    const service = {
      list: async () => {
        throw cause;
      },
    } as unknown as NotebookService;
    const onUnexpected = vi.fn();
    const reply = await handle(
      service,
      { method: "GET", url: "/notebooks", body: "" },
      onUnexpected,
    );
    expect(reply.status).toBe(500);
    expect(reply.body).toEqual({
      error: { stage: "server", message: "Unexpected error" },
    });
    expect(onUnexpected).toHaveBeenCalledWith(cause.stack);
  });

  it("answers 404 for an empty path segment without calling the service", async () => {
    const run = vi.fn();
    const history = vi.fn();
    const service = { run, history } as unknown as NotebookService;
    for (const [method, url, body] of [
      ["POST", "/notebooks//run", '{"line":"y = 1"}'],
      ["GET", "/notebooks//history", ""],
    ]) {
      const reply = await handle(service, { method, url, body }, vi.fn());
      expect(reply.status).toBe(404);
    }
    expect(run).not.toHaveBeenCalled();
    expect(history).not.toHaveBeenCalled();
  });

  it("reads failed as absent, failed or failed=true and refuses anything else", async () => {
    const history = vi.fn(async () => []);
    const service = { history } as unknown as NotebookService;
    const ask = (query: string) =>
      handle(
        service,
        { method: "GET", url: `/notebooks/main/history${query}`, body: "" },
        vi.fn(),
      );
    for (const [query, failedOnly] of [
      ["", false],
      ["?failed", true],
      ["?failed=true", true],
    ] as const) {
      expect((await ask(query)).status).toBe(200);
      expect(history).toHaveBeenLastCalledWith("main", {
        limit: 10,
        failedOnly,
      });
    }
    history.mockClear();
    for (const query of ["?failed=false", "?failed=1", "?failed=yes"]) {
      const reply = await ask(query);
      expect(reply.status).toBe(400);
      expect(reply.body).toMatchObject({ error: { stage: "request" } });
    }
    expect(history).not.toHaveBeenCalled();
  });

  it("maps each lifecycle route to its service method and status", async () => {
    const service = {
      create: vi.fn(async () => {}),
      rename: vi.fn(async () => {}),
      drop: vi.fn(async () => {}),
      clearHistory: vi.fn(async () => 2),
    } as unknown as NotebookService;
    const ask = (method: string, url: string, body = "") =>
      handle(service, { method, url, body }, vi.fn());
    expect(await ask("POST", "/notebooks", '{"name":"shop"}')).toEqual({
      status: 201,
      body: { name: "shop" },
    });
    expect(service.create).toHaveBeenCalledWith("shop");
    expect(await ask("PATCH", "/notebooks/shop", '{"name":"store"}')).toEqual({
      status: 200,
      body: { name: "store" },
    });
    expect(service.rename).toHaveBeenCalledWith("shop", "store");
    expect(await ask("DELETE", "/notebooks/store/history")).toEqual({
      status: 204,
    });
    expect(service.clearHistory).toHaveBeenCalledWith("store");
    expect(await ask("DELETE", "/notebooks/store")).toEqual({ status: 204 });
    expect(service.drop).toHaveBeenCalledWith("store");
  });

  it("refuses a lifecycle body without a string name before calling the service", async () => {
    const create = vi.fn();
    const rename = vi.fn();
    const service = { create, rename } as unknown as NotebookService;
    for (const [method, url] of [
      ["POST", "/notebooks"],
      ["PATCH", "/notebooks/main"],
    ]) {
      for (const body of ["{", "{}", '{"name":1}']) {
        const reply = await handle(service, { method, url, body }, vi.fn());
        expect(reply.status).toBe(400);
        expect(reply.body).toMatchObject({ error: { stage: "request" } });
      }
    }
    expect(create).not.toHaveBeenCalled();
    expect(rename).not.toHaveBeenCalled();
  });

  it("answers 400 for an invalid name, 409 for a taken one and 404 for a missing notebook", async () => {
    const service = {
      create: async () => {
        throw new InvalidNameError("Invalid notebook name '1x'");
      },
      rename: async () => {
        throw new DuplicateError("Notebook 'b' already exists");
      },
      drop: async () => {
        throw new NotFoundError("No notebook 'nope'");
      },
    } as unknown as NotebookService;
    const status = async (method: string, url: string, body: string) =>
      (await handle(service, { method, url, body }, vi.fn())).status;
    expect(await status("POST", "/notebooks", '{"name":"1x"}')).toBe(400);
    expect(await status("PATCH", "/notebooks/a", '{"name":"b"}')).toBe(409);
    expect(await status("DELETE", "/notebooks/nope", "")).toBe(404);
  });
});
