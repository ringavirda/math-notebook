import { z } from "zod";

export const definitionSchema = z.object({
  name: z.string(),
  source: z.string(),
  dependsOn: z.array(z.string()),
});

export const notebookSchema = z.object({
  name: z.string(),
  definitions: z.array(definitionSchema),
});

export const evaluationSchema = z.object({
  notebook: z.string(),
  source: z.string(),
  kind: z.enum(["expression", "definition"]),
  result: z.number().optional(),
  error: z
    .object({
      stage: z.enum(["lexical", "syntax", "semantic", "evaluation", "domain"]),
      message: z.string(),
    })
    .optional(),
  at: z.date(),
});

/** A notebook with its definitions embedded; `dependsOn` holds definition names. */
export type NotebookDocument = z.infer<typeof notebookSchema>;

/** One history record; `result` and `error` are absent rather than null. */
export type EvaluationDocument = z.infer<typeof evaluationSchema>;
