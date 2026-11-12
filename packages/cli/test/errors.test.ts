import { describe, expect, it } from "vitest";

import {
  UsageError,
  checkArguments,
  exitCode,
  mapErrors,
  timing,
  type CommandStatus,
} from "../src/index.js";
import { createHarness } from "./helpers.js";

class ExpectedError extends Error {}
class OtherError extends Error {
  override name = "OtherError";
}

function failing(error: unknown) {
  const harness = createHarness();
  harness.executor.registerCommand({
    selectors: ["boom"],
    params: [],
    description: "Throws.",
    action: () => {
      throw error;
    },
  });
  return harness;
}

describe("mapErrors", () => {
  it("prints an expected error's message and fails", async () => {
    const { executor, cli, logger, stderr } = failing(
      new ExpectedError("nope"),
    );
    executor.use(mapErrors(cli, logger, [ExpectedError]));
    expect(await executor.execute("boom")).toBe("failed");
    expect(stderr()).toEqual(["Err: nope"]);
    expect(logger.lines).toEqual([]);
  });

  it("prints the lines from describe for an expected error", async () => {
    const { executor, cli, logger, stderr } = failing(
      new ExpectedError("nope"),
    );
    executor.use(
      mapErrors(cli, logger, [ExpectedError], (e) => [e.message, "second"]),
    );
    expect(await executor.execute("boom")).toBe("failed");
    expect(stderr()).toEqual(["Err: nope", "Err: second"]);
  });

  it("an error outside the expected classes is unexpected and logged", async () => {
    const { executor, cli, logger, stderr } = failing(new OtherError("secret"));
    executor.use(mapErrors(cli, logger, [ExpectedError]));
    expect(await executor.execute("boom")).toBe("failed");
    expect(stderr()).toEqual(["Err: Unexpected error"]);
    expect(logger.lines).toHaveLength(1);
    expect(logger.lines[0]![0]).toBe("error");
    expect(logger.lines[0]![1]).toContain("OtherError: secret");
  });

  it("a thrown non-error is unexpected and logged as text", async () => {
    const { executor, cli, logger, stderr } = failing("oops");
    executor.use(mapErrors(cli, logger, [ExpectedError]));
    expect(await executor.execute("boom")).toBe("failed");
    expect(stderr()).toEqual(["Err: Unexpected error"]);
    expect(logger.lines).toEqual([["error", "oops"]]);
  });

  it("a usage error is usage even when expected lists Error", async () => {
    const { executor, cli, logger, stderr } = failing(
      new UsageError("bad use"),
    );
    executor.use(mapErrors(cli, logger, [Error]));
    expect(await executor.execute("boom")).toBe("usage");
    expect(stderr()).toEqual(["Err: bad use"]);
  });
});

describe("timing", () => {
  it("logs the first selector and whole milliseconds at debug", async () => {
    const { executor, logger } = createHarness();
    executor.use(timing(logger));
    await executor.execute("help");
    expect(logger.lines).toHaveLength(1);
    expect(logger.lines[0]![0]).toBe("debug");
    expect(logger.lines[0]![1]).toMatch(/^help took \d+ ms$/);
  });

  it("logs also when the command throws", async () => {
    const { executor, logger } = failing(new Error("x"));
    executor.use(timing(logger));
    expect(await executor.execute("boom")).toBe("failed");
    expect(logger.lines[0]![1]).toMatch(/^boom took \d+ ms$/);
  });

  it("wraps the steps added after it", async () => {
    const { executor, logger } = createHarness();
    executor.use(timing(logger));
    executor.use(checkArguments);
    expect(await executor.execute("help a b")).toBe("usage");
    expect(logger.lines[0]![1]).toMatch(/^help took/);
  });
});

describe("exitCode", () => {
  it("maps every status", () => {
    const table: [CommandStatus, number][] = [
      ["ok", 0],
      ["empty", 0],
      ["failed", 1],
      ["unknown", 2],
      ["usage", 2],
    ];
    for (const [status, code] of table) expect(exitCode(status)).toBe(code);
  });
});
