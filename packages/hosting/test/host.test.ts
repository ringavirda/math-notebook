import "reflect-metadata";
import { Container } from "inversify";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { Logger } from "@mathbook/common";

import {
  ARGV,
  ConfigError,
  LOGGER,
  createHostBuilder,
  type HostedService,
} from "../src/index.js";

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
    expect(events).toEqual(["start a", "start b", "main", "stop b", "stop a"]);
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

  it("returns 1 and stops the started ones when a hosted token has no binding", async () => {
    const events: string[] = [];
    const lines: string[] = [];
    const builder = createHostBuilder({ argv: [], env: {} }).logging({
      write: (line) => lines.push(line),
    });
    builder.services
      .bind<HostedService>(A)
      .toConstantValue(recording("a", events));
    const code = await builder
      .hosted(A)
      .hosted(B)
      .build()
      .run(async () => 0);
    expect(code).toBe(1);
    expect(events).toEqual(["start a", "stop a"]);
  });

  it("keeps services open until main returns after SIGINT and returns 130", async () => {
    const events: string[] = [];
    const host = hostOf({
      [A]: recording("a", events),
      [B]: recording("b", events),
    });
    const saved = process.exitCode;
    const listeners = process.listenerCount("SIGINT");
    try {
      const code = await host.run(async () => {
        process.emit("SIGINT");
        await new Promise((resolve) => setImmediate(resolve));
        events.push("main");
        return 0;
      });
      expect(code).toBe(130);
      expect(process.exitCode).toBe(130);
      expect(events).toEqual([
        "start a",
        "start b",
        "main",
        "stop b",
        "stop a",
      ]);
      expect(process.listenerCount("SIGINT")).toBe(listeners);
    } finally {
      process.exitCode = saved;
    }
  });

  it.each(["SIGINT", "SIGTERM"] as const)(
    "serves until %s, then stops in reverse and resolves 0",
    async (signal) => {
      const events: string[] = [];
      const host = hostOf({
        [A]: recording("a", events),
        [B]: recording("b", events),
      });
      const saved = process.exitCode;
      const sigint = process.listenerCount("SIGINT");
      const sigterm = process.listenerCount("SIGTERM");
      try {
        const running = host.run();
        await new Promise((resolve) => setImmediate(resolve));
        expect(events).toEqual(["start a", "start b"]);
        process.emit(signal);
        expect(await running).toBe(0);
        expect(events).toEqual(["start a", "start b", "stop b", "stop a"]);
        expect(process.exitCode).toBe(saved);
        expect(process.listenerCount("SIGINT")).toBe(sigint);
        expect(process.listenerCount("SIGTERM")).toBe(sigterm);
      } finally {
        process.exitCode = saved;
      }
    },
  );

  it("skips main and stops the started service when SIGINT arrives during start", async () => {
    const events: string[] = [];
    const slow: HostedService = {
      async start() {
        process.emit("SIGINT");
        await new Promise((resolve) => setImmediate(resolve));
        events.push("start slow");
      },
      async stop() {
        events.push("stop slow");
      },
    };
    const host = hostOf({ [A]: slow, [B]: recording("b", events) });
    const saved = process.exitCode;
    try {
      const code = await host.run(async () => {
        events.push("main");
        return 0;
      });
      expect(code).toBe(130);
      expect(events).toEqual(["start slow", "stop slow"]);
    } finally {
      process.exitCode = saved;
    }
  });

  it("builds configuration from the env under its token", () => {
    const builder = createHostBuilder({
      argv: [],
      env: { PORT: "8080" },
    }).configuration(SETTINGS, z.object({ PORT: z.coerce.number() }));
    const host = builder.build();
    expect(host.services.get(SETTINGS)).toEqual({ PORT: 8080 });
  });

  it("throws ConfigError at build for a bad value", () => {
    const builder = createHostBuilder({
      argv: [],
      env: { PORT: "x" },
    }).configuration(SETTINGS, z.object({ PORT: z.coerce.number() }));
    expect(() => builder.build()).toThrow(ConfigError);
  });

  it("throws ConfigError at build for a bad LOG_LEVEL", () => {
    const builder = createHostBuilder({
      argv: [],
      env: { LOG_LEVEL: "loud" },
    }).logging();
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

  it("uses the level option when LOG_LEVEL is not set and LOG_LEVEL over it", () => {
    const lines: string[] = [];
    const write = (line: string) => lines.push(line);
    createHostBuilder({ argv: [], env: {} })
      .logging({ write, level: "info" })
      .build()
      .services.get<Logger>(LOGGER)
      .info("shown");
    createHostBuilder({ argv: [], env: { LOG_LEVEL: "error" } })
      .logging({ write, level: "info" })
      .build()
      .services.get<Logger>(LOGGER)
      .info("hidden");
    expect(lines).toEqual(["[info] shown"]);
  });

  it("exposes argv in the host and the services", () => {
    const host = createHostBuilder({ argv: ["1 + 2"], env: {} }).build();
    expect(host.argv).toEqual(["1 + 2"]);
    expect(host.services.get(ARGV)).toEqual(["1 + 2"]);
    expect(host.services).toBeInstanceOf(Container);
  });
});
