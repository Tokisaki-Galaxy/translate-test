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
  Github,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Settings as SettingsIcon,
  Star,
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
import { FavoritesSheet } from "@/components/FavoritesSheet";
import { type Favorite, type Sentence, type Session, db } from "@/lib/db";
import {
  computeWeightedScore,
  measureSentenceLength,
  scoreColor,
  segmentSentences,
} from "@/lib/polyglot";
import { isTTSSupported, useTTS } from "@/lib/useTTS";
import { parseAndValidateResponse } from "@/lib/grading";
import {
  createTranslator,
  detectLocaleFromNavigator,
  isLocale,
  type Locale,
} from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

type SentenceState = Sentence & {
  id: number;
  loading: boolean;
  loadingStatus: string;
  gradeFailed: boolean;
  savedTranslation: string;
};

const SETTINGS_KEY = "polyglot_settings";
const LOCALE_KEY = "polyglot_locale";
const SESSION_TITLE_MAX_CHARS = 24;
const AUTO_GRADE_DELAY_MS = 5000;
const MAX_RETRIES = 2;
const REPO_URL = "https://github.com/Tokisaki-Galaxy/Sentens";

const defaultSettings: Settings = {
  apiKey: "",
  apiBase: "https://api.openai.com/v1",
  model: "gpt-4o-mini",
  level: "",
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
  const [locale, setLocale] = useState<Locale>("zh");
  const [showScrollButton, setShowScrollButton] = useState(false);
  const [favoritesOpen, setFavoritesOpen] = useState(false);
  const [favorites, setFavorites] = useState<Favorite[]>([]);
  // Set of sentence IDs that are currently favorited
  const [favoritedIds, setFavoritedIds] = useState<Set<number>>(new Set());

  const timersRef = useRef<Record<number, ReturnType<typeof setTimeout>>>({});
  const refreshKeyRef = useRef(0);
  const selectedSessionIdRef = useRef<number | null>(null);

  const { playingId, speak } = useTTS(settings.ttsVoiceURI, settings.ttsRate);
  const t = useMemo(() => createTranslator(locale), [locale]);

  useEffect(() => {
    selectedSessionIdRef.current = selectedSessionId;
  }, [selectedSessionId]);

  useEffect(() => {
    let rafId: number | null = null;
    const handleScroll = () => {
      if (rafId !== null) return;
      rafId = requestAnimationFrame(() => {
        setShowScrollButton(window.scrollY > 300);
        rafId = null;
      });
    };
    window.addEventListener("scroll", handleScroll, { passive: true });
    handleScroll();
    return () => {
      window.removeEventListener("scroll", handleScroll);
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, []);

  // Compute global weighted average from all sentences in IndexedDB
  const refreshGlobalScore = useCallback(async () => {
    const allSentences = await db.sentences.toArray();
    const result = computeWeightedScore(allSentences);
    setGlobalScore(result);
  }, []);

  const refreshFavorites = useCallback(async () => {
    // Use reverse primary key order (auto-increment id = insertion order)
    const favList = await db.favorites.orderBy(":id").reverse().toArray();
    setFavorites(favList);
    setFavoritedIds(new Set(favList.map((f) => f.sentenceId)));
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
          loadingStatus: "",
          gradeFailed: false,
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
    void refreshFavorites();

    const cachedLocale = window.localStorage.getItem(LOCALE_KEY);
    if (isLocale(cachedLocale)) {
      setLocale(cachedLocale);
    } else {
      setLocale(detectLocaleFromNavigator());
    }
  }, [refreshSessions, refreshFavorites]);

  useEffect(() => {
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  }, [settings]);

  useEffect(() => {
    window.localStorage.setItem(LOCALE_KEY, locale);
    document.documentElement.lang = locale;
  }, [locale]);

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
      `${t("newTest")} ${new Date(createdAt).toLocaleString()}`;
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

    // Save translation to database immediately
    void db.sentences.update(id, { translation });
  }

  function cancelPendingScore(id: number) {
    if (timersRef.current[id]) {
      clearTimeout(timersRef.current[id]);
      delete timersRef.current[id];
    }
  }

  async function requestGradingWithRetry(id: number, retryCount = 0) {
    const sessionId = selectedSessionId;
    const target = sentences.find((item) => item.id === id);

    if (!target || !target.translation.trim() || !sessionId) {
      return;
    }

    const statusMessage =
      retryCount === 0
        ? t("gradingInProgress")
        : t("retryingGrade", {
            retry: retryCount,
            max: MAX_RETRIES,
          });

    setSentences((prev) =>
      prev.map((s) =>
        s.id === id
          ? {
              ...s,
              loading: true,
              loadingStatus: statusMessage,
              gradeFailed: false,
            }
          : s,
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
          level: settings.level,
        }),
      });

      const rawData = (await response.json()) as unknown;

      if (!response.ok) {
        const err = rawData as { error?: string };
        throw new Error(err.error ?? t("gradingFailed"));
      }

      const result = parseAndValidateResponse(rawData);

      setSentences((prev) =>
        prev.map((s) =>
          s.id === id
            ? {
                ...s,
                referenceTranslation: result.referenceTranslation,
                score: result.score,
                feedback: result.feedback,
                loading: false,
                loadingStatus: "",
                gradeFailed: false,
                savedTranslation: target.translation,
              }
            : s,
        ),
      );

      await db.sentences.update(id, {
        translation: target.translation,
        referenceTranslation: result.referenceTranslation,
        score: result.score,
        feedback: result.feedback,
      });

      // If this sentence is favorited, sync the new score/feedback to favorites
      const favRecord = await db.favorites
        .where("sentenceId")
        .equals(id)
        .first();
      if (favRecord?.id !== undefined) {
        await db.favorites.update(favRecord.id, {
          score: result.score ?? null,
          feedback: result.feedback ?? "",
          translation: target.translation,
          referenceTranslation: result.referenceTranslation,
        });
        await refreshFavorites();
      }

      const next = sentences.map((item) =>
        item.id === id
          ? {
              ...item,
              translation: target.translation,
              referenceTranslation: result.referenceTranslation,
              score: result.score,
              feedback: result.feedback,
              loading: false,
              loadingStatus: "",
              gradeFailed: false,
              savedTranslation: target.translation,
            }
          : item,
      );

      await syncSessionScore(sessionId, next);
    } catch (error) {
      if (retryCount < MAX_RETRIES) {
        console.warn(
          t("retryingGrade", {
            retry: retryCount + 1,
            max: MAX_RETRIES,
          }),
          error,
        );
        return requestGradingWithRetry(id, retryCount + 1);
      }

      setSentences((prev) =>
        prev.map((s) =>
          s.id === id
            ? {
                ...s,
                loading: false,
                loadingStatus: "",
                gradeFailed: true,
                feedback:
                  error instanceof Error ? error.message : t("gradingFailed"),
              }
            : s,
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
      void requestGradingWithRetry(id);
    }, AUTO_GRADE_DELAY_MS);
  }

  async function toggleFavorite(sentence: SentenceState) {
    if (favoritedIds.has(sentence.id)) {
      // Un-favorite: find and delete the record
      const favRecord = await db.favorites
        .where("sentenceId")
        .equals(sentence.id)
        .first();
      if (favRecord?.id !== undefined) {
        await db.favorites.delete(favRecord.id);
      }
    } else {
      if (!sentence.translation.trim()) {
        toast(t("favoriteNeedTranslation"), { duration: 3000 });
        return;
      }
      // Add to favorites
      await db.favorites.add({
        sentenceId: sentence.id,
        sessionId: selectedSessionId!,
        original: sentence.original,
        translation: sentence.translation,
        referenceTranslation: sentence.referenceTranslation,
        score: sentence.score,
        feedback: sentence.feedback,
        createdAt: Date.now(),
      });
    }
    await refreshFavorites();
  }

  async function unfavorite(favoriteId: number) {
    await db.favorites.delete(favoriteId);
    await refreshFavorites();
  }

  async function clearAllFavorites() {
    await db.favorites.clear();
    await refreshFavorites();
  }

  function navigateToSentence(sessionId: number, sentenceId: number) {
    void refreshSessions(sessionId).then(() => {
      // Wait for the DOM to update then scroll to the sentence
      setTimeout(() => {
        const el = document.querySelector<HTMLElement>(
          `[data-sentence-id="${sentenceId}"]`,
        );
        el?.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 300);
    });
  }

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      {/* ── Left Sidebar ── */}
      <Sidebar className="fixed inset-y-0 left-0 z-20 hidden md:flex">
        <SidebarHeader>
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold tracking-tight">
                {t("appName")}
              </h2>
              <p className="text-xs text-muted-foreground">
                {t("sessionHistory")}
              </p>
            </div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-8 gap-1 rounded-lg text-xs"
              onClick={startNewTest}
              title={t("newTest")}
            >
              <Plus className="h-3.5 w-3.5" />
              {t("newTest")}
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
                      ? t("ungraded")
                      : t("weightedScore", { score: session.totalScore })}
                  </p>
                </button>

                {/* Hover actions */}
                <div className="ml-1 flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                  <button
                    type="button"
                    className="rounded p-1 text-muted-foreground hover:text-foreground"
                    title={t("editTitle")}
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
                    title={t("delete")}
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
              {t("statisticsPanel")}
            </h3>
            <div className="rounded-lg border border-border bg-card p-3 shadow-sm">
              <div className="space-y-2 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">
                    {t("currentSession")}
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
                    {t("globalPerformance")}
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

          {/* Settings and Favorites Buttons */}
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              className="flex-1 gap-2"
              onClick={() => setSettingsOpen(true)}
            >
              <SettingsIcon className="h-4 w-4" />
              {t("settings")}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="gap-2 px-3"
              onClick={() => setFavoritesOpen(true)}
              title={t("favorites")}
            >
              <Star
                className={cn(
                  "h-4 w-4",
                  favorites.length > 0 && "fill-yellow-400 text-yellow-400",
                )}
              />
            </Button>
          </div>
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
        locale={locale}
        onLocaleChange={setLocale}
        t={t}
      />

      {/* ── Favorites Sheet ── */}
      <FavoritesSheet
        open={favoritesOpen}
        onOpenChange={setFavoritesOpen}
        favorites={favorites}
        onUnfavorite={unfavorite}
        onClearAll={clearAllFavorites}
        onNavigate={navigateToSentence}
        t={t}
      />

      {/* ── Main Content ── */}
      <SidebarInset className="w-full md:ml-80">
        <header className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-background/80 px-4 py-3 backdrop-blur md:px-8">
          <p className={cn("text-sm font-semibold", scoreColor(currentScore))}>
            {t("currentArticleScore")}
            <AnimatedScore score={currentScore} />
          </p>
          <div className="flex items-center gap-2">
            <Button
              asChild
              type="button"
              size="sm"
              variant="outline"
              className="gap-1"
            >
              <a href={REPO_URL} target="_blank" rel="noreferrer">
                <Github className="h-4 w-4" />
                GitHub
              </a>
            </Button>
            {mode === "test" && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="gap-1"
                onClick={startNewTest}
              >
                <Plus className="h-4 w-4" />
                {t("newTest")}
              </Button>
            )}
          </div>
        </header>

        <div className="p-4 md:p-8">
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
                  <h3 className="text-base font-semibold">
                    {t("pasteArticle")}
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    {t("pasteArticleDesc")}
                  </p>
                </div>
                <div className="rounded-lg border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
                  <p className="font-medium text-foreground">
                    {t("guideTitle")}
                  </p>
                  <ul className="mt-1 list-disc space-y-1 pl-4">
                    <li>{t("guideStep1")}</li>
                    <li>{t("guideStep2")}</li>
                    <li>{t("guideStep3")}</li>
                  </ul>
                </div>
                <Textarea
                  value={articleInput}
                  onChange={(event) => setArticleInput(event.target.value)}
                  className="min-h-48 resize-none text-sm leading-relaxed"
                  placeholder={t("pastePlaceholder")}
                />
                <Button
                  type="button"
                  className="w-full bg-primary text-primary-foreground hover:bg-primary/90"
                  onClick={() => void processArticle()}
                >
                  {t("startProcessing")}
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
                    data-sentence-id={sentence.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{
                      delay: Math.min(index * 0.04, 0.4),
                      duration: 0.2,
                    }}
                    className="relative grid gap-3 rounded-xl border border-border bg-card p-4 shadow-sm lg:grid-cols-[1fr_220px]"
                  >
                    {/* Retry and Star / Favorite buttons */}
                    <div className="absolute right-3 top-3 flex items-center gap-1">
                      <button
                        type="button"
                        title={t("retryManual")}
                        aria-label={t("retryManual")}
                        onClick={() =>
                          void requestGradingWithRetry(sentence.id)
                        }
                        className={cn(
                          "rounded p-1 transition-colors",
                          sentence.gradeFailed
                            ? "text-destructive hover:text-destructive/80"
                            : "text-muted-foreground hover:text-foreground",
                        )}
                      >
                        <RefreshCw className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        title={
                          favoritedIds.has(sentence.id)
                            ? t("favoriteRemoveHint")
                            : t("favoriteAddHint")
                        }
                        aria-label={
                          favoritedIds.has(sentence.id)
                            ? t("favoriteRemoveHint")
                            : t("favoriteAddHint")
                        }
                        onClick={() => void toggleFavorite(sentence)}
                        className={cn(
                          "rounded p-1 transition-colors",
                          favoritedIds.has(sentence.id)
                            ? "text-yellow-400 hover:text-yellow-500"
                            : sentence.translation.trim()
                              ? "text-muted-foreground hover:text-yellow-400"
                              : "opacity-30 text-muted-foreground cursor-not-allowed",
                        )}
                      >
                        <Star
                          className={cn(
                            "h-4 w-4",
                            favoritedIds.has(sentence.id) && "fill-current",
                          )}
                        />
                      </button>
                    </div>

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
                                title={t("readOriginal")}
                                aria-label={t("readOriginal")}
                                onClick={() =>
                                  speak(sentence.id, sentenceLabel)
                                }
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
                                    playingId === sentence.id &&
                                      "animate-pulse",
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
                        placeholder={t("inputTranslationPlaceholder")}
                      />
                      {sentence.referenceTranslation && (
                        <p className="text-xs text-muted-foreground pt-2 border-t border-border">
                          {sentence.referenceTranslation}
                        </p>
                      )}
                    </div>
                    <div className="space-y-1 border-l border-border pl-3 text-sm">
                      <div className="flex items-center justify-between gap-1">
                        <p
                          className={cn(
                            "font-semibold tabular-nums",
                            sentence.loading && "animate-pulse",
                            sentence.gradeFailed
                              ? "text-destructive"
                              : scoreColor(sentence.score),
                          )}
                        >
                          {sentence.gradeFailed ? (
                            t("gradingFailed")
                          ) : (
                            <>
                              {t("scoreLabel")}
                              {sentence.loading ? (
                                <Loader2 className="inline h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <AnimatedScore score={sentence.score} />
                              )}
                            </>
                          )}
                        </p>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {sentence.loading
                          ? sentence.loadingStatus
                          : sentence.feedback || t("waitingForGrade")}
                      </p>
                    </div>
                  </motion.article>
                ))}
              </motion.section>
            )}
          </AnimatePresence>
        </div>

        <button
          type="button"
          aria-hidden={!showScrollButton}
          onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
          className={cn(
            "fixed bottom-6 right-6 z-50 flex items-center gap-1 rounded-md border border-border bg-background/80 px-3 py-1.5 text-sm font-medium shadow-sm backdrop-blur transition-all duration-300",
            showScrollButton
              ? "pointer-events-auto scale-100 opacity-100"
              : "pointer-events-none scale-95 opacity-0",
          )}
        >
          <ArrowUp className="h-4 w-4" /> {t("scrollToTop")}
        </button>
      </SidebarInset>
    </div>
  );
}
