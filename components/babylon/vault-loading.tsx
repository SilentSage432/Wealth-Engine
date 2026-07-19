export function VaultLoading() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 luxury-grid">
      <div className="flex flex-col items-center gap-3">
        <div className="h-10 w-10 animate-pulse rounded-full border-2 border-emerald-500/40 border-t-emerald-400" />
        <p className="font-[family-name:var(--font-display)] text-xl text-slate-300">
          Opening the vault…
        </p>
      </div>
    </div>
  );
}
