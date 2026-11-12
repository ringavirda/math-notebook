import {
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  unique,
} from "drizzle-orm/sqlite-core";

export const notebooks = sqliteTable("notebooks", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull().unique(),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const definitions = sqliteTable(
  "definitions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    notebookId: integer("notebook_id")
      .notNull()
      .references(() => notebooks.id),
    name: text("name").notNull(),
    source: text("source").notNull(),
    position: integer("position").notNull(),
  },
  (table) => [unique().on(table.notebookId, table.name)],
);

export const dependencies = sqliteTable(
  "dependencies",
  {
    definitionId: integer("definition_id")
      .notNull()
      .references(() => definitions.id, { onDelete: "cascade" }),
    dependsOnId: integer("depends_on_id")
      .notNull()
      .references(() => definitions.id),
  },
  (table) => [primaryKey({ columns: [table.definitionId, table.dependsOnId] })],
);

export const evaluations = sqliteTable(
  "evaluations",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    notebookId: integer("notebook_id")
      .notNull()
      .references(() => notebooks.id),
    source: text("source").notNull(),
    kind: text("kind", { enum: ["expression", "definition"] }).notNull(),
    result: real("result"),
    errorStage: text("error_stage"),
    errorMessage: text("error_message"),
    at: integer("at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [index("evaluations_notebook_at").on(table.notebookId, table.at)],
);
