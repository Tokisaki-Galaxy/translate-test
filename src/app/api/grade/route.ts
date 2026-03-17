import { NextResponse } from "next/server";

type GradeBody = {
  original?: string;
  translation?: string;
  apiKey?: string;
  apiBase?: string;
  model?: string;
  level?: string;
};

const GRADING_TEMPERATURE = 0.2;

function normalizeBaseUrl(apiBase?: string): string {
  if (!apiBase?.trim()) {
    return "https://api.openai.com/v1";
  }

  return apiBase.trim().replace(/\/+$/, "");
}

function buildSystemPrompt(level?: string): string {
  const difficultyContext = level?.trim()
    ? `当前用户的备考目标/文本难度为：【${level}】。请严格按照该级别的学术标准进行严苛评判。`
    : `请先自动分析原句的词汇（如CEFR等级、是否包含熟词僻义）和句法复杂度（长难句、从句嵌套），推断其大致学术难度（如四级、六级、考研、雅思等），并据此设定打分的严苛度。`;

  return `你是一个冷酷、极其严苛的英语阅读理解翻译评估专家。
${difficultyContext}

【评分规则】(基础分100，严格实行扣分制。如果翻译扭曲了核心句意，总分必须低于60分)：
1. 核心词义错误：漏译或错译了关键动词、名词，或未识别出“熟词僻义”，每个严重错误扣 10-15 分。
2. 句法逻辑崩塌：主谓宾找错、修饰关系倒置、从句翻译混乱，扣 15-20 分。
3. 漏译/画蛇添足：忽略了原句的修饰词或强加意思，每个扣 5-10 分。
4. 中文表达生硬：语序不符合中文习惯或搭配不当，每个扣 3-5 分。

【输出格式要求】
仅返回 "score|feedback" 格式。例如"65|原句take在此处为索取而非携带；漏译economists"。`;
}

export function parseModelResponse(content: string): {
  score: number;
  feedback: string;
} {
  const normalized = content
    .trim()
    .replace(/^```[\w]*\s*/gi, "")
    .replace(/\s*```$/gi, "");
    
  const separatorIndex = normalized.indexOf("|");
  if (separatorIndex === -1) {
    const scoreMatch = normalized.match(/(\d{1,3})/);
    return {
      score: scoreMatch ? Number(scoreMatch[1]) : 0,
      feedback: normalized || "解析模型反馈失败，请重试。",
    };
  }

  const rawScore = normalized.substring(0, separatorIndex).trim();
  const feedback = normalized.substring(separatorIndex + 1).trim();
  const scoreMatch = rawScore.match(/(\d+(?:\.\d+)?)/);
  const score = scoreMatch ? Number(scoreMatch[1]) : NaN;

  if (!Number.isFinite(score)) {
    throw new Error("Invalid score format");
  }

  return {
    score: Math.max(0, Math.min(100, Math.round(score))),
    feedback: feedback,
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
          { role: "system", content: buildSystemPrompt(body.level) },
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
