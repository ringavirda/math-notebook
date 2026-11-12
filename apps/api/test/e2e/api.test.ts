import { type ChildProcess, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const appFolder = resolve(import.meta.dirname, "../..");
const entry = join(appFolder, "dist/main.js");
const cliEntry = resolve(appFolder, "../cli/dist/main.js");
const timeout = 30_000;

function freePort(): Promise<number> {
  return new Promise((done, fail) => {
    const probe = createServer();
    probe.once("error", fail);
    probe.listen(0, () => {
      const { port } = probe.address() as { port: number };
      probe.close(() => done(port));
    });
  });
}

function execute(args: readonly string[], env: Record<string, string>) {
  return new Promise<{ code: number | null; stdout: string }>((done, fail) => {
    const child = spawn("node", [cliEntry, ...args], {
      env: { ...process.env, LOG_LEVEL: "", ...env },
    });
    let stdout = "";
    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
    child.on("error", fail);
    child.on("close", (code) => done({ code, stdout }));
  });
}

let folder: string;
let db: string;
let base: string;
let child: ChildProcess;
let stderr = "";
let exit: Promise<number | null>;

interface Answer {
  status: number;
  type: string | null;
  connection: string | null;
  body: any;
}

async function call(
  method: string,
  path: string,
  body?: string,
): Promise<Answer> {
  const response = await fetch(base + path, { method, body });
  const text = await response.text();
  return {
    status: response.status,
    type: response.headers.get("content-type"),
    connection: response.headers.get("connection"),
    body: text === "" ? undefined : JSON.parse(text),
  };
}

const run = (line: string) =>
  call("POST", "/notebooks/main/run", JSON.stringify({ line }));

beforeAll(async () => {
  if (!existsSync(entry) || !existsSync(cliEntry)) {
    throw new Error("run pnpm build first");
  }
  folder = await mkdtemp(join(tmpdir(), "mathbook-api-"));
  db = join(folder, "notebook.db");
  const port = await freePort();
  base = `http://localhost:${port}`;
  child = spawn("node", [entry], {
    env: {
      ...process.env,
      PORT: String(port),
      MATHBOOK_DB: db,
      LOG_LEVEL: "",
    },
  });
  exit = new Promise((done) => child.on("close", done));
  await new Promise<void>((ready, fail) => {
    child.stderr!.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
      if (stderr.includes("listening on")) ready();
    });
    child.on("error", fail);
    exit.then(() => fail(new Error(`api exited early: ${stderr}`)));
  });
}, timeout);

afterAll(async () => {
  child.kill("SIGKILL");
  await rm(folder, { recursive: true, force: true });
});

