import type { InputHTMLAttributes } from "react";

export function Field({
  label,
  hint,
  ...input
}: { label: string; hint?: string } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="font-medium">{label}</span>
      <input
        className="rounded-lg border border-black/15 bg-transparent px-3 py-2.5 text-base outline-none focus:border-black/60 dark:border-white/20 dark:focus:border-white/70"
        {...input}
      />
      {hint && <span className="text-xs text-black/55 dark:text-white/55">{hint}</span>}
    </label>
  );
}

export function SubmitButton({ pending, children }: { pending: boolean; children: string }) {
  return (
    <button
      type="submit"
      disabled={pending}
      className="mt-2 rounded-lg bg-foreground px-4 py-3 font-medium text-background disabled:opacity-60"
    >
      {pending ? "Aguarde…" : children}
    </button>
  );
}

export function FormMessage({ error, message }: { error?: string; message?: string }) {
  if (!error && !message) return null;
  return (
    <p
      aria-live="polite"
      className={`rounded-lg px-3 py-2 text-sm ${
        error ? "bg-red-500/10 text-red-700 dark:text-red-300" : "bg-green-500/10 text-green-800 dark:text-green-300"
      }`}
    >
      {error ?? message}
    </p>
  );
}
