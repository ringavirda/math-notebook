import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Logger } from "@mathbook/common";
import { REPOSITORY_SERVICE } from "@mathbook/notebook-setup";
import type { HostedService } from "@mathbook/hosting";
import type { NotebookService } from "@mathbook/notebook";
import { createApi } from "../../src/app.js";
import { HTTP_SERVICE } from "../../src/services.js";
import { HttpService } from "../../src/http/server.js";

function recordingLogger() {
  const lines: string[] = [];
  const at = (level: string) => (message: string) =>
    void lines.push(`[${level}] ${message}`);
  const logger: Logger = {
    debug: at("debug"),
    info: at("info"),
    warn: at("warn"),
    error: at("error"),
  };
  return { lines, logger };
}

const stoppers: (() => Promise<void>)[] = [];

afterEach(async () => {
  for (const stop of stoppers.splice(0)) await stop();
});

async function serve(service: NotebookService) {
  const { lines, logger } = recordingLogger();
  const http = new HttpService(service, 0, logger);
  await http.start();
  stoppers.push(() => http.stop());
  const port = /localhost:(\d+)/.exec(lines[0])![1];
  return { lines, base: `http://localhost:${port}` };
}

describe("HttpService", () => {
  it("answers 500 Unexpected error and logs the stack at error", async () => {
    const service = {
      list: async () => {
        throw new Error("boom");
      },
    } as unknown as NotebookService;
    const { lines, base } = await serve(service);
    const response = await fetch(`${base}/notebooks`);
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: { stage: "server", message: "Unexpected error" },
    });
    const errors = lines.filter((line) => line.startsWith("[error]"));
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("Error: boom");
    expect(errors[0]).toContain("server.test.ts");
  });

  it("answers 500 and logs when the answer cannot be written", async () => {
    const service = {
      list: async () => [1n],
    } as unknown as NotebookService;
    const { lines, base } = await serve(service);
    const response = await fetch(`${base}/notebooks`);
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: { stage: "server", message: "Unexpected error" },
    });
    expect(lines.filter((line) => line.startsWith("[error]"))).toHaveLength(1);
  });

  it("stops within a second with an idle keep-alive connection", async () => {
    const service = { list: async () => [] } as unknown as NotebookService;
    const { base } = await serve(service);
    await fetch(`${base}/notebooks`);
    const started = Date.now();
    await stoppers.pop()!();
    expect(Date.now() - started).toBeLessThan(1000);
  });
});

describe("createApi", () => {
  it("starts the repository before the HTTP front end and stops it after", async () => {
    const folder = await mkdtemp(join(tmpdir(), "mathbook-api-"));
    try {
      const host = createApi({
        argv: [],
        env: { PORT: "0", MATHBOOK_DB: join(folder, "notebook.db") },
      });
      const order: string[] = [];
      for (const [label, token] of [
        ["repository", REPOSITORY_SERVICE],
        ["http", HTTP_SERVICE],
      ] as const) {
        const service = host.services.get<HostedService>(token);
        for (const method of ["start", "stop"] as const) {
          const original = service[method].bind(service);
          vi.spyOn(service, method).mockImplementation(async () => {
            order.push(`${method} ${label}`);
            await original();
          });
        }
      }
      const running = host.run();
      await vi.waitFor(() => expect(order).toContain("start http"));
      process.emit("SIGINT");
      expect(await running).toBe(0);
      expect(order).toEqual([
        "start repository",
        "start http",
        "stop http",
        "stop repository",
      ]);
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  });
});
