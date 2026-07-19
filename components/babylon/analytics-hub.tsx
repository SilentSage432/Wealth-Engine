"use client";

import {
  Area,
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ChartTooltipShell } from "@/components/babylon/chart-tooltip";
import { EmptyLedger } from "@/components/babylon/empty-ledger";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn, formatCompactCurrency, formatCurrency } from "@/lib/utils";
import type { ChartMonthPoint, DonutSlice } from "@/types/babylon";

interface AnalyticsHubProps {
  chartData: ChartMonthPoint[];
  donutData: DonutSlice[];
  currentMonthNeed: number;
  currentMonthDesire: number;
  currentMonthRemaining: number;
}

export function AnalyticsHub({
  chartData,
  donutData,
  currentMonthNeed,
  currentMonthDesire,
  currentMonthRemaining,
}: AnalyticsHubProps) {
  return (
    <section className="flex flex-col gap-4 xl:flex-row">
      <Card className="min-w-0 flex-1 animate-fade-up xl:flex-[3]">
        <CardHeader className="px-4 sm:px-6">
          <CardTitle className="font-[family-name:var(--font-display)] text-lg sm:text-xl">
            Income vs. Pot Allocations
          </CardTitle>
          <CardDescription>
            Gross tribute streams mapped against the Golden Triad over time
          </CardDescription>
        </CardHeader>
        <CardContent className="h-[240px] px-2 pt-2 sm:h-[280px] sm:px-6 xl:h-[320px]">
          {chartData.length === 0 ? (
            <EmptyLedger message="Charts populate once the first income stream is logged." />
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart
                data={chartData}
                margin={{ top: 8, right: 4, left: -8, bottom: 0 }}
              >
                <defs>
                  <linearGradient id="incomeFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#64748b" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="#64748b" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="#1e293b"
                  vertical={false}
                />
                <XAxis
                  dataKey="label"
                  tick={{ fill: "#64748b", fontSize: 11 }}
                  axisLine={{ stroke: "#1e293b" }}
                  tickLine={false}
                />
                <YAxis
                  width={48}
                  tick={{ fill: "#64748b", fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v: number) => formatCompactCurrency(v)}
                />
                <Tooltip content={<ChartTooltipShell />} />
                <Legend wrapperStyle={{ fontSize: 11, color: "#94a3b8" }} />
                <Area
                  type="monotone"
                  dataKey="income"
                  name="Total Income"
                  fill="url(#incomeFill)"
                  stroke="#94a3b8"
                  strokeWidth={2}
                />
                <Bar
                  dataKey="wealth"
                  name="Wealth 10%"
                  fill="#10b981"
                  radius={[4, 4, 0, 0]}
                  barSize={12}
                />
                <Bar
                  dataKey="debt"
                  name="Debt 20%"
                  fill="#f59e0b"
                  radius={[4, 4, 0, 0]}
                  barSize={12}
                />
                <Bar
                  dataKey="expenditure"
                  name="Live 70%"
                  fill="#475569"
                  radius={[4, 4, 0, 0]}
                  barSize={12}
                />
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      <Card className="min-w-0 w-full animate-fade-up xl:w-auto xl:flex-[2]">
        <CardHeader className="px-4 sm:px-6">
          <CardTitle className="font-[family-name:var(--font-display)] text-lg sm:text-xl">
            This Month&apos;s Expenditures
          </CardTitle>
          <CardDescription>
            Needs vs. Desires vs. unspent allowance
          </CardDescription>
        </CardHeader>
        <CardContent className="px-4 sm:px-6">
          {donutData.length === 0 ? (
            <div className="h-[240px] sm:h-[280px] xl:h-[320px]">
              <EmptyLedger message="Expenditure breakdown appears after the first income stream is logged." />
            </div>
          ) : (
            <>
              <div className="h-[200px] sm:h-[220px]">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={donutData}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      innerRadius={52}
                      outerRadius={76}
                      paddingAngle={3}
                      stroke="none"
                    >
                      {donutData.map((entry) => (
                        <Cell key={entry.name} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(value) => formatCurrency(Number(value ?? 0))}
                      contentStyle={{
                        background: "#020617",
                        border: "1px solid #1e293b",
                        borderRadius: 8,
                        fontSize: 12,
                      }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="mt-2 space-y-2">
                {[
                  {
                    label: "Needs",
                    value: currentMonthNeed,
                    color: "bg-emerald-500",
                  },
                  {
                    label: "Desires",
                    value: currentMonthDesire,
                    color: "bg-amber-500",
                  },
                  {
                    label: "Unspent",
                    value: currentMonthRemaining,
                    color: "bg-slate-600",
                  },
                ].map((row) => (
                  <div
                    key={row.label}
                    className="flex items-center justify-between text-sm"
                  >
                    <span className="flex items-center gap-2 text-slate-400">
                      <span className={cn("h-2 w-2 rounded-full", row.color)} />
                      {row.label}
                    </span>
                    <span className="tabular-nums text-slate-200">
                      {formatCurrency(row.value)}
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
