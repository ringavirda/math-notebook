import { describe, expect, it, vi } from "vitest";
import { StorageError, type NotebookService } from "@mathbook/notebook";
import { handle } from "../src/routes.js";

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
    expect(onUnexpected).toHaveBeenCalledWith(cause);
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
});
