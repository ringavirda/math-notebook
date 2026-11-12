import { describe, expect, it } from "vitest";
import { StderrLogger } from "../src/index.js";

describe("StderrLogger", () => {
  it("writes at or above its level with a prefix", () => {
    const lines: string[] = [];
    const logger = new StderrLogger("info", (line) => lines.push(line));
    logger.debug("no");
    logger.info("a");
    logger.warn("b");
    logger.error("c");
    expect(lines).toEqual(["[info] a", "[warn] b", "[error] c"]);
  });

  it("at error level writes only errors", () => {
    const lines: string[] = [];
    const logger = new StderrLogger("error", (line) => lines.push(line));
    logger.warn("no");
    logger.error("yes");
    expect(lines).toEqual(["[error] yes"]);
  });
});
