import { resolve } from "node:path";
import { z } from "zod";

/** The environment variables the notebook reads; an app's configuration extends it. */
export const notebookSettings = z.object({
  MATHBOOK_STORAGE: z.enum(["sqlite", "mongo"]).default("sqlite"),
  MATHBOOK_DB: z
    .string()
    .default(resolve(import.meta.dirname, "../../../data/notebook.db")),
  MATHBOOK_MONGO_URL: z.string().default("mongodb://localhost:27017/mathbook"),
});

export type NotebookSettings = z.infer<typeof notebookSettings>;
