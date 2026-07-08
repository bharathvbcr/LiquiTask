import { describe, expect, it } from "vitest";
import { parseJsonFromLlmContent } from "../aiService";

describe("parseJsonFromLlmContent", () => {
  it("parses plain JSON", () => {
    expect(parseJsonFromLlmContent('{"a":1}')).toEqual({ a: 1 });
  });

  it("unwraps a ```json code fence", () => {
    expect(parseJsonFromLlmContent('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it("unwraps a bare ``` code fence", () => {
    expect(parseJsonFromLlmContent("```\n[1,2,3]\n```")).toEqual([1, 2, 3]);
  });

  it("recovers JSON embedded in prose", () => {
    expect(
      parseJsonFromLlmContent('Sure! Here you go:\n{"title":"x"}\nHope that helps.'),
    ).toEqual({ title: "x" });
  });

  it("tolerates trailing commas", () => {
    expect(parseJsonFromLlmContent('{"a":1,"b":[2,3,],}')).toEqual({ a: 1, b: [2, 3] });
  });

  it("handles a fence + prose + trailing commas together", () => {
    expect(parseJsonFromLlmContent('Here:\n```json\n{"tags":["a","b",],}\n```')).toEqual({
      tags: ["a", "b"],
    });
  });

  it("throws when there is no JSON to find", () => {
    expect(() => parseJsonFromLlmContent("no json here")).toThrow(/Failed to parse/i);
  });
});
