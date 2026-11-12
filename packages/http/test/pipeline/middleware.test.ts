import { describe, expect, it } from "vitest";

import { RequestError, readString } from "../../src/index.js";

describe("readString", () => {
  it("returns the property", () => {
    expect(readString('{"name":"a","line":"1 + 2"}', "line")).toBe("1 + 2");
  });

  it("throws RequestError for text that is not JSON", () => {
    expect(() => readString("{", "name")).toThrow(RequestError);
    expect(() => readString("{", "name")).toThrow("Body is not valid JSON");
    expect(() => readString("", "name")).toThrow("Body is not valid JSON");
  });

  it("throws for a missing property, a non-string one and a non-object body", () => {
    const needs = 'Body needs a string "name"';
    expect(() => readString("{}", "name")).toThrow(needs);
    expect(() => readString('{"name":3}', "name")).toThrow(needs);
    expect(() => readString("null", "name")).toThrow(needs);
    expect(() => readString("[]", "name")).toThrow(needs);
  });

  it("names itself RequestError", () => {
    expect(new RequestError("x").name).toBe("RequestError");
  });
});
