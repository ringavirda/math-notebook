import { describe, expect, it } from "vitest";
import { EventBus } from "../src/index.js";

type Ping = { type: "ping"; n: number };

describe("EventBus", () => {
  it("delivers to every listener in subscription order", () => {
    const bus = new EventBus<Ping>();
    const seen: string[] = [];
    bus.subscribe((event) => seen.push(`a${event.n}`));
    bus.subscribe((event) => seen.push(`b${event.n}`));
    bus.publish({ type: "ping", n: 1 });
    expect(seen).toEqual(["a1", "b1"]);
  });

  it("unsubscribe stops delivery", () => {
    const bus = new EventBus<Ping>();
    const seen: number[] = [];
    const stop = bus.subscribe((event) => seen.push(event.n));
    bus.publish({ type: "ping", n: 1 });
    stop();
    bus.publish({ type: "ping", n: 2 });
    expect(seen).toEqual([1]);
  });
});
