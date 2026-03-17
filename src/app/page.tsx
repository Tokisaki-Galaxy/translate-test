"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AnimatePresence,
  motion,
  useMotionValue,
  useTransform,
  animate,
} from "framer-motion";
import {
  ArrowUp,
  Loader2,
  Pencil,
  Plus,
  Settings as SettingsIcon,
  Trash2,
  Volume2,
} from "lucide-react";

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
import { SettingsDialog, type Settings } from "@/components/SettingsDialog";
import { type Sentence, type Session, db } from "@/lib/db";
import {
  computeWeightedScore,
  measureSentenceLength,
  scoreColor,
  segmentSentences,
} from "@/lib/polyglot";
import { isTTSSupported, useTTS } from "@/lib/useTTS";
import { cn } from "@/lib/utils";

type SentenceState = Sentence & {
  id: number;
  loading: boolean;
  savedTranslation: string;
};

const SETTINGS_KEY = "polyglot_settings";
const SESSION_TITLE_MAX_CHARS = 24;
const AUTO_GRADE_DELAY_MS = 5000;

const defaultSettings: Settings = {
  apiKey: "",
  apiBase: "https://api.openai.com/v1",
  model: "gpt-4o-mini",
  ttsEnabled: true,
  ttsVoiceURI: "",
  ttsRate: 1.0,
};

// Animated score number that rolls up/down to the target value
function AnimatedScore({ score }: { score: number | null }) {
  // Initialize with the actual score so there's no roll-up from zero on first render
  const motionVal = useMotionValue(score ?? 0);
  const rounded = useTransform(motionVal, (v) => v.toFixed(2));

  useEffect(() => {
    if (score === null) {
      motionVal.set(0);
      return;
    }
    const controls = animate(motionVal, score, {
      duration: 0.6,
      ease: "easeOut",
    });
    return controls.stop;
  }, [score, motionVal]);

  if (score === null) return <motion.span>--</motion.span>;
  return <motion.span>{rounded}</motion.span>;
}

