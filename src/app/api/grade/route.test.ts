import { describe, expect, it } from "vitest";

import { parseModelResponse } from "./route";

describe("parseModelResponse", () => {
  it("parses score and feedback separated by pipe", () => {
    expect(parseModelResponse("89|很好，但是有些地方可以更自然")).toEqual({
      score: 89,
      feedback: "很好，但是有些地方可以更自然",
    });
  });

  it("supports wrapped content in code fences", () => {
    expect(parseModelResponse("```json\n92|表达流畅\n```")).toEqual({
      score: 92,
      feedback: "表达流畅",
    });
  });

  it("keeps extra pipes in feedback", () => {
    expect(parseModelResponse("75|术语准确|语气稍生硬")).toEqual({
      score: 75,
      feedback: "术语准确|语气稍生硬",
    });
  });

  it("throws when score is invalid", () => {
    expect(() => parseModelResponse("很好|翻译自然")).toThrow(
      "Invalid score format",
    );
  });

  it("parses score when LLM adds prefix text before pipe", () => {
    expect(parseModelResponse("分值: 65.00|漏译了核心动词")).toEqual({
      score: 65,
      feedback: "漏译了核心动词",
    });
  });
});
