import { notebookSettings } from "@mathbook/notebook-setup";
import { z } from "zod";

/** Token of the `Config` bound by the host's `configuration`. */
export const CONFIG: unique symbol = Symbol("mathbook.config");

/** The environment variables the app reads; `LOG_LEVEL` is read by the host. */
export const configSchema = notebookSettings.extend({
  PORT: z.coerce.number().int().min(0).max(65535).default(3000),
});

export type Config = z.infer<typeof configSchema>;
