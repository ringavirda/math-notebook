import { Readable, Writable } from "node:stream";
import { stripVTControlCharacters } from "node:util";

import type { Logger } from "@mathbook/logging";

import { CLI, Executor } from "../src/index.js";

export class RecordingLogger implements Logger {
  readonly lines: [string, string][] = [];

  debug(message: string): void {
    this.lines.push(["debug", message]);
  }

  info(message: string): void {
    this.lines.push(["info", message]);
  }

  warn(message: string): void {
    this.lines.push(["warn", message]);
  }

  error(message: string): void {
    this.lines.push(["error", message]);
  }
}

function sink() {
  const chunks: string[] = [];
  const stream = new Writable({
    write(chunk, _encoding, done) {
      chunks.push(String(chunk));
      done();
    },
  });
  return {
    stream,
    lines: () =>
      stripVTControlCharacters(chunks.join("")).split("\n").filter(Boolean),
  };
}

export function createHarness(input: string[] = []) {
  const output = sink();
  const errors = sink();
  const cli = new CLI(Readable.from(input), output.stream, errors.stream);
  const executor = new Executor(cli);
  return {
    cli,
    executor,
    stdout: output.lines,
    stderr: errors.lines,
    logger: new RecordingLogger(),
  };
}
