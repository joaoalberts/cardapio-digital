import Link from "next/link";

export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-6 px-4 py-10">
      <Link href="/" className="text-sm font-semibold tracking-tight">
        Cardápio Digital
      </Link>
      {children}
    </main>
  );
}
