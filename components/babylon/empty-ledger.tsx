import { Archive } from "lucide-react";

interface EmptyLedgerProps {
  message: string;
}

export function EmptyLedger({ message }: EmptyLedgerProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
      <Archive className="h-8 w-8 text-slate-600" />
      <p className="text-sm text-slate-500">{message}</p>
    </div>
  );
}
