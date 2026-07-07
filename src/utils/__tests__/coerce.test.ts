import { describe, expect, it } from "vitest";
import { asString, asStringArray, normalizeSubtaskTitles } from "../coerce";

describe("asString", () => {
  it("passes strings through", () => {
    expect(asString("hello")).toBe("hello");
  });

  it("stringifies numbers and booleans", () => {
    expect(asString(42)).toBe("42");
    expect(asString(true)).toBe("true");
  });

  it("returns the fallback for null/undefined", () => {
    expect(asString(null)).toBe("");
    expect(asString(undefined, "n/a")).toBe("n/a");
  });

  it("unwraps object-as-string shapes from LLM output", () => {
    expect(asString({ title: "Do X", description: "extra" })).toBe("Do X");
    expect(asString({ name: "Named" })).toBe("Named");
    expect(asString({ text: "Texty" })).toBe("Texty");
    expect(asString({ step: "Step one" })).toBe("Step one");
  });

  it("prefers title over other keys", () => {
    expect(asString({ title: "T", name: "N", text: "X" })).toBe("T");
  });

  it("falls back when an object has no string-like key", () => {
    expect(asString({ foo: 1, bar: {} }, "fallback")).toBe("fallback");
  });

  it("joins arrays", () => {
    expect(asString(["a", "b", "c"])).toBe("a, b, c");
  });

  it("handles a couple levels of nesting", () => {
    expect(asString(["a", ["b", "c"]])).toBe("a, b, c");
  });

  it("does not blow the stack on pathological nesting", () => {
    // Build a deeply nested array; the depth guard should bound recursion and
    // fall back rather than recurse without limit.
    let deep: unknown = "x";
    for (let i = 0; i < 5000; i += 1) deep = [deep];
    expect(() => asString(deep, "safe")).not.toThrow();
    expect(asString(deep, "safe")).toBe("safe");
  });
});

describe("asStringArray", () => {
  it("returns [] for nullish", () => {
    expect(asStringArray(null)).toEqual([]);
    expect(asStringArray(undefined)).toEqual([]);
  });

  it("normalizes a mixed array of strings and objects", () => {
    expect(asStringArray(["Plain", { title: "Object title" }, { name: "Named" }])).toEqual([
      "Plain",
      "Object title",
      "Named",
    ]);
  });

  it("trims, drops empties, and de-duplicates", () => {
    expect(asStringArray(["  a  ", "", "a", { title: "  " }, "b"])).toEqual(["a", "b"]);
  });

  it("wraps a single value into an array", () => {
    expect(asStringArray("solo")).toEqual(["solo"]);
  });
});

describe("normalizeSubtaskTitles", () => {
  it("recovers the crash case: AI returns subtasks as objects", () => {
    // This exact shape (objects instead of strings) triggered
    // `invalid type: map, expected a string` at the native boundary.
    const fromLlm = [
      { title: "Locate the component", description: "..." },
      { title: "Rework the styles" },
      "Verify no regressions",
    ];
    expect(normalizeSubtaskTitles(fromLlm)).toEqual([
      "Locate the component",
      "Rework the styles",
      "Verify no regressions",
    ]);
  });

  it("returns [] when given junk", () => {
    expect(normalizeSubtaskTitles(undefined)).toEqual([]);
    expect(normalizeSubtaskTitles([{ foo: 1 }])).toEqual([]);
  });
});
