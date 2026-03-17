"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowUp, Loader2, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarInset,
} from "@/components/ui/sidebar";
import { Textarea } from "@/components/ui/textarea";
import { type Sentence, type Session, db } from "@/lib/db";
import {
  computeWeightedScore,
  measureSentenceLength,
  scoreColor,
  segmentSentences,
} from "@/lib/polyglot";
import { cn } from "@/lib/utils";

type SentenceState = Sentence & {
  id: number;
  loading: boolean;
  savedTranslation: string;
};

type Settings = {
  apiKey: string;
  apiBase: string;
  model: string;
};

const SETTINGS_KEY = "polyglot_settings";
const SESSION_TITLE_MAX_CHARS = 24;
const AUTO_GRADE_DELAY_MS = 5000;

const defaultSettings: Settings = {
  apiKey: "",
  apiBase: "https://api.openai.com/v1",
  model: "gpt-4o-mini",
};

export default function Home() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<number | null>(
    null,
  );
  const [sentences, setSentences] = useState<SentenceState[]>([]);
  const [articleInput, setArticleInput] = useState("");
  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const [models, setModels] = useState<string[]>(["gpt-4o-mini"]);
  const [probing, setProbing] = useState(false);

  const timersRef = useRef<Record<number, ReturnType<typeof setTimeout>>>({});
  const refreshKeyRef = useRef(0);
  const selectedSessionIdRef = useRef<number | null>(null);

  useEffect(() => {
    selectedSessionIdRef.current = selectedSessionId;
  }, [selectedSessionId]);

  const refreshSessions = useCallback(
    async (preferredSessionId?: number | null) => {
      const sessionList = await db.sessions
        .orderBy("createdAt")
        .reverse()
        .toArray();
      setSessions(sessionList);

    const targetId =
      preferredSessionId ?? selectedSessionIdRef.current ?? sessionList[0]?.id ?? null;
      if (!targetId) {
        setSelectedSessionId(null);
        setSentences([]);
        return;
      }

      setSelectedSessionId(targetId);
      const sentenceList = await db.sentences
        .where("sessionId")
        .equals(targetId)
        .toArray();
      setSentences(
        sentenceList
          .filter(
            (sentence): sentence is Sentence & { id: number } =>
              typeof sentence.id === "number",
          )
          .map((sentence) => ({
            ...sentence,
            loading: false,
            savedTranslation: sentence.translation,
          })),
      );
    },
    [],
  );

  useEffect(() => {
    const cached = window.localStorage.getItem(SETTINGS_KEY);
    if (cached) {
      try {
        const parsed = JSON.parse(cached) as Settings;
        setSettings({ ...defaultSettings, ...parsed });
        if (parsed.model) {
          setModels((prev) => Array.from(new Set([...prev, parsed.model])));
        }
      } catch {
        setSettings(defaultSettings);
      }
    }

    void refreshSessions();
  }, [refreshSessions]);

  useEffect(() => {
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  }, [settings]);

  useEffect(() => {
    const activeTimers = timersRef.current;
    return () => {
      for (const timer of Object.values(activeTimers)) {
        clearTimeout(timer);
      }
    };
  }, []);

  const currentScore = useMemo(
    () => computeWeightedScore(sentences),
    [sentences],
  );

  async function syncSessionScore(sessionId: number, items: SentenceState[]) {
    const totalScore = computeWeightedScore(items);
    await db.sessions.update(sessionId, { totalScore });
    await refreshSessions(sessionId);
  }

  async function processArticle() {
    const segmented = segmentSentences(articleInput);

    if (segmented.length === 0) {
      return;
    }

    const createdAt = Date.now();
    const title =
      segmented[0].slice(0, SESSION_TITLE_MAX_CHARS) ||
      `Session ${new Date(createdAt).toLocaleString()}`;
    const sessionId = await db.sessions.add({
      title,
      createdAt,
      totalScore: null,
    });
    if (typeof sessionId !== "number") {
      return;
    }

    await db.sentences.bulkAdd(
      segmented.map((original) => ({
        sessionId,
        original,
        translation: "",
        score: null,
        feedback: "",
        length: measureSentenceLength(original),
      })),
    );

    refreshKeyRef.current += 1;
    await refreshSessions(sessionId);
    setArticleInput("");
  }

  async function clearCurrent() {
    if (!selectedSessionId) {
      setArticleInput("");
      setSentences([]);
      return;
    }

    await db.transaction("rw", db.sessions, db.sentences, async () => {
      await db.sentences.where("sessionId").equals(selectedSessionId).delete();
      await db.sessions.delete(selectedSessionId);
    });

    setArticleInput("");
    await refreshSessions(null);
  }

  function updateSentenceText(id: number, translation: string) {
    if (timersRef.current[id]) {
      clearTimeout(timersRef.current[id]);
      delete timersRef.current[id];
    }

    setSentences((prev) =>
      prev.map((sentence) =>
        sentence.id === id ? { ...sentence, translation } : sentence,
      ),
    );
  }

  function cancelPendingScore(id: number) {
    if (timersRef.current[id]) {
      clearTimeout(timersRef.current[id]);
      delete timersRef.current[id];
    }
  }

  async function requestGrade(id: number) {
    const target = sentences.find((item) => item.id === id);

    if (!target || !target.translation.trim() || !selectedSessionId) {
      return;
    }

    setSentences((prev) =>
      prev.map((sentence) =>
        sentence.id === id ? { ...sentence, loading: true } : sentence,
      ),
    );

    try {
      const response = await fetch("/api/grade", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          original: target.original,
          translation: target.translation,
          apiKey: settings.apiKey,
          apiBase: settings.apiBase,
          model: settings.model,
        }),
      });

      const result = (await response.json()) as {
        score?: number;
        feedback?: string;
        error?: string;
      };
      if (!response.ok || typeof result.score !== "number") {
        throw new Error(result.error ?? "评分失败");
      }

      setSentences((prev) =>
        prev.map((sentence) =>
          sentence.id === id
            ? {
                ...sentence,
                score: result.score ?? null,
                feedback: result.feedback ?? "",
                loading: false,
                savedTranslation: sentence.translation,
              }
            : sentence,
        ),
      );

      await db.sentences.update(id, {
        translation: target.translation,
        score: result.score,
        feedback: result.feedback ?? "",
      });

      const next = sentences.map((item) =>
        item.id === id
          ? {
              ...item,
              translation: target.translation,
              score: result.score ?? null,
              feedback: result.feedback ?? "",
              loading: false,
              savedTranslation: target.translation,
            }
          : item,
      );

      await syncSessionScore(selectedSessionId, next);
    } catch (error) {
      setSentences((prev) =>
        prev.map((sentence) =>
          sentence.id === id
            ? {
                ...sentence,
                loading: false,
                feedback: error instanceof Error ? error.message : "评分失败",
              }
            : sentence,
        ),
      );
    }
  }

  function scheduleScoring(id: number) {
    const target = sentences.find((item) => item.id === id);
    if (!target || target.translation === target.savedTranslation) {
      return;
    }

    cancelPendingScore(id);
    timersRef.current[id] = setTimeout(() => {
      delete timersRef.current[id];
      void requestGrade(id);
    }, AUTO_GRADE_DELAY_MS);
  }

  async function probeModels() {
    if (!settings.apiKey.trim()) {
      return;
    }

    setProbing(true);
    try {
      const response = await fetch("/api/models", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          apiKey: settings.apiKey,
          apiBase: settings.apiBase,
        }),
      });

      const result = (await response.json()) as { models?: string[] };
      if (!response.ok || !Array.isArray(result.models)) {
        throw new Error("模型探测失败");
      }

      const sorted = [...result.models].sort((a, b) => a.localeCompare(b));
      setModels(sorted);
      if (sorted.length > 0 && !sorted.includes(settings.model)) {
        setSettings((prev) => ({ ...prev, model: sorted[0] }));
      }
    } finally {
      setProbing(false);
    }
  }

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <Sidebar className="fixed inset-y-0 left-0 z-20 hidden md:flex">
        <SidebarHeader>
          <h2 className="text-lg font-semibold">PolyglotTest</h2>
          <p className="text-sm text-muted-foreground">会话历史</p>
        </SidebarHeader>
        <SidebarContent>
          <div className="space-y-2">
            {sessions.map((session) => (
              <button
                key={session.id}
                type="button"
                onClick={() => session.id && void refreshSessions(session.id)}
                className={cn(
                  "w-full rounded-md border p-2 text-left text-sm",
                  selectedSessionId === session.id
                    ? "border-foreground bg-background"
                    : "border-border bg-background/50",
                )}
              >
                <p className="truncate font-medium">{session.title}</p>
                <p className={cn("text-xs", scoreColor(session.totalScore))}>
                  {session.totalScore === null
                    ? "未评分"
                    : `加权分: ${session.totalScore}`}
                </p>
              </button>
            ))}
          </div>
        </SidebarContent>
        <SidebarFooter>
          <section className="space-y-2">
            <h3 className="font-medium">设置</h3>
            <Input
              placeholder="OpenAI API Key"
              type="password"
              value={settings.apiKey}
              onChange={(event) =>
                setSettings((prev) => ({ ...prev, apiKey: event.target.value }))
              }
            />
            <Input
              placeholder="https://api.openai.com/v1"
              value={settings.apiBase}
              onChange={(event) =>
                setSettings((prev) => ({
                  ...prev,
                  apiBase: event.target.value,
                }))
              }
            />
            <div className="flex gap-2">
              <select
                className="h-9 flex-1 rounded-md border border-border bg-background px-3 text-sm"
                value={settings.model}
                onChange={(event) =>
                  setSettings((prev) => ({
                    ...prev,
                    model: event.target.value,
                  }))
                }
              >
                {models.map((model) => (
                  <option key={model} value={model}>
                    {model}
                  </option>
                ))}
              </select>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void probeModels()}
                disabled={probing}
              >
                {probing ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4" />
                )}
              </Button>
            </div>
          </section>
          <section className="space-y-1 text-sm">
            <h3 className="font-medium">统计</h3>
            <p className={cn("font-semibold", scoreColor(currentScore))}>
              当前会话: {currentScore === null ? "未评分" : currentScore}
            </p>
            <div className="max-h-28 space-y-1 overflow-y-auto pr-1 text-xs text-muted-foreground">
              {sessions.map((session) => (
                <p key={session.id}>
                  {session.title}:{" "}
                  {session.totalScore === null ? "未评分" : session.totalScore}
                </p>
              ))}
            </div>
          </section>
        </SidebarFooter>
      </Sidebar>

      <SidebarInset className="w-full md:ml-80">
        <header className="sticky top-0 z-10 border-b border-border bg-background/95 px-4 py-3 backdrop-blur md:px-8">
          <p className={cn("text-sm font-semibold", scoreColor(currentScore))}>
            当前文章加权总分：{currentScore === null ? "未评分" : currentScore}
          </p>
        </header>

        <div className="space-y-6 p-4 pb-28 md:p-8">
          <section className="space-y-3 rounded-lg border border-border p-4">
            <Textarea
              value={articleInput}
              onChange={(event) => setArticleInput(event.target.value)}
              className="min-h-36"
              placeholder="粘贴需要练习翻译的文章，然后点击处理文章。"
            />
            <div className="flex gap-2">
              <Button type="button" onClick={() => void processArticle()}>
                处理文章 (Process)
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => void clearCurrent()}
              >
                清空 (Clear)
              </Button>
            </div>
          </section>

          <section className="space-y-3">
            {sentences.map((sentence, index) => (
              <article
                key={`${refreshKeyRef.current}-${sentence.id}`}
                className="grid gap-3 rounded-lg border border-border p-4 lg:grid-cols-[1fr_220px]"
              >
                <div className="space-y-2">
                  <p className="text-sm font-medium">
                    {index + 1}. {sentence.original}
                  </p>
                  <Input
                    value={sentence.translation}
                    onChange={(event) =>
                      updateSentenceText(sentence.id, event.target.value)
                    }
                    onBlur={() => scheduleScoring(sentence.id)}
                    onFocus={() => cancelPendingScore(sentence.id)}
                    placeholder="输入你的翻译，失焦后 5 秒自动评分"
                  />
                </div>
                <div className="space-y-1 border-l border-border pl-3 text-sm">
                  <p
                    className={cn(
                      "font-semibold",
                      sentence.loading && "animate-pulse",
                      scoreColor(sentence.score),
                    )}
                  >
                    分值: {sentence.score ?? "--"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {sentence.feedback || "等待评分"}
                  </p>
                </div>
              </article>
            ))}
          </section>
        </div>

        <footer className="fixed inset-x-0 bottom-0 z-10 border-t border-border bg-background/95 px-4 py-3 backdrop-blur md:left-80 md:px-8">
          <div className="mx-auto flex w-full max-w-6xl items-center justify-between">
            <p
              className={cn("text-sm font-semibold", scoreColor(currentScore))}
            >
              当前文章加权总分：
              {currentScore === null ? "未评分" : currentScore}
            </p>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
            >
              <ArrowUp className="h-4 w-4" /> 回到顶部
            </Button>
          </div>
        </footer>
      </SidebarInset>
    </div>
  );
}
