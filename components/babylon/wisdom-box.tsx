"use client";

import { BookOpen } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { BABYLON_WISDOM } from "@/lib/babylon/constants";
import { cn } from "@/lib/utils";

interface WisdomBoxProps {
  wisdomIndex: number;
  expanded: boolean;
  onSelectIndex: (index: number) => void;
}

export function WisdomBox({
  wisdomIndex,
  expanded,
  onSelectIndex,
}: WisdomBoxProps) {
  return (
    <Card
      className={cn(
        "wisdom-console relative overflow-hidden border-emerald-900/40 bg-gradient-to-br from-slate-900 via-slate-900 to-emerald-950/40",
        expanded && "lg:col-span-1 min-h-[280px]"
      )}
    >
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-emerald-400/40 to-transparent"
        aria-hidden="true"
      />
      <div
        className="pointer-events-none absolute -right-8 -top-8 h-32 w-32 rounded-full bg-emerald-500/10 blur-2xl animate-pulse-soft"
        aria-hidden="true"
      />
      <div
        className="pointer-events-none absolute -bottom-10 left-6 h-24 w-24 rounded-full bg-amber-500/5 blur-2xl"
        aria-hidden="true"
      />
      <CardHeader className="relative pb-2">
        <CardDescription className="flex items-center gap-2 text-emerald-400">
          <BookOpen className="h-4 w-4" aria-hidden="true" />
          The Babylon Wisdom Box
        </CardDescription>
        <CardTitle className="font-[family-name:var(--font-display)] text-lg text-slate-200">
          Aphorisms of Arkad
        </CardTitle>
      </CardHeader>
      <CardContent className="relative">
        <div className="rounded-lg border border-emerald-900/30 bg-slate-950/35 px-4 py-4 backdrop-blur-[2px]">
          <blockquote
            key={wisdomIndex}
            className="wisdom-fade font-[family-name:var(--font-display)] text-xl leading-relaxed text-slate-100 sm:text-2xl"
          >
            &ldquo;{BABYLON_WISDOM[wisdomIndex]}&rdquo;
          </blockquote>
        </div>
        <div
          className="mt-6 flex items-center gap-2"
          role="tablist"
          aria-label="Wisdom aphorism selector"
        >
          {BABYLON_WISDOM.map((_, i) => (
            <button
              key={i}
              type="button"
              role="tab"
              aria-selected={i === wisdomIndex}
              aria-label={`Show wisdom ${i + 1} of ${BABYLON_WISDOM.length}`}
              onClick={() => onSelectIndex(i)}
              className={cn(
                "h-1.5 rounded-full transition-all duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/50",
                i === wisdomIndex
                  ? "w-6 bg-emerald-400"
                  : "w-1.5 bg-slate-700 hover:bg-slate-500"
              )}
            />
          ))}
        </div>
        {expanded && (
          <ul className="mt-8 grid gap-3 sm:grid-cols-2">
            {BABYLON_WISDOM.map((quote, i) => (
              <li
                key={quote}
                className={cn(
                  "rounded-lg border border-slate-800 bg-slate-950/40 px-4 py-3 text-sm text-slate-400 transition-colors",
                  i === wisdomIndex &&
                    "border-emerald-800/60 text-emerald-200"
                )}
              >
                {quote}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
