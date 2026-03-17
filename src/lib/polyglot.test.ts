import { describe, expect, it } from "vitest";

import {
  computeWeightedScore,
  measureSentenceLength,
  segmentSentences,
} from "./polyglot";

describe("segmentSentences", () => {
  it("segments mixed Chinese and English punctuation", () => {
    const result = segmentSentences("你好。Hello world. 再见！");

    expect(result).toEqual(["你好。", "Hello world.", "再见！"]);
  });

  it("returns empty array for blank input", () => {
    expect(segmentSentences("   ")).toEqual([]);
  });
});

describe("computeWeightedScore", () => {
  it("calculates weighted average with sentence length", () => {
    const weighted = computeWeightedScore([
      { score: 100, length: measureSentenceLength("短句") },
      { score: 50, length: measureSentenceLength("a longer sentence") },
    ]);

    expect(weighted).toBe(55.26);
  });

  it("returns null when no sentence is scored", () => {
    expect(computeWeightedScore([{ score: null, length: 10 }])).toBeNull();
  });

  it("ignores unscored sentences when calculating weighted score", () => {
    const weighted = computeWeightedScore([
      { score: 80, length: 10 },
      { score: null, length: 999 },
      { score: 100, length: 10 },
    ]);

    expect(weighted).toBe(90);
  });
});
