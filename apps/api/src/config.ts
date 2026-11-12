import { resolve } from "node:path";
import { z } from "zod";

/** Token of the `Config` bound by the host's `configuration`. */
export const CONFIG: unique symbol = Symbol("mathbook.config");

/** The environment variables the app reads; `LOG_LEVEL` is read by the host. */
export const configSchema = z.object({
  MATHBOOK_STORAGE: z.enum(["sqlite", "mongo"]).default("sqlite"),
  MATHBOOK_DB: z
    .string()
    .default(resolve(import.meta.dirname, "../../cli/data/notebook.db")),
  MATHBOOK_MONGO_URL: z.string().default("mongodb://localhost:27017/mathbook"),
  PORT: z.coerce.number().int().min(0).max(65535).default(3000),
});

export type Config = z.infer<typeof configSchema>;
