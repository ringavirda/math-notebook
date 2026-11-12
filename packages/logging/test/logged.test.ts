import { describe, expect, it } from "vitest";
import { StderrLogger, logged } from "../src/index.js";

class Worker {
  readonly lines: string[] = [];
  readonly logger = new StderrLogger("debug", (line) => this.lines.push(line));

  @logged
  async work(name: string, count: number): Promise<string> {
    return `${name}${count}`;
  }

  @logged
  async fail(): Promise<void> {
    throw new Error("broken");
  }
}

describe("logged", () => {
  it("writes the call and duration at debug", async () => {
    const worker = new Worker();
    expect(await worker.work("a", 2)).toBe("a2");
    expect(worker.lines).toHaveLength(1);
    expect(worker.lines[0]).toMatch(/^\[debug\] work\(a, 2\) took \d+ ms$/);
  });

  it("writes a failure and rethrows", async () => {
    const worker = new Worker();
    await expect(worker.fail()).rejects.toThrow("broken");
    expect(worker.lines[0]).toMatch(/^\[debug\] fail\(\) failed after \d+ ms$/);
  });
});
