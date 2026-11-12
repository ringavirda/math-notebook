import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { MongoMemoryServer } from "mongodb-memory-server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const appFolder = resolve(import.meta.dirname, "../..");
const entry = join(appFolder, "dist/main.js");
const timeout = 30_000;

interface Run {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

function run(
  args: readonly string[],
  env: Record<string, string>,
  input = "",
): Promise<Run> {
  return new Promise((done, fail) => {
    const child = spawn("node", [entry, ...args], {
      cwd: appFolder,
      env: { ...process.env, LOG_LEVEL: "", ...env },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
    child.on("error", fail);
    child.on("close", (code) => done({ code, stdout, stderr }));
    child.stdin.end(input);
  });
}

const session = [
  "rate = 0.2",
  "price = 40",
  "total(n) = n * price * (1 + rate)",
  "total(3)",
  "subtotal = price * 2",
  "price = 50",
  "1 +",
  ":history 2 failed",
  ":ls",
  "",
].join("\n");

const folders: string[] = [];
let server: MongoMemoryServer;

beforeAll(async () => {
  if (!existsSync(entry)) throw new Error("run pnpm build first");
  server = await MongoMemoryServer.create();
}, timeout);

afterAll(async () => {
  await server.stop();
  await Promise.all(
    folders.map((folder) => rm(folder, { recursive: true, force: true })),
  );
});

describe.each(["sqlite", "mongo"] as const)("%s storage", (storage) => {
  async function setup(): Promise<Record<string, string>> {
    const folder = await mkdtemp(join(tmpdir(), "mathbook-e2e-"));
    folders.push(folder);
    return {
      MATHBOOK_STORAGE: storage,
      MATHBOOK_DB: join(folder, "notebook.db"),
      MATHBOOK_MONGO_URL: server.getUri(`e2e${folders.length}`),
    };
  }

  it(
    "one-shot expression prints the value and exits 0",
    async () => {
      const result = await run(["1 + 2"], await setup());
      expect(result.code).toBe(0);
      expect(result.stdout).toBe("3\n");
    },
    timeout,
  );

  it(
    "a syntax error exits 1 with the caret on stderr",
    async () => {
      const result = await run(["1 +"], await setup());
      expect(result.code).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain("Syntax error:");
      expect(result.stderr).toContain("Err: 1 +\n");
      expect(result.stderr).toContain("Err:    ^\n");
    },
    timeout,
  );

  it(
    "an unknown command exits 2",
    async () => {
      const result = await run([":nope"], await setup());
      expect(result.code).toBe(2);
      expect(result.stderr).toContain("Unknown command: :nope");
    },
    timeout,
  );

  it(
    "a piped session computes, recomputes and lists the failure",
    async () => {
      const result = await run([], await setup(), session);
      expect(result.code).toBe(0);
      expect(result.stdout).toContain("144\n");
      expect(result.stdout).toContain("price = 50\n  subtotal = 100\n");
      expect(result.stdout).toMatch(/\d{2}:\d{2}:\d{2} 1 \+ => Syntax error/);
      expect(result.stdout).toContain("total(n) = n * price * (1 + rate)\n");
    },
    timeout,
  );

  it(
    "keeps definitions between runs",
    async () => {
      const env = await setup();
      await run(["x = 7"], env);
      const result = await run([":ls"], env);
      expect(result.code).toBe(0);
      expect(result.stdout).toBe("x = 7\n");
    },
    timeout,
  );
});

describe("startup", () => {
  it(
    "a bad setting exits 1 naming the variable",
    async () => {
      const result = await run([":ls"], { MATHBOOK_STORAGE: "csv" });
      expect(result.code).toBe(1);
      expect(result.stderr).toContain("MATHBOOK_STORAGE");
    },
    timeout,
  );

  it(
    "an unreachable Mongo exits 1 with a message",
    async () => {
      const result = await run([":ls"], {
        MATHBOOK_STORAGE: "mongo",
        MATHBOOK_MONGO_URL:
          "mongodb://127.0.0.1:1/mathbook?serverSelectionTimeoutMS=500",
      });
      expect(result.code).toBe(1);
      expect(result.stderr).not.toBe("");
    },
    timeout,
  );
});
