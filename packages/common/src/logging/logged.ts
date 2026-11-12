import type { Logger } from "./logger.js";

/** A class whose instances expose the logger that `logged` writes to. */
export interface HasLogger {
  readonly logger: Logger;
}

const show = (arg: unknown): string => {
  if (typeof arg === "string") return arg;
  try {
    return JSON.stringify(arg) ?? String(arg);
  } catch {
    return String(arg);
  }
};

/**
 * Method decorator for async methods of a class with a `logger`. Writes
 * `<key>(<arguments>) took <n> ms` at debug level, or `<key>(<arguments>) failed after <n> ms`
 * and rethrows; `<n>` is whole milliseconds and covers everything the method's promise waits on,
 * including time queued behind other calls.
 * An argument that cannot be serialized as JSON (circular, BigInt) is printed with `String`. Works only on a method that returns a Promise.
 * @param target the class prototype.
 * @param key the method name.
 * @param descriptor the method's descriptor; its value is replaced by the wrapper.
 */
export function logged(
  target: HasLogger,
  key: string,
  descriptor: TypedPropertyDescriptor<(...args: any[]) => Promise<any>>,
): void {
  const original = descriptor.value!;
  descriptor.value = async function (this: HasLogger, ...args: any[]) {
    const call = `${key}(${args.map(show).join(", ")})`;
    const started = performance.now();
    const elapsed = () => Math.round(performance.now() - started);
    try {
      const result = await original.apply(this, args);
      this.logger.debug(`${call} took ${elapsed()} ms`);
      return result;
    } catch (error) {
      this.logger.debug(`${call} failed after ${elapsed()} ms`);
      throw error;
    }
  };
}
