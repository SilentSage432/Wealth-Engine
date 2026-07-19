"use client";

import { Area, AreaChart, ResponsiveContainer } from "recharts";
import type { SparkPoint } from "@/types/babylon";

interface MiniSparklineProps {
  data: SparkPoint[];
  color?: string;
}

export function MiniSparkline({
  data,
  color = "#10b981",
}: MiniSparklineProps) {
  if (data.length < 2) {
    return (
      <div className="flex h-10 items-end gap-1">
        {[40, 55, 48, 70, 62, 80].map((h, i) => (
          <div
            key={i}
            className="w-1.5 rounded-sm bg-emerald-500/30"
            style={{ height: `${h}%` }}
          />
        ))}
      </div>
    );
  }

  const gradientId = `spark-${color.replace("#", "")}`;

  return (
    <div className="h-10 w-28">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.45} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <Area
            type="monotone"
            dataKey="value"
            stroke={color}
            strokeWidth={1.75}
            fill={`url(#${gradientId})`}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