export default function Home() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<number | null>(
    null,
  );
  const [sentences, setSentences] = useState<SentenceState[]>([]);
  const [articleInput, setArticleInput] = useState("");
  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const [models, setModels] = useState<string[]>(["gpt-4o-mini"]);
  // "edit" = textarea visible, "test" = sentence cards visible
  const [mode, setMode] = useState<"edit" | "test">("edit");
  // Global weighted average from all sessions
  const [globalScore, setGlobalScore] = useState<number | null>(null);
  // Which session title is being edited
  const [editingTitleId, setEditingTitleId] = useState<number | null>(null);
  const [editingTitleValue, setEditingTitleValue] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);

  const timersRef = useRef<Record<number, ReturnType<typeof setTimeout>>>({});
  const refreshKeyRef = useRef(0);
  const selectedSessionIdRef = useRef<number | null>(null);

  const { playingId, speak } = useTTS(
    settings.ttsVoiceURI,
    settings.ttsRate,
  );

  useEffect(() => {
    selectedSessionIdRef.current = selectedSessionId;
  }, [selectedSessionId]);

  // Compute global weighted average from all sentences in IndexedDB
  const refreshGlobalScore = useCallback(async () => {
    const allSentences = await db.sentences.toArray();
    const result = computeWeightedScore(allSentences);
    setGlobalScore(result);
  }, []);

  const refreshSessions = useCallback(
    async (preferredSessionId?: number | null) => {
      const sessionList = await db.sessions
        .orderBy("createdAt")
        .reverse()
        .toArray();
      setSessions(sessionList);

      const targetId =
        preferredSessionId ??
        selectedSessionIdRef.current ??
        sessionList[0]?.id ??
        null;
      if (!targetId) {
        setSelectedSessionId(null);
        setSentences([]);
        setMode("edit");
        await refreshGlobalScore();
        return;
      }

      setSelectedSessionId(targetId);
      const sentenceList = await db.sentences
        .where("sessionId")
        .equals(targetId)
        .toArray();
      const mapped = sentenceList
        .filter(
          (sentence): sentence is Sentence & { id: number } =>
            typeof sentence.id === "number",
        )
        .map((sentence) => ({
          ...sentence,
          loading: false,
          savedTranslation: sentence.translation,
        }));
      setSentences(mapped);
      if (mapped.length > 0) {
        setMode("test");
      }
      await refreshGlobalScore();
    },
    [refreshGlobalScore],
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

  // "New Test": reset to edit mode
  function startNewTest() {
    setArticleInput("");
    setSentences([]);
    setSelectedSessionId(null);
    setMode("edit");
  }

  async function deleteSession(id: number) {
    await db.transaction("rw", db.sessions, db.sentences, async () => {
      await db.sentences.where("sessionId").equals(id).delete();
      await db.sessions.delete(id);
    });

    const wasSelected = selectedSessionIdRef.current === id;
    await refreshSessions(wasSelected ? null : undefined);
    if (wasSelected) {
      setMode("edit");
    }
  }

  async function saveTitle(id: number, title: string) {
    const trimmed = title.trim();
    if (trimmed) {
      await db.sessions.update(id, { title: trimmed });
      await refreshSessions(id);
    }
    setEditingTitleId(null);
    setEditingTitleValue("");
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

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      {/* ── Left Sidebar ── */}
      <Sidebar className="fixed inset-y-0 left-0 z-20 hidden md:flex">
        <SidebarHeader>
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold tracking-tight">
                PolyglotTest
              </h2>
              <p className="text-xs text-muted-foreground">会话历史</p>
            </div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-8 gap-1 rounded-lg text-xs"
              onClick={startNewTest}
              title="新测试"
            >
              <Plus className="h-3.5 w-3.5" />
              新测试
            </Button>
          </div>
        </SidebarHeader>

        <SidebarContent>
          <div className="space-y-1">
            {sessions.map((session) => (
              <div
                key={session.id}
                className={cn(
                  "group relative flex items-start rounded-lg border p-2.5 text-left text-sm transition-colors",
                  selectedSessionId === session.id
                    ? "border-primary/30 bg-primary/5"
                    : "border-transparent hover:border-border hover:bg-muted/50",
                )}
              >
                <button
                  type="button"
                  className="min-w-0 flex-1 text-left"
                  onClick={() => session.id && void refreshSessions(session.id)}
                >
                  {editingTitleId === session.id ? (
                    <Input
                      autoFocus
                      value={editingTitleValue}
                      onChange={(e) => setEditingTitleValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && session.id) {
                          void saveTitle(session.id, editingTitleValue);
                        } else if (e.key === "Escape") {
                          setEditingTitleId(null);
                        }
                      }}
                      onBlur={() => {
                        if (session.id) {
                          void saveTitle(session.id, editingTitleValue);
                        }
                      }}
                      onClick={(e) => e.stopPropagation()}
                      className="h-6 px-1 text-xs"
                    />
                  ) : (
                    <p className="truncate font-medium leading-snug">
                      {session.title}
                    </p>
                  )}
                  <p className={cn("text-xs", scoreColor(session.totalScore))}>
                    {session.totalScore === null
                      ? "未评分"
                      : `加权分: ${session.totalScore}`}
                  </p>
                </button>

                {/* Hover actions */}
                <div className="ml-1 flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                  <button
                    type="button"
                    className="rounded p-1 text-muted-foreground hover:text-foreground"
                    title="编辑标题"
                    onClick={(e) => {
                      e.stopPropagation();
                      setEditingTitleId(session.id ?? null);
                      setEditingTitleValue(session.title);
                    }}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    className="rounded p-1 text-muted-foreground hover:text-red-500"
                    title="删除"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (session.id) void deleteSession(session.id);
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </SidebarContent>

        <SidebarFooter>
          {/* Statistics Dashboard */}
          <section className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              统计面板
            </h3>
            <div className="rounded-lg border border-border bg-card p-3 shadow-sm">
              <div className="space-y-2 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">
                    当前会话
                  </span>
                  <span
                    className={cn(
                      "font-semibold tabular-nums",
                      scoreColor(currentScore),
                    )}
                  >
                    <AnimatedScore score={currentScore} />
                  </span>
                </div>
                <div className="h-px bg-border" />
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">
                    全局表现
                  </span>
                  <span
                    className={cn(
                      "font-semibold tabular-nums",
                      scoreColor(globalScore),
                    )}
                  >
                    <AnimatedScore score={globalScore} />
                  </span>
                </div>
              </div>
            </div>
          </section>

          {/* Settings Button */}
          <Button
            type="button"
            variant="outline"
            className="w-full gap-2"
            onClick={() => setSettingsOpen(true)}
          >
            <SettingsIcon className="h-4 w-4" />
            设置
          </Button>
        </SidebarFooter>
      </Sidebar>

      {/* ── Settings Dialog ── */}
      <SettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        settings={settings}
        onSettingsChange={setSettings}
        models={models}
        onModelsChange={setModels}
        onSessionsRefresh={() => refreshSessions()}
        SETTINGS_KEY={SETTINGS_KEY}
      />

      {/* ── Main Content ── */}
      <SidebarInset className="w-full md:ml-80">
        <header className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-background/80 px-4 py-3 backdrop-blur md:px-8">
          <p className={cn("text-sm font-semibold", scoreColor(currentScore))}>
            当前文章加权总分：
            <AnimatedScore score={currentScore} />
          </p>
          <div className="flex items-center gap-2">
            {mode === "test" && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="gap-1"
                onClick={startNewTest}
              >
                <Plus className="h-4 w-4" />
                新测试
              </Button>
            )}
          </div>
        </header>

        <div className="p-4 pb-28 md:p-8">
          <AnimatePresence mode="wait">
            {mode === "edit" ? (
              <motion.section
                key="editor"
                initial={{ opacity: 0, scale: 0.97 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                transition={{ duration: 0.25 }}
                className="mx-auto max-w-2xl space-y-4 rounded-xl border border-border bg-card p-6 shadow-sm"
              >
                <div>
                  <h3 className="text-base font-semibold">粘贴文章</h3>
                  <p className="text-sm text-muted-foreground">
                    粘贴需要练习翻译的文章，然后点击处理文章。
                  </p>
                </div>
                <Textarea
                  value={articleInput}
                  onChange={(event) => setArticleInput(event.target.value)}
                  className="min-h-48 resize-none text-sm leading-relaxed"
                  placeholder="在此粘贴文章内容…"
                />
                <Button
                  type="button"
                  className="w-full bg-primary text-primary-foreground hover:bg-primary/90"
                  onClick={() => void processArticle()}
                >
                  开始处理
                </Button>
              </motion.section>
            ) : (
              <motion.section
                key="sentences"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.25 }}
                className="space-y-3"
              >
                {sentences.map((sentence, index) => (
                  <motion.article
                    key={`${refreshKeyRef.current}-${sentence.id}`}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{
                      delay: Math.min(index * 0.04, 0.4),
                      duration: 0.2,
                    }}
                    className="grid gap-3 rounded-xl border border-border bg-card p-4 shadow-sm lg:grid-cols-[1fr_220px]"
                  >
                    <div className="space-y-2">
                      {(() => {
                        const sentenceLabel = `${index + 1}. ${sentence.original}`;
                        return (
                          <div className="flex items-start gap-2">
                            <p className="flex-1 text-sm font-medium leading-relaxed">
                              {sentenceLabel}
                            </p>
                            {settings.ttsEnabled && isTTSSupported() && (
                              <button
                                type="button"
                                title="朗读原文"
                                aria-label="朗读原文"
                                onClick={() => speak(sentence.id, sentenceLabel)}
                                className={cn(
                                  "mt-0.5 shrink-0 rounded p-1 transition-colors",
                                  playingId === sentence.id
                                    ? "text-primary"
                                    : "text-muted-foreground hover:text-foreground",
                                )}
                              >
                                <Volume2
                                  className={cn(
                                    "h-4 w-4",
                                    playingId === sentence.id && "animate-pulse",
                                  )}
                                />
                              </button>
                            )}
                          </div>
                        );
                      })()}
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
                          "font-semibold tabular-nums",
                          sentence.loading && "animate-pulse",
                          scoreColor(sentence.score),
                        )}
                      >
                        分值:{" "}
                        {sentence.loading ? (
                          <Loader2 className="inline h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <AnimatedScore score={sentence.score} />
                        )}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {sentence.feedback || "等待评分"}
                      </p>
                    </div>
                  </motion.article>
                ))}
              </motion.section>
            )}
          </AnimatePresence>
        </div>

        <footer className="fixed inset-x-0 bottom-0 z-10 border-t border-border bg-background/80 px-4 py-3 backdrop-blur md:left-80 md:px-8">
          <div className="mx-auto flex w-full max-w-6xl items-center justify-between">
            <p
              className={cn(
                "text-sm font-semibold tabular-nums",
                scoreColor(currentScore),
              )}
            >
              当前文章加权总分：
              <AnimatedScore score={currentScore} />
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
