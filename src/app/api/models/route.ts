import { NextResponse } from "next/server";

type ModelsBody = {
  apiKey?: string;
  apiBase?: string;
};

function normalizeBaseUrl(apiBase?: string): string {
  if (!apiBase?.trim()) {
    return "https://api.openai.com/v1";
  }

  return apiBase.trim().replace(/\/+$/, "");
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as ModelsBody;

    if (!body.apiKey) {
      return NextResponse.json({ error: "Missing apiKey" }, { status: 400 });
    }

    const upstream = await fetch(`${normalizeBaseUrl(body.apiBase)}/models`, {
      headers: {
        Authorization: `Bearer ${body.apiKey}`,
      },
    });

    if (!upstream.ok) {
      const errorText = await upstream.text();
      return NextResponse.json(
        { error: errorText || "Model probing failed" },
        { status: upstream.status },
      );
    }

    const payload = (await upstream.json()) as {
      data?: Array<{ id?: string }>;
    };
    const models = (payload.data ?? [])
      .map((item) => item.id)
      .filter((id): id is string => Boolean(id));

    return NextResponse.json({ models });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unexpected model probing error",
      },
      { status: 500 },
    );
  }
}
