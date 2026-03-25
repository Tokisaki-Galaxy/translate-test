"use client";

import { useEffect, useRef, useState } from "react";
import JSZip from "jszip";
import {
  Download,
  Eye,
  EyeOff,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Upload,
  Volume2,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { type Favorite, type Sentence, type Session, db } from "@/lib/db";
import { type Locale, type Translator } from "@/lib/i18n";
import { cleanTTSText, isTTSSupported } from "@/lib/useTTS";

export type Settings = {
  apiKey: string;
  apiBase: string;
  model: string;
  level: string;
  ttsEnabled: boolean;
  ttsVoiceURI: string;
  ttsRate: number;
};

type SettingsDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  settings: Settings;
  onSettingsChange: (settings: Settings) => void;
  models: string[];
  onModelsChange: (models: string[]) => void;
  onSessionsRefresh: () => Promise<void>;
  SETTINGS_KEY: string;
  locale: Locale;
  onLocaleChange: (locale: Locale) => void;
  t: Translator;
};

type SessionBackup = {
  session: Session;
  sentences: Sentence[];
};

export function SettingsDialog({
  open,
  onOpenChange,
  settings,
  onSettingsChange,
  models,
  onModelsChange,
  onSessionsRefresh,
  SETTINGS_KEY,
  locale,
  onLocaleChange,
  t,
}: SettingsDialogProps) {
  const [showApiKey, setShowApiKey] = useState(false);
  const [probing, setProbing] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const ttsSupported = isTTSSupported();

  useEffect(() => {
    if (!ttsSupported) return;
    function loadVoices() {
      setVoices(window.speechSynthesis.getVoices());
    }
    loadVoices();
    window.speechSynthesis.addEventListener("voiceschanged", loadVoices);
    return () => {
      window.speechSynthesis.removeEventListener("voiceschanged", loadVoices);
    };
  }, [ttsSupported]);

  function previewVoice() {
    if (!ttsSupported) return;
    window.speechSynthesis.cancel();
    const text = cleanTTSText(`1. ${t("previewVoice")}`);
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = settings.ttsRate;
    if (settings.ttsVoiceURI) {
      const voice = voices.find((v) => v.voiceURI === settings.ttsVoiceURI);
      if (voice) utterance.voice = voice;
    }
    window.speechSynthesis.speak(utterance);
  }

  async function probeModels() {
    if (!settings.apiKey.trim()) return;
    setProbing(true);
    try {
      const response = await fetch("/api/models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          apiKey: settings.apiKey,
          apiBase: settings.apiBase,
        }),
      });
      const result = (await response.json()) as {
        models?: string[];
        error?: string;
      };
      if (!response.ok || !Array.isArray(result.models)) {
        throw new Error(
          result.error
            ? `${t("modelProbeFailed")} (${response.status}): ${result.error}`
            : `${t("modelProbeFailed")} (HTTP ${response.status})`,
        );
      }
      const sorted = [...result.models].sort((a, b) => a.localeCompare(b));
      onModelsChange(sorted);
      if (sorted.length > 0 && !sorted.includes(settings.model)) {
        onSettingsChange({ ...settings, model: sorted[0] });
      }
    } finally {
      setProbing(false);
    }
  }

  async function handleExport() {
    setExporting(true);
    try {
      toast(t("backupContainsKey"), {
        icon: <ShieldCheck className="h-4 w-4 text-amber-500" />,
        duration: 5000,
      });

      const zip = new JSZip();

      // File 1: settings.json
      zip.file("settings.json", JSON.stringify(settings, null, 2));

      // File 2+: session_[ID].json for each session
      const sessions = await db.sessions.toArray();
      for (const session of sessions) {
        if (session.id === undefined) continue;
        const sentences = await db.sentences
          .where("sessionId")
          .equals(session.id)
          .toArray();
        const backup: SessionBackup = { session, sentences };
        zip.file(`session_${session.id}.json`, JSON.stringify(backup, null, 2));
      }

      // File: favorites.json
      const favoritesData = await db.favorites.toArray();
      zip.file("favorites.json", JSON.stringify(favoritesData, null, 2));

      const blob = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `polyglot_backup_${Date.now()}.zip`;
      anchor.click();
      URL.revokeObjectURL(url);

      toast.success(t("exportSuccess"));
    } catch (error) {
      toast.error(
        t("exportFailed", {
          message: error instanceof Error ? error.message : t("unknownError"),
        }),
      );
    } finally {
      setExporting(false);
    }
  }

  async function handleImport(file: File) {
    setImporting(true);
    try {
      const zip = await JSZip.loadAsync(file);

      // Restore settings
      const settingsFile = zip.file("settings.json");
      if (settingsFile) {
        const raw = await settingsFile.async("string");
        const imported = JSON.parse(raw) as Partial<Settings>;
        const merged: Settings = {
          apiKey: imported.apiKey ?? settings.apiKey,
          apiBase: imported.apiBase ?? settings.apiBase,
          model: imported.model ?? settings.model,
          level: imported.level ?? settings.level,
          ttsEnabled: imported.ttsEnabled ?? settings.ttsEnabled,
          ttsVoiceURI: imported.ttsVoiceURI ?? settings.ttsVoiceURI,
          ttsRate: imported.ttsRate ?? settings.ttsRate,
        };
        onSettingsChange(merged);
        window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(merged));
        if (merged.model) {
          onModelsChange(Array.from(new Set([...models, merged.model])));
        }
      }

      // Collect existing session titles to handle duplicates
      const existingSessions = await db.sessions.toArray();
      const existingTitles = new Set(existingSessions.map((s) => s.title));

      // Restore sessions
      const sessionFileNames = Object.keys(zip.files).filter(
        (name) => name.startsWith("session_") && name.endsWith(".json"),
      );

      for (const fileName of sessionFileNames) {
        const fileObj = zip.file(fileName);
        if (!fileObj) continue;
        const raw = await fileObj.async("string");
        const { session, sentences } = JSON.parse(raw) as SessionBackup;

        let title = session.title;
        if (existingTitles.has(title)) {
          const base = title;
          let counter = 1;
          do {
            title =
              counter === 1
                ? `${base} (${t("importedSuffix")})`
                : `${base} (${t("importedSuffix")} ${counter})`;
            counter++;
          } while (existingTitles.has(title));
        }
        existingTitles.add(title);

        const newSessionId = (await db.sessions.add({
          title,
          createdAt: Date.now(),
          totalScore: session.totalScore,
        })) as number;

        for (const sentence of sentences) {
          await db.sentences.add({
            sessionId: newSessionId,
            original: sentence.original,
            translation: sentence.translation,
            score: sentence.score,
            feedback: sentence.feedback,
            length: sentence.length,
          });
        }
      }

      // Merge favorites from backup
      const favoritesFile = zip.file("favorites.json");
      if (favoritesFile) {
        const raw = await favoritesFile.async("string");
        const importedFavorites = JSON.parse(raw) as Favorite[];
        const existingFavorites = await db.favorites.toArray();
        const existingSentenceIds = new Set(
          existingFavorites.map((f) => f.sentenceId),
        );
        for (const fav of importedFavorites) {
          if (!existingSentenceIds.has(fav.sentenceId)) {
            await db.favorites.add({
              sentenceId: fav.sentenceId,
              sessionId: fav.sessionId,
              original: fav.original,
              translation: fav.translation,
              score: fav.score,
              feedback: fav.feedback,
              createdAt: fav.createdAt ?? Date.now(),
            });
          }
        }
      }

      await onSessionsRefresh();
      toast.success(t("importSuccess"));
    } catch (error) {
      toast.error(
        t("importFailed", {
          message: error instanceof Error ? error.message : t("unknownError"),
        }),
      );
    } finally {
      setImporting(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("settingsTitle")}</DialogTitle>
          <DialogDescription>{t("settingsDesc")}</DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="preferences" className="mt-2">
          <TabsList className="w-full">
            <TabsTrigger value="preferences" className="flex-1">
              {t("tabPreferences")}
            </TabsTrigger>
            <TabsTrigger value="voice" className="flex-1">
              {t("tabVoice")}
            </TabsTrigger>
            <TabsTrigger value="data" className="flex-1">
              {t("tabData")}
            </TabsTrigger>
          </TabsList>

          {/* ── Preferences Tab ── */}
          <TabsContent value="preferences" className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">{t("language")}</label>
              <select
                className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm"
                value={locale}
                onChange={(e) => onLocaleChange(e.target.value as Locale)}
              >
                <option value="zh">{t("languageZh")}</option>
                <option value="en">{t("languageEn")}</option>
                <option value="ja">{t("languageJa")}</option>
              </select>
              <p className="text-xs text-muted-foreground">
                {t("languageAutoHint")}
              </p>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">{t("apiKey")}</label>
              <div className="relative">
                <Input
                  type={showApiKey ? "text" : "password"}
                  placeholder={t("apiKeyPlaceholder")}
                  value={settings.apiKey}
                  onChange={(e) =>
                    onSettingsChange({ ...settings, apiKey: e.target.value })
                  }
                  className="pr-10"
                />
                <button
                  type="button"
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  onClick={() => setShowApiKey((v) => !v)}
                  aria-label={showApiKey ? t("hideApiKey") : t("showApiKey")}
                >
                  {showApiKey ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">{t("apiBaseUrl")}</label>
              <Input
                placeholder="https://api.openai.com/v1"
                value={settings.apiBase}
                onChange={(e) =>
                  onSettingsChange({ ...settings, apiBase: e.target.value })
                }
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">{t("model")}</label>
              <div className="flex gap-2">
                <select
                  className="h-9 flex-1 rounded-md border border-border bg-background px-3 text-sm"
                  value={settings.model}
                  onChange={(e) =>
                    onSettingsChange({ ...settings, model: e.target.value })
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
                  title={t("probeModels")}
                >
                  {probing ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <RefreshCw className="h-4 w-4" />
                  )}
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">{t("level")}</label>
              <select
                className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm"
                value={settings.level}
                onChange={(e) =>
                  onSettingsChange({ ...settings, level: e.target.value })
                }
              >
                <option value="">{t("levelAuto")}</option>
                <option value="standard">{t("levelStandard")}</option>
                <option value="academic">{t("levelAcademic")}</option>
                <option value="professional">{t("levelProfessional")}</option>
              </select>
              <p className="text-xs text-muted-foreground">{t("levelHint")}</p>
            </div>
          </TabsContent>

          {/* ── Voice / TTS Tab ── */}
          <TabsContent value="voice" className="space-y-4">
            {!ttsSupported ? (
              <p className="text-sm text-muted-foreground">
                {t("ttsUnsupported")}
              </p>
            ) : (
              <>
                {/* TTS Enable toggle */}
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium">
                    {t("ttsEnabled")}
                  </label>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={settings.ttsEnabled}
                    onClick={() =>
                      onSettingsChange({
                        ...settings,
                        ttsEnabled: !settings.ttsEnabled,
                      })
                    }
                    className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                      settings.ttsEnabled ? "bg-primary" : "bg-input"
                    }`}
                  >
                    <span
                      className={`pointer-events-none block h-5 w-5 rounded-full bg-background shadow-lg ring-0 transition-transform ${
                        settings.ttsEnabled ? "translate-x-5" : "translate-x-0"
                      }`}
                    />
                  </button>
                </div>

                {/* Voice selector */}
                <div className="space-y-2">
                  <label className="text-sm font-medium">
                    {t("voiceSource")}
                  </label>
                  <div className="flex gap-2">
                    <select
                      className="h-9 flex-1 rounded-md border border-border bg-background px-3 text-sm"
                      value={settings.ttsVoiceURI}
                      onChange={(e) =>
                        onSettingsChange({
                          ...settings,
                          ttsVoiceURI: e.target.value,
                        })
                      }
                      disabled={!settings.ttsEnabled}
                    >
                      <option value="">{t("defaultVoice")}</option>
                      {voices.map((voice) => (
                        <option key={voice.voiceURI} value={voice.voiceURI}>
                          {voice.name} ({voice.lang})
                        </option>
                      ))}
                    </select>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={previewVoice}
                      disabled={!settings.ttsEnabled}
                      title={t("previewVoice")}
                    >
                      <Volume2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>

                {/* Speech rate slider */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-sm font-medium">
                      {t("speechRate")}
                    </label>
                    <span className="text-sm tabular-nums text-muted-foreground">
                      {settings.ttsRate.toFixed(1)}x
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0.5}
                    max={2.0}
                    step={0.1}
                    value={settings.ttsRate}
                    onChange={(e) =>
                      onSettingsChange({
                        ...settings,
                        ttsRate: parseFloat(e.target.value),
                      })
                    }
                    disabled={!settings.ttsEnabled}
                    className="w-full accent-primary disabled:opacity-50"
                  />
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>0.5x</span>
                    <span>2.0x</span>
                  </div>
                </div>
              </>
            )}
          </TabsContent>

          {/* ── Data Management Tab ── */}
          <TabsContent value="data" className="space-y-4">
            <p className="text-sm text-muted-foreground">{t("backupDesc")}</p>

            <div className="space-y-3">
              <Button
                type="button"
                className="w-full gap-2"
                onClick={() => void handleExport()}
                disabled={exporting}
              >
                {exporting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Download className="h-4 w-4" />
                )}
                {t("exportBackup")}
              </Button>

              <Button
                type="button"
                variant="outline"
                className="w-full gap-2"
                onClick={() => fileInputRef.current?.click()}
                disabled={importing}
              >
                {importing ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Upload className="h-4 w-4" />
                )}
                {t("importBackup")}
              </Button>

              <input
                ref={fileInputRef}
                type="file"
                accept=".zip"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void handleImport(file);
                }}
              />
            </div>

            <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{t("backupWarning")}</span>
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
