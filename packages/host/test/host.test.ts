import "reflect-metadata";
import { Container } from "inversify";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ConfigError } from "@mathbook/config";

import { ARGV, LOGGER, createHostBuilder, type HostedService } from "../src/index.js";
import type { Logger } from "@mathbook/logging";

const A = Symbol("a");
const B = Symbol("b");
const C = Symbol("c");
const SETTINGS = Symbol("settings");

function recording(
  name: string,
  events: string[],
  failOnStart = false,
): HostedService {
  return {
    async start() {
      if (failOnStart) throw new Error(`${name} cannot start`);
      events.push(`start ${name}`);
    },
    async stop() {
      events.push(`stop ${name}`);
    },
  };
}

function hostOf(services: Record<symbol, HostedService>, lines: string[] = []) {
  const builder = createHostBuilder({ argv: [], env: {} }).logging({
    write: (line) => lines.push(line),
  });
  for (const token of Object.getOwnPropertySymbols(services)) {
    builder.services.bind(token).toConstantValue(services[token]);
    builder.hosted(token);
  }
  return builder.build();
}

describe("createHostBuilder", () => {
  it("starts in registration order and stops in reverse", async () => {
    const events: string[] = [];
    const host = hostOf({
      [A]: recording("a", events),
      [B]: recording("b", events),
    });
    const code = await host.run(async () => {
      events.push("main");
      return 7;
    });
    expect(code).toBe(7);
    expect(events).toEqual([
      "start a",
      "start b",
      "main",
      "stop b",
      "stop a",
    ]);
  });

  it("stops after main throws and rethrows", async () => {
    const events: string[] = [];
    const host = hostOf({ [A]: recording("a", events) });
    await expect(
      host.run(async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(events).toEqual(["start a", "stop a"]);
  });

  it("returns 1 on a failing start and stops only the started ones", async () => {
    const events: string[] = [];
    const host = hostOf(
      {
        [A]: recording("a", events),
        [B]: recording("b", events, true),
        [C]: recording("c", events),
      },
      events,
    );
    let ran = false;
    const code = await host.run(async () => {
      ran = true;
      return 0;
    });
    expect(code).toBe(1);
    expect(ran).toBe(false);
    expect(events).toEqual(["start a", "stop a", "b cannot start"]);
  });

  it("stops the started services on SIGINT and sets exit code 130", async () => {
    const events: string[] = [];
    const host = hostOf({ [A]: recording("a", events) });
    const saved = process.exitCode;
    try {
      await host.run(async () => {
        process.emit("SIGINT");
        await new Promise((resolve) => setImmediate(resolve));
        events.push("main");
        return 0;
      });
      expect(process.exitCode).toBe(130);
      expect(events).toEqual(["start a", "stop a", "main"]);
    } finally {
      process.exitCode = saved;
    }
  });

  it("builds configuration from the env under its token", () => {
    const builder = createHostBuilder({ argv: [], env: { PORT: "8080" } })
      .configuration(SETTINGS, z.object({ PORT: z.coerce.number() }));
    const host = builder.build();
    expect(host.services.get(SETTINGS)).toEqual({ PORT: 8080 });
  });

  it("throws ConfigError at build for a bad value", () => {
    const builder = createHostBuilder({ argv: [], env: { PORT: "x" } })
      .configuration(SETTINGS, z.object({ PORT: z.coerce.number() }));
    expect(() => builder.build()).toThrow(ConfigError);
  });

  it("throws ConfigError at build for a bad LOG_LEVEL", () => {
    const builder = createHostBuilder({ argv: [], env: { LOG_LEVEL: "loud" } })
      .logging();
    expect(() => builder.build()).toThrow(ConfigError);
  });

  it("binds a debug logger for LOG_LEVEL=debug and a warn one by default", () => {
    const lines: string[] = [];
    const debug = createHostBuilder({ argv: [], env: { LOG_LEVEL: "debug" } })
      .logging({ write: (line) => lines.push(line) })
      .build();
    debug.services.get<Logger>(LOGGER).debug("hello");
    expect(lines).toEqual(["[debug] hello"]);

    const quiet: string[] = [];
    const warn = createHostBuilder({ argv: [], env: {} })
      .logging({ write: (line) => quiet.push(line) })
      .build();
    warn.services.get<Logger>(LOGGER).info("hidden");
    expect(quiet).toEqual([]);
  });

  it("exposes argv in the host and the services", () => {
    const host = createHostBuilder({ argv: ["1 + 2"], env: {} }).build();
    expect(host.argv).toEqual(["1 + 2"]);
    expect(host.services.get(ARGV)).toEqual(["1 + 2"]);
    expect(host.services).toBeInstanceOf(Container);
  });
});
