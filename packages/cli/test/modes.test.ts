import { describe, expect, it } from "vitest";

import { runInteractive, runOnce } from "../src/index.js";
import { createHarness } from "./helpers.js";

const options = { banner: ["Hello", "Type help"], goodbye: "Bye", prompt: "->" };

function withEcho(input: string[]) {
  const harness = createHarness(input);
  harness.executor.registerCommand({
    selectors: ["say"],
    params: ["word"],
    description: "Prints a word.",
    action: (word) => harness.cli.echo(`said ${word}`),
  });
  return harness;
}

describe("runOnce", () => {
  it("returns the exit code of the joined words", async () => {
    const { executor } = withEcho([]);
    expect(await runOnce(executor, ["say", "a"])).toBe(0);
    expect(await runOnce(executor, ["nope"])).toBe(2);
    expect(await runOnce(executor, [])).toBe(0);
  });
});

describe("runInteractive", () => {
  it("prints the banner, runs lines until a quit word, then the goodbye", async () => {
    const { cli, executor, stdout } = withEcho(["say a\n", ":q\n", "say b\n"]);
    await runInteractive(cli, executor, options);
    const lines = stdout();
    expect(lines[0]).toBe("Hello");
    expect(lines[1]).toBe("Type help");
    expect(lines).toContain("-> said a");
    expect(lines.join("\n")).not.toContain("said b");
    expect(lines.at(-1)).toMatch(/Bye$/);
  });

  it("ends at end of input with the goodbye", async () => {
    const { cli, executor, stdout } = withEcho(["say a\n"]);
    await runInteractive(cli, executor, options);
    expect(stdout().at(-1)).toMatch(/Bye$/);
  });

  it("accepts every default quit word, trimmed and in any case", async () => {
    for (const word of [":quit", "  :EXIT  "]) {
      const { cli, executor, stdout } = withEcho([`${word}\n`, "say a\n"]);
      await runInteractive(cli, executor, options);
      expect(stdout().join("\n")).not.toContain("said a");
    }
  });

  it("uses the given quit words instead of the defaults", async () => {
    const { cli, executor, stdout } = withEcho(["bye\n", "say a\n"]);
    await runInteractive(cli, executor, { ...options, quitWords: ["bye"] });
    expect(stdout().join("\n")).not.toContain("said a");
    const other = withEcho([":q\n", "say a\n"]);
    await runInteractive(other.cli, other.executor, {
      ...options,
      quitWords: ["bye"],
    });
    expect(other.stdout().join("\n")).toContain("said a");
  });
});
