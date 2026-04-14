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

const LEVEL_PROMPTS: Record<string, string> = {
  standard: `当前难度档次为【标准】（对应四级 / 六级水平）。
你的评判重点是：翻译得对不对。
- 侧重语义是否准确传达，忽略微小拼写或冠词错误。
- 对基本正确的翻译多加鼓励，评分宽松，语气友好。
- 如果核心意思无误，即使表达不够地道，也不必大幅扣分。`,

  academic: `当前难度档次为【学术】（对应考研 / 雅思 / 托福水平）。
你的评判重点是：逻辑拆解得准不准。
- 绝对严查语法结构：主谓宾关系、从句嵌套、修饰语归属，任何逻辑混乱都须扣分。
- 要求学术用词精准、表达地道，不得含糊或口语化。
- 核心词义偏差或句法崩塌直接拉低总分至60分以下。`,

  professional: `当前难度档次为【专业】（对应 GRE / CATTI 水平）。
你是一位严苛的翻译审校专家，评判重点是：表达得雅不雅。
- 重点考察文采、语境适配和高阶词汇选用，须体现"信达雅"。
- 即使语义正确，若措辞平庸、缺乏文采，仍须显著扣分。
- 高分（90+）极难获得，须有出色的遣词造句才能达到。`,
};

function buildSystemPrompt(level?: string): string {
  const levelKey = level?.trim() ?? "";
  const difficultyContext =
    LEVEL_PROMPTS[levelKey] ??
    `请先自动分析原句的词汇（如CEFR等级、是否包含熟词僻义）和句法复杂度（长难句、从句嵌套），推断其大致学术难度，并据此设定打分的严苛度。`;

  return `你是一个冷酷、极其严苛的英语阅读翻译评估专家。
${difficultyContext}

【评分规则】(基础分100，严格实行扣分制。如果翻译扭曲了核心句意，总分必须低于60分)：
1. 核心词义错误：漏译或错译了关键动词、名词，或未识别出“熟词僻义”，每个严重错误扣 10-15 分。
2. 句法逻辑崩塌：主谓宾找错、修饰关系倒置、从句翻译混乱，扣 15-20 分。
3. 漏译/画蛇添足：忽略了原句的修饰词或强加意思，每个扣 5-10 分。
4. 中文表达生硬：语序不符合中文习惯或搭配不当，每个扣 3-5 分。
5. 中文代词不清：翻译中使用错误的性别第三方代词，她、他等，导致指代不明，此类不扣分。

【输出格式要求】
仅返回 "参考译文|分数|评语" 格式。例如"数字界面的普遍存...|65|原句take在此处为索取而非携带；漏译economists。`;
}

export function parseModelResponse(content: string): {
  referenceTranslation: string;
  score: number;
  feedback: string;
} {
  const normalized = content
    .trim()
    .replace(/^```[\w]*\s*/gi, "")
    .replace(/\s*```$/gi, "");
  
  // Split by | to get the three parts: referenceTranslation|score|feedback
  const parts = normalized.split("|").map((p) => p.trim());
  
  if (parts.length < 2) {
    // Fallback for old format (score|feedback)
    const separatorIndex = normalized.indexOf("|");
    if (separatorIndex === -1) {
      const scoreMatch = normalized.match(/(\d{1,3})/);
      return {
        referenceTranslation: "",
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
      referenceTranslation: "",
      score: Math.max(0, Math.min(100, Math.round(score))),
      feedback: feedback,
    };
  }

  // New format: referenceTranslation|score|feedback
  const referenceTranslation = parts[0];
  const rawScore = parts[1];
  const feedback = parts.slice(2).join("|").trim(); // In case feedback contains |

  const scoreMatch = rawScore.match(/(\d+(?:\.\d+)?)/);
  const score = scoreMatch ? Number(scoreMatch[1]) : NaN;

  if (!Number.isFinite(score)) {
    throw new Error("Invalid score format");
  }

  return {
    referenceTranslation: referenceTranslation,
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
