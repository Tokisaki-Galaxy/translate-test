"use client";

import { MapPin, Star, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { type Favorite } from "@/lib/db";
import { scoreColor } from "@/lib/polyglot";
import { cn } from "@/lib/utils";

type FavoritesSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  favorites: Favorite[];
  onUnfavorite: (favoriteId: number) => Promise<void>;
  onClearAll: () => Promise<void>;
  onNavigate: (sessionId: number, sentenceId: number) => void;
};

export function FavoritesSheet({
  open,
  onOpenChange,
  favorites,
  onUnfavorite,
  onClearAll,
  onNavigate,
}: FavoritesSheetProps) {
  async function handleClearAll() {
    if (favorites.length === 0) return;
    await onClearAll();
    toast.success("已清空收藏夹");
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        <SheetHeader>
          <div className="flex items-center justify-between pr-8">
            <div>
              <SheetTitle>收藏夹</SheetTitle>
              <SheetDescription className="mt-1">
                {favorites.length === 0
                  ? "暂无收藏"
                  : `共 ${favorites.length} 条收藏`}
              </SheetDescription>
            </div>
            {favorites.length > 0 && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-1.5 text-xs text-red-500 hover:text-red-600"
                onClick={() => void handleClearAll()}
              >
                <Trash2 className="h-3.5 w-3.5" />
                清空
              </Button>
            )}
          </div>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {favorites.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
              <Star className="mb-3 h-10 w-10 opacity-20" />
              <p className="text-sm">点击句子卡片右上角的星星来收藏</p>
            </div>
          ) : (
            favorites.map((fav) => (
              <div
                key={fav.id}
                className="rounded-lg border border-border bg-card p-3 shadow-sm text-sm space-y-1.5"
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="font-medium leading-snug text-xs flex-1">
                    {fav.original}
                  </p>
                  <div className="flex shrink-0 gap-1">
                    <button
                      type="button"
                      title="跳转到原句"
                      className="rounded p-1 text-muted-foreground hover:text-primary transition-colors"
                      onClick={() => {
                        onNavigate(fav.sessionId, fav.sentenceId);
                        onOpenChange(false);
                      }}
                    >
                      <MapPin className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      title="取消收藏"
                      className="rounded p-1 text-yellow-400 hover:text-muted-foreground transition-colors"
                      onClick={() => fav.id !== undefined && void onUnfavorite(fav.id)}
                    >
                      <Star className="h-3.5 w-3.5 fill-current" />
                    </button>
                  </div>
                </div>

                {fav.translation && (
                  <p className="text-xs text-muted-foreground leading-snug">
                    {fav.translation}
                  </p>
                )}

                <div className="flex items-center justify-between pt-0.5">
                  <span
                    className={cn(
                      "text-xs font-semibold tabular-nums",
                      scoreColor(fav.score),
                    )}
                  >
                    {fav.score === null ? "评分加载中..." : `分值: ${fav.score}`}
                  </span>
                  {fav.feedback && (
                    <span className="text-xs text-muted-foreground line-clamp-1 max-w-[60%]">
                      {fav.feedback}
                    </span>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
