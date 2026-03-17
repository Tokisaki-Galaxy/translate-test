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
import { type Sentence, type Session, db } from "@/lib/db";
import { cleanTTSText, isTTSSupported } from "@/lib/useTTS";

export type Settings = {
  apiKey: string;
  apiBase: string;
  model: string;
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
    const text = cleanTTSText("1. 这是所选语音的预览效果。");
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
            ? `模型探测失败 (${response.status}): ${result.error}`
            : `模型探测失败 (HTTP ${response.status})`,
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
      toast("备份文件包含您的 API Key，请妥善保管。", {
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

      const blob = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `polyglot_backup_${Date.now()}.zip`;
      anchor.click();
      URL.revokeObjectURL(url);

      toast.success("备份导出成功！");
    } catch (error) {
      toast.error(
        `导出失败：${error instanceof Error ? error.message : "未知错误"}`,
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
                ? `${base} (Imported)`
                : `${base} (Imported ${counter})`;
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

      await onSessionsRefresh();
      toast.success("备份导入成功！侧边栏已更新。");
    } catch (error) {
      toast.error(
        `导入失败：${error instanceof Error ? error.message : "未知错误"}`,
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
          <DialogTitle>设置</DialogTitle>
          <DialogDescription>管理您的偏好设置与数据备份。</DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="preferences" className="mt-2">
          <TabsList className="w-full">
            <TabsTrigger value="preferences" className="flex-1">
              偏好设置
            </TabsTrigger>
            <TabsTrigger value="voice" className="flex-1">
              语音
            </TabsTrigger>
            <TabsTrigger value="data" className="flex-1">
              数据安全
            </TabsTrigger>
          </TabsList>

          {/* ── Preferences Tab ── */}
          <TabsContent value="preferences" className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">API Key</label>
              <div className="relative">
                <Input
                  type={showApiKey ? "text" : "password"}
                  placeholder="输入您的 OpenAI API Key"
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
                  aria-label={showApiKey ? "隐藏 API Key" : "显示 API Key"}
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
              <label className="text-sm font-medium">API Base URL</label>
              <Input
                placeholder="https://api.openai.com/v1"
                value={settings.apiBase}
                onChange={(e) =>
                  onSettingsChange({ ...settings, apiBase: e.target.value })
                }
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">模型</label>
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
                  title="探测可用模型"
                >
                  {probing ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <RefreshCw className="h-4 w-4" />
                  )}
                </Button>
              </div>
            </div>
          </TabsContent>

          {/* ── Voice / TTS Tab ── */}
          <TabsContent value="voice" className="space-y-4">
            {!ttsSupported ? (
              <p className="text-sm text-muted-foreground">
                您的浏览器不支持 Web Speech API，语音功能不可用。
              </p>
            ) : (
              <>
                {/* TTS Enable toggle */}
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium">启用朗读功能</label>
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
                        settings.ttsEnabled
                          ? "translate-x-5"
                          : "translate-x-0"
                      }`}
                    />
                  </button>
                </div>

                {/* Voice selector */}
                <div className="space-y-2">
                  <label className="text-sm font-medium">语音来源</label>
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
                      <option value="">默认语音</option>
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
                      title="预览语音"
                    >
                      <Volume2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>

                {/* Speech rate slider */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-sm font-medium">语速</label>
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
            <p className="text-sm text-muted-foreground">
              导出或导入包含所有会话和设置（含 API Key）的备份文件。
            </p>

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
                导出备份
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
                导入备份
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
              <span>
                备份文件中包含您的 API Key，请妥善保管，勿分享给他人。
              </span>
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
