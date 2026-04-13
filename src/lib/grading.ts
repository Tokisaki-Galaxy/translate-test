/**
 * parseAndValidateResponse
 *
 * Multi-level parser that accepts an API response of unknown shape and tries
 * to extract a valid { referenceTranslation, score, feedback } tuple.
 *
 * Levels:
 *   1. Direct object validation – data is already a plain object.
 *   2. JSON.parse         – data is a JSON string.
 *   3. Regex { … } block – extract the first JSON-looking block from a string.
 *   4. Score-only regex  – find the first number in the string.
 */
export function parseAndValidateResponse(data: unknown): {
  referenceTranslation: string;
  score: number;
  feedback: string;
} {
  // Level 1 – already an object: validate score and feedback directly
  if (typeof data === "object" && data !== null) {
    const obj = data as Record<string, unknown>;
    const raw = obj.score;
    const score = Number(raw);
    if (
      Number.isFinite(score) &&
      score >= 0 &&
      score <= 100 &&
      typeof obj.feedback === "string"
    ) {
      return {
        referenceTranslation: (obj.referenceTranslation as string) ?? "",
        score: Math.round(score),
        feedback: obj.feedback,
      };
    }
    // Object present but values are invalid – no further fallback for objects
    throw new Error("无效的评分响应格式");
  }

  if (typeof data !== "string") {
    throw new Error("无效的评分响应格式");
  }

  // Level 2 – plain JSON string
  try {
    const parsed: unknown = JSON.parse(data);
    if (typeof parsed === "object" && parsed !== null) {
      return parseAndValidateResponse(parsed);
    }
  } catch {
    // fall through
  }

  // Level 3 – extract first {...} block and try to parse it
  const jsonBlockMatch = data.match(/\{[^}]*\}/);
  if (jsonBlockMatch) {
    try {
      const parsed: unknown = JSON.parse(jsonBlockMatch[0]);
      if (typeof parsed === "object" && parsed !== null) {
        return parseAndValidateResponse(parsed);
      }
    } catch {
      // fall through
    }
  }

  // Level 4 – extract "参考译文|分数|评语" format
  const pipeFormatMatch = data.match(/^(.+?)\|(\d+(?:\.\d+)?)\|(.+)$/);
  if (pipeFormatMatch) {
    const referenceTranslation = pipeFormatMatch[1].trim();
    const score = Number(pipeFormatMatch[2]);
    const feedback = pipeFormatMatch[3].trim();
    if (Number.isFinite(score) && score >= 0 && score <= 100) {
      return {
        referenceTranslation,
        score: Math.round(score),
        feedback,
      };
    }
  }

  // Level 5 – extract the first number that looks like a score (0-100)
  const scoreMatch = data.match(/(\d+(?:\.\d+)?)/);
  if (scoreMatch) {
    const score = Number(scoreMatch[1]);
    if (Number.isFinite(score) && score >= 0 && score <= 100) {
      return {
        referenceTranslation: "",
        score: Math.round(score),
        feedback: data,
      };
    }
  }

  throw new Error("无效的评分响应格式");
}
