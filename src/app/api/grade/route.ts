import { NextResponse } from "next/server";

type GradeBody = {
  original?: string;
  translation?: string;
  apiKey?: string;
  apiBase?: string;
  model?: string;
};

const SYSTEM_PROMPT =
  "对比原句和翻译，给出 0-100 的评分和简短评价。仅返回 JSON: {score: number, feedback: string}";
const GRADING_TEMPERATURE = 0.2;

function normalizeBaseUrl(apiBase?: string): string {
  if (!apiBase?.trim()) {
    return "https://api.openai.com/v1";
  }

  return apiBase.trim().replace(/\/+$/, "");
}

function parseModelResponse(content: string): {
  score: number;
  feedback: string;
} {
  const normalized = content
    .trim()
    .replace(/^```(?:json)?\s*|\s*```$/gi, "");
  const parsed = JSON.parse(normalized) as {
    score?: number;
    feedback?: string;
  };
  const score = Number(parsed.score);

  if (!Number.isFinite(score)) {
    throw new Error("Invalid score format");
  }

  return {
    score: Math.max(0, Math.min(100, Math.round(score))),
    feedback: typeof parsed.feedback === "string" ? parsed.feedback : "",
  };
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as GradeBody;

    if (!body.original || !body.translation || !body.apiKey || !body.model) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 },
      );
    }

    const url = `${normalizeBaseUrl(body.apiBase)}/chat/completions`;
    const upstream = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${body.apiKey}`,
      },
      body: JSON.stringify({
        model: body.model,
        temperature: GRADING_TEMPERATURE,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: `原句: ${body.original}\n翻译: ${body.translation}`,
          },
        ],
      }),
    });

    if (!upstream.ok) {
      const errorText = await upstream.text();
      return NextResponse.json(
        { error: errorText || "LLM request failed" },
        { status: upstream.status },
      );
    }

    const payload = (await upstream.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };

    const content = payload.choices?.[0]?.message?.content;
    if (!content) {
      return NextResponse.json(
        { error: "No content returned by model" },
        { status: 502 },
      );
    }

    return NextResponse.json(parseModelResponse(content));
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Unexpected grading error",
      },
      { status: 500 },
    );
  }
}
