import type { z } from "zod";

/** A setting that holds a value the app does not accept. */
export class ConfigError extends Error {
  override name = "ConfigError";
}

/**
 * Parses the environment with a schema whose keys are variable names. An empty value counts
 * as unset, so a schema default applies to it. A schema-level issue with no variable name gives
 * a message starting with `: `.
 * @param schema describes the variables read; unknown variables are ignored.
 * @param env the environment to read; defaults to `process.env`.
 * @returns the parsed settings.
 * @throws {ConfigError} `<VAR>: <message>` naming the first variable that holds a bad value.
 */
export function readEnv<T>(
  schema: z.ZodType<T>,
  env: NodeJS.ProcessEnv = process.env,
): T {
  const present = Object.fromEntries(
    Object.entries(env).filter(([, value]) => value !== ""),
  );
  const parsed = schema.safeParse(present);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new ConfigError(`${issue.path.join(".")}: ${issue.message}`);
  }
  return parsed.data;
}
