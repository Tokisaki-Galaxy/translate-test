import type { Sentence } from "@/lib/db";

const SCORE_THRESHOLD_LOW = 60;
const SCORE_THRESHOLD_HIGH = 90;

export function segmentSentences(text: string, locale?: string): string[] {
  const content = text.trim();

  if (!content) {
    return [];
  }

  const segmenter = new Intl.Segmenter(locale, { granularity: "sentence" });

  return Array.from(segmenter.segment(content))
    .map((item) => item.segment.trim())
    .filter(Boolean);
}

export function measureSentenceLength(sentence: string): number {
  return Array.from(sentence).length;
}

export function computeWeightedScore(
  sentences: Array<Pick<Sentence, "score" | "length">>,
): number | null {
  let totalWeight = 0;
  let weightedScore = 0;

  for (const sentence of sentences) {
    if (typeof sentence.score !== "number") {
      continue;
    }

    totalWeight += sentence.length;
    weightedScore += sentence.length * sentence.score;
  }

  if (totalWeight === 0) {
    return null;
  }

  return Number((weightedScore / totalWeight).toFixed(2));
}

export function scoreColor(score: number | null): string {
  if (score === null) {
    return "text-muted-foreground";
  }

  if (score < SCORE_THRESHOLD_LOW) {
    return "text-red-600";
  }

  if (score > SCORE_THRESHOLD_HIGH) {
    return "text-green-600";
  }

  return "text-amber-500";
}
