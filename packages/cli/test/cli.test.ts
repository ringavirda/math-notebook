import { Readable, Writable } from "node:stream";
import { stripVTControlCharacters } from "node:util";
import { describe, expect, it } from "vitest";

import { CLI } from "../src/index.js";

function sink() {
  const chunks: string[] = [];
  const stream = new Writable({
    write(chunk, _encoding, done) {
      chunks.push(String(chunk));
      done();
    },
  });
  return { stream, text: () => stripVTControlCharacters(chunks.join("")) };
}

function createCli(input: string[]) {
  const output = sink();
  const errors = sink();
  const cli = new CLI(Readable.from(input), output.stream, errors.stream);
  return { cli, output, errors };
}

describe("CLI", () => {
  it("reads piped lines until end of input", async () => {
    const { cli } = createCli(["a\nb\n"]);
    expect(await cli.read(">")).toBe("a");
    expect(await cli.read(">")).toBe("b");
    expect(await cli.read(">")).toBeNull();
  });

  it("sends echoError to the error stream and echo to the output", () => {
    const { cli, output, errors } = createCli([]);
    cli.echo("hello");
    cli.echoError("broken");
    expect(output.text()).toBe("hello\n");
    expect(errors.text()).toBe("Err: broken\n");
    cli.close();
  });

  it("resolves null when read after close, and closes twice safely", async () => {
    const { cli } = createCli(["a\n"]);
    cli.close();
    cli.close();
    expect(await cli.read(">")).toBeNull();
  });

  it("resolves null after close even when lines are still buffered", async () => {
    const { cli } = createCli(["a\nb\n"]);
    expect(await cli.read(">")).toBe("a");
    cli.close();
    expect(await cli.read(">")).toBeNull();
  });
});
