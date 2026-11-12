import { EvalError, ParseError, SemanticError } from "@mathbook/interpreter";
import { describe, expect, it } from "vitest";
import {
  DependencyError,
  Notebook,
  NotFoundError,
  StorageError,
} from "../src/index.js";

function notebookWith(...lines: string[]): Notebook {
  const notebook = new Notebook("main");
  lines.forEach((line) => notebook.run(line));
  return notebook;
}

function valueOf(notebook: Notebook, name: string): number | undefined {
  return notebook.definitions().find((d) => d.name === name)?.value;
}

const priced = [
  "rate = 0.2",
  "price = 40",
  "total(n) = n * price * (1 + rate)",
];

describe("Notebook", () => {
  it("defines and evaluates", () => {
    const notebook = notebookWith(...priced);
    expect(notebook.run("total(3)")).toEqual({
      kind: "expression",
      source: "total(3)",
      value: 144,
    });
    expect(notebook.definitions().map((d) => d.name)).toEqual([
      "rate",
      "price",
      "total",
    ]);
  });

  it("describes a definition and what it depends on", () => {
    const notebook = notebookWith(...priced);
    expect(notebook.definitions()[2]).toEqual({
      name: "total",
      params: ["n"],
      source: "total(n) = n * price * (1 + rate)",
      dependsOn: ["price", "rate"],
    });
    expect(notebook.definitions()[1]).toMatchObject({
      name: "price",
      value: 40,
      dependsOn: [],
    });
  });

  it("recomputes dependents in dependency order", () => {
    const notebook = notebookWith(...priced, "subtotal = price * 2");
    notebook.run("double = subtotal * 2");
    const result = notebook.run("price = 50");
    expect(result).toMatchObject({
      kind: "definition",
      recomputed: [
        { name: "subtotal", value: 100 },
        { name: "double", value: 200 },
      ],
    });
    expect(valueOf(notebook, "subtotal")).toBe(100);
  });

  it("recomputes through a function", () => {
    const notebook = notebookWith("a = 1", "f(x) = x + a", "b = f(1)");
    const result = notebook.run("a = 10");
    expect(result).toMatchObject({ recomputed: [{ name: "b", value: 11 }] });
  });

  it("keeps the place of a redefinition", () => {
    const notebook = notebookWith("a = 1", "b = 2");
    notebook.run("a = 3");
    expect(notebook.sources()).toEqual(["a = 3", "b = 2"]);
  });

  it("refuses a cycle and stores nothing", () => {
    const notebook = notebookWith("b = 1", "a = b");
    expect(() => notebook.run("b = a")).toThrow(SemanticError);
    expect(() => notebook.run("b = a")).toThrow("Cycle: b -> a -> b");
    expect(notebook.sources()).toEqual(["b = 1", "a = b"]);
    expect(valueOf(notebook, "b")).toBe(1);
  });

  it("refuses a self reference", () => {
    const notebook = notebookWith("x = 1");
    expect(() => notebook.run("x = x + 1")).toThrow("Cycle: x -> x");
    expect(() => notebook.run("f(n) = f(n - 1)")).toThrow(SemanticError);
  });

  it("refuses a define whose dependent would fail evaluation", () => {
    const notebook = notebookWith("x = 1", "y = 1 / x");
    expect(() => notebook.run("x = 0")).toThrow(DependencyError);
    expect(() => notebook.run("x = 0")).toThrow(/'y'.*evaluation error/);
    expect(valueOf(notebook, "x")).toBe(1);
    expect(valueOf(notebook, "y")).toBe(1);
  });

  it("refuses a define whose dependent would fail analysis", () => {
    const notebook = notebookWith("x = 1", "y = 1 / x");
    expect(() => notebook.run("x(a) = a")).toThrow(DependencyError);
    expect(() => notebook.run("x(a) = a")).toThrow(/'y'.*semantic error/);
    expect(valueOf(notebook, "x")).toBe(1);
  });

  it("refuses a changed argument count", () => {
    const notebook = notebookWith("f(a) = a", "g = f(1)");
    expect(() => notebook.run("f(a, b) = a")).toThrow(DependencyError);
  });

  it("refuses a definition that fails a stage without touching dependents", () => {
    const notebook = notebookWith("x = 1");
    expect(() => notebook.run("y = 1 / 0")).toThrow(EvalError);
    expect(() => notebook.run("y = ")).toThrow(ParseError);
    expect(() => notebook.run("y = z")).toThrow(SemanticError);
    expect(notebook.sources()).toEqual(["x = 1"]);
  });

  it("refuses a remove while the definition is used", () => {
    const notebook = notebookWith("x = 1", "y = x", "z = y");
    expect(() => notebook.remove("x")).toThrow(DependencyError);
    expect(() => notebook.remove("x")).toThrow("used by y, z");
    notebook.remove("z");
    notebook.remove("y");
    notebook.remove("x");
    expect(notebook.definitions()).toEqual([]);
  });

  it("refuses to remove or inspect an unknown name", () => {
    const notebook = notebookWith("x = 1");
    expect(() => notebook.remove("q")).toThrow(NotFoundError);
    expect(() => notebook.dependents("q")).toThrow(NotFoundError);
    expect(() => notebook.dependencies("q")).toThrow(NotFoundError);
  });

  it("lets parameters shadow definitions", () => {
    const notebook = notebookWith("n = 5", "f(n) = n * 2");
    expect(notebook.run("f(3)")).toMatchObject({ value: 6 });
    expect(notebook.dependents("n")).toEqual([]);
    notebook.run("n = 7");
    expect(notebook.run("f(3)")).toMatchObject({ value: 6 });
  });

  it("lists transitive dependencies and dependents in dependency order", () => {
    const notebook = notebookWith("a = 1", "b = a + 1", "c = b + a", "d = c");
    expect(notebook.dependents("a")).toEqual(["b", "c", "d"]);
    expect(notebook.dependencies("d")).toEqual(["a", "b", "c"]);
    expect(notebook.dependencies("a")).toEqual([]);
  });

  it("restores definitions that are stored in an order of their own", () => {
    const notebook = Notebook.restore("main", ["a = b + 1", "b = 2"]);
    expect(notebook.sources()).toEqual(["a = b + 1", "b = 2"]);
    expect(valueOf(notebook, "a")).toBe(3);
  });

  it("round trips a notebook through its sources", () => {
    const notebook = notebookWith("a = 1", "b = 2", "a = b + 1");
    expect(notebook.sources()).toEqual(["a = b + 1", "b = 2"]);
    const restored = Notebook.restore("main", notebook.sources());
    expect(restored.definitions()).toEqual(notebook.definitions());
  });

  it("rejects invalid stored sources as a storage error", () => {
    expect(() => Notebook.restore("main", ["1 + 1"])).toThrow(StorageError);
    expect(() => Notebook.restore("main", ["a = b"])).toThrow(
      "Cannot read notebook 'main'",
    );
    expect(() => Notebook.restore("main", ["a = b", "b = a"])).toThrow(
      StorageError,
    );
    expect(() => Notebook.restore("main", ["x = "])).toThrow(StorageError);
  });
});
