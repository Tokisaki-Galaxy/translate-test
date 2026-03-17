import { describe, expect, it } from "vitest";

import { parseAndValidateResponse } from "./grading";

describe("parseAndValidateResponse", () => {
  it("validates a plain object with score and feedback", () => {
    expect(
      parseAndValidateResponse({ score: 85, feedback: "very good" }),
    ).toEqual({
      score: 85,
      feedback: "very good",
    });
  });

  it("throws when the object has an invalid score or non-string feedback", () => {
    expect(() =>
      parseAndValidateResponse({ score: 150, feedback: "out of range" }),
    ).toThrow("无效的评分响应格式");
    expect(() =>
      parseAndValidateResponse({ score: 80, feedback: 123 }),
    ).toThrow("无效的评分响应格式");
  });

  it("parses a JSON string (level 2)", () => {
    expect(
      parseAndValidateResponse('{"score":90,"feedback":"fluent"}'),
    ).toEqual({ score: 90, feedback: "fluent" });
  });

  it("extracts a JSON block from a noisy string (level 3)", () => {
    expect(
      parseAndValidateResponse(
        'Result: {"score":65,"feedback":"missing verb"} end',
      ),
    ).toEqual({ score: 65, feedback: "missing verb" });
  });

  it("falls back to first numeric score and throws when none found (level 4)", () => {
    expect(parseAndValidateResponse("score 78 points").score).toBe(78);
    expect(() => parseAndValidateResponse(null)).toThrow("无效的评分响应格式");
  });
});
