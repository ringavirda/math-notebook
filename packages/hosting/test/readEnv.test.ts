import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { ConfigError, readEnv } from "../src/index.js";

const schema = z.object({
  MODE: z.enum(["fast", "slow"]).default("fast"),
  NAME: z.string().optional(),
  RETRIES: z.coerce.number().int().default(3),
});

describe("readEnv", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("applies defaults", () => {
    expect(readEnv(schema, {})).toEqual({ MODE: "fast", RETRIES: 3 });
  });

  it("reads the given values and ignores the rest", () => {
    expect(readEnv(schema, { MODE: "slow", NAME: "x", OTHER: "y" })).toEqual({
      MODE: "slow",
      NAME: "x",
      RETRIES: 3,
    });
  });

  it("rejects a bad value naming the variable", () => {
    expect(() => readEnv(schema, { MODE: "tepid" })).toThrow(ConfigError);
    expect(() => readEnv(schema, { MODE: "tepid" })).toThrow(/^MODE:/);
    expect(() => readEnv(schema, { RETRIES: "1.5" })).toThrow(/^RETRIES:/);
  });

  it("empty values count as unset", () => {
    expect(readEnv(schema, { MODE: "", NAME: "", RETRIES: "" })).toEqual(
      readEnv(schema, {}),
    );
  });

  it("reads process.env by default", () => {
    vi.stubEnv("MODE", "slow");
    expect(readEnv(schema).MODE).toBe("slow");
  });
});
