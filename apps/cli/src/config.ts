import { notebookNamePattern } from "@mathbook/notebook";
import { notebookSettings } from "@mathbook/notebook-setup";
import { z } from "zod";

/** Token of the `Config` bound by the host's `configuration`. */
export const CONFIG: unique symbol = Symbol("mathbook.config");

/** The environment variables the app reads; `LOG_LEVEL` is read by the host. */
export const configSchema = notebookSettings.extend({
  MATHBOOK_NOTEBOOK: z.string().regex(notebookNamePattern).default("main"),
});

export type Config = z.infer<typeof configSchema>;
