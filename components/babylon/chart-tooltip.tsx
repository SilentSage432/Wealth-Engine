import { formatCurrency } from "@/lib/utils";

interface ChartTooltipShellProps {
  active?: boolean;
  payload?: Array<{ name?: string; value?: number; color?: string }>;
  label?: string;
}

export function ChartTooltipShell({
  active,
  payload,
  label,
}: ChartTooltipShellProps) {
  if (!active || !payload?.length) return null;

  return (
    <div className="rounded-lg border border-slate-700 bg-slate-950/95 px-3 py-2 shadow-xl backdrop-blur">
      <p className="mb-1 text-xs font-medium text-slate-400">{label}</p>
      {payload.map((entry) => (
        <p
          key={entry.name}
          className="text-sm tabular-nums"
          style={{ color: entry.color }}
        >
          {entry.name}: {formatCurrency(Number(entry.value ?? 0))}
        </p>
      ))}
    </div>
  );
}
