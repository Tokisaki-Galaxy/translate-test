"use client";

import { useRef, useState } from "react";
import JSZip from "jszip";
import {
  Download,
  Eye,
  EyeOff,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Upload,
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

export type Settings = {
  apiKey: string;
  apiBase: string;
  model: string;
  level: string;
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
  const fileInputRef = useRef<HTMLInputElement>(null);

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
          level: imported.level ?? settings.level,
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

            <div className="space-y-2">
              <label className="text-sm font-medium">难度级别</label>
              <select
                className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm"
                value={settings.level}
                onChange={(e) =>
                  onSettingsChange({ ...settings, level: e.target.value })
                }
              >
                <option value="">自动检测</option>
                <option value="四级">四级 (CET-4)</option>
                <option value="六级">六级 (CET-6)</option>
                <option value="考研">考研</option>
                <option value="雅思">雅思 (IELTS)</option>
                <option value="托福">托福 (TOEFL)</option>
                <option value="GRE">GRE</option>
              </select>
              <p className="text-xs text-muted-foreground">
                设定后，AI 将按对应学术标准进行严苛评判；选&ldquo;自动检测&rdquo;则由 AI
                自动推断难度。
              </p>
            </div>
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