describe("api", () => {
  it("lists no notebooks at first", async () => {
    const answer = await call("GET", "/notebooks");
    expect(answer.status).toBe(200);
    expect(answer.type).toBe("application/json");
    expect(answer.body).toEqual({ notebooks: [] });
  });

  it("runs definitions and expressions", async () => {
    const created = await call(
      "POST",
      "/notebooks",
      JSON.stringify({ name: "main" }),
    );
    expect(created.status).toBe(201);
    expect((await run("rate = 0.2")).status).toBe(200);
    const price = await run("price = 40");
    expect(price.body.definition.value).toBe(40);
    await run("total(n) = n * price * (1 + rate)");
    await run("subtotal = price * 2");
    const total = await run("total(3)");
    expect(total.status).toBe(200);
    expect(total.body).toEqual({
      kind: "expression",
      source: "total(3)",
      value: 144,
    });
    const changed = await run("price = 50");
    expect(changed.body.recomputed).toEqual([{ name: "subtotal", value: 100 }]);
  });

  it("logs the notebook events at info", () => {
    expect(stderr).toContain("[info] [main] defined price: price = 40");
  });

  it("lists the notebooks and shows one", async () => {
    expect((await call("GET", "/notebooks")).body).toEqual({
      notebooks: ["main"],
    });
    const shown = await call("GET", "/notebooks/main");
    expect(shown.status).toBe(200);
    expect(shown.body.name).toBe("main");
    expect(shown.body.definitions).toContainEqual({
      name: "subtotal",
      params: [],
      source: "subtotal = price * 2",
      value: 100,
      dependsOn: ["price"],
    });
  });

  it("answers an error of each interpreter stage with 400 and its span", async () => {
    for (const [line, stage] of [
      ["1 $ 2", "lexical"],
      ["1 +", "syntax"],
      ["missing + 1", "semantic"],
      ["1 / 0", "evaluation"],
    ]) {
      const answer = await run(line);
      expect(answer.status).toBe(400);
      expect(answer.type).toBe("application/json");
      expect(answer.body.error.stage).toBe(stage);
      expect(typeof answer.body.error.message).toBe("string");
      expect(answer.body.error.span).toEqual({
        start: expect.any(Number),
        end: expect.any(Number),
      });
    }
  });

  it("answers bad JSON and a missing line with 400 and stage request", async () => {
    const bad = await call("POST", "/notebooks/main/run", "{");
    expect(bad.status).toBe(400);
    expect(bad.body.error.stage).toBe("request");
    const missing = await call("POST", "/notebooks/main/run", "{}");
    expect(missing.status).toBe(400);
    expect(missing.body.error.stage).toBe("request");
    const limit = await call("GET", "/notebooks/main/history?limit=0");
    expect(limit.status).toBe(400);
    expect(limit.body.error.stage).toBe("request");
    const failed = await call("GET", "/notebooks/main/history?failed=no");
    expect(failed.status).toBe(400);
    expect(failed.body.error.stage).toBe("request");
  });

  it("answers a body over 64 KiB with 413 and stage request", async () => {
    const answer = await call(
      "POST",
      "/notebooks/main/run",
      JSON.stringify({ line: "x".repeat(70 * 1024) }),
    );
    expect(answer.status).toBe(413);
    expect(answer.type).toBe("application/json");
    expect(answer.connection).toBe("close");
    expect(answer.body.error.stage).toBe("request");
  });

  it("answers the dependencies of a definition", async () => {
    const answer = await call("GET", "/notebooks/main/dependencies/price");
    expect(answer.status).toBe(200);
    expect(answer.body).toEqual({
      uses: [],
      usedBy: ["total", "subtotal"],
    });
    const missing = await call("GET", "/notebooks/main/dependencies/nope");
    expect(missing.status).toBe(404);
    expect(missing.body.error.stage).toBe("domain");
  });

  it("refuses to remove a used definition with 409, then removes with 204", async () => {
    const refused = await call("DELETE", "/notebooks/main/definitions/price");
    expect(refused.status).toBe(409);
    expect(refused.body.error.stage).toBe("domain");
    const removed = await call(
      "DELETE",
      "/notebooks/main/definitions/subtotal",
    );
    expect(removed.status).toBe(204);
    expect(removed.type).toBeNull();
    expect(removed.body).toBeUndefined();
    const missing = await call(
      "DELETE",
      "/notebooks/main/definitions/subtotal",
    );
    expect(missing.status).toBe(404);
  });

  it("answers the history, failed only and limited", async () => {
    const failed = await call("GET", "/notebooks/main/history?failed");
    expect(failed.status).toBe(200);
    expect(failed.body.history).toHaveLength(4);
    expect(
      failed.body.history.every((record: any) => record.error !== null),
    ).toBe(true);
    const last = await call("GET", "/notebooks/main/history?limit=2");
    expect(last.body.history).toHaveLength(2);
    expect(last.body.history[0].source).toBe("1 / 0");
  });

  it("creates, renames, clears and drops a notebook", async () => {
    const created = await call(
      "POST",
      "/notebooks",
      JSON.stringify({ name: "shop" }),
    );
    expect(created.status).toBe(201);
    expect(created.body).toEqual({ name: "shop" });
    const again = await call(
      "POST",
      "/notebooks",
      JSON.stringify({ name: "shop" }),
    );
    expect(again.status).toBe(409);
    expect(again.body.error.stage).toBe("domain");
    const invalid = await call(
      "POST",
      "/notebooks",
      JSON.stringify({ name: "1x" }),
    );
    expect(invalid.status).toBe(400);
    expect(invalid.body.error.stage).toBe("domain");

    await call(
      "POST",
      "/notebooks/shop/run",
      JSON.stringify({ line: "a = 1" }),
    );
    const renamed = await call(
      "PATCH",
      "/notebooks/shop",
      JSON.stringify({ name: "store" }),
    );
    expect(renamed.status).toBe(200);
    expect(renamed.body).toEqual({ name: "store" });
    expect((await call("GET", "/notebooks/shop")).status).toBe(404);
    const taken = await call(
      "PATCH",
      "/notebooks/store",
      JSON.stringify({ name: "main" }),
    );
    expect(taken.status).toBe(409);

    const cleared = await call("DELETE", "/notebooks/store/history");
    expect(cleared.status).toBe(204);
    const history = await call("GET", "/notebooks/store/history");
    expect(history.body.history).toEqual([]);
    expect(
      (await call("GET", "/notebooks/store")).body.definitions,
    ).toHaveLength(1);

    expect((await call("DELETE", "/notebooks/store")).status).toBe(204);
    expect((await call("GET", "/notebooks")).body).toEqual({
      notebooks: ["main"],
    });
    expect((await call("DELETE", "/notebooks/store")).status).toBe(404);
  });

  it("answers 404 on a missing notebook for every route and creates nothing", async () => {
    for (const [method, path, body] of [
      ["GET", "/notebooks/nope", undefined],
      ["POST", "/notebooks/nope/run", JSON.stringify({ line: "1" })],
      ["DELETE", "/notebooks/nope/definitions/x", undefined],
      ["GET", "/notebooks/nope/dependencies/x", undefined],
      ["GET", "/notebooks/nope/history", undefined],
      ["DELETE", "/notebooks/nope/history", undefined],
      ["PATCH", "/notebooks/nope", JSON.stringify({ name: "other" })],
      ["DELETE", "/notebooks/nope", undefined],
    ] as const) {
      const answer = await call(method, path, body);
      expect([method, path, answer.status]).toEqual([method, path, 404]);
      expect(answer.body.error.stage).toBe("domain");
    }
    expect((await call("GET", "/notebooks")).body).toEqual({
      notebooks: ["main"],
    });
  });

  it("answers an unknown route or method with 404", async () => {
    for (const [method, path] of [
      ["GET", "/nope"],
      ["GET", "/notebooks/main/nope"],
      ["PUT", "/notebooks"],
      ["GET", "/notebooks/main/run"],
      ["POST", "/notebooks//run"],
      ["GET", "/notebooks//history"],
    ]) {
      const answer = await call(method, path);
      expect(answer.status).toBe(404);
      expect(answer.type).toBe("application/json");
    }
  });

  it("answers a badly encoded path with 400", async () => {
    const answer = await call("GET", "/notebooks/%ZZ");
    expect(answer.status).toBe(400);
    expect(answer.body.error.stage).toBe("request");
  });

  it("is read by the CLI on the same file", async () => {
    const result = await execute(["price * 3"], { MATHBOOK_DB: db });
    expect(result.code).toBe(0);
    expect(result.stdout).toBe("150\n");
  });

  it(
    "stops on SIGINT after logging stopped and exits 0",
    async () => {
      child.kill("SIGINT");
      expect(await exit).toBe(0);
      expect(stderr).toContain("stopped");
    },
    timeout,
  );
});
