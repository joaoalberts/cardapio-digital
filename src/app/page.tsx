import Link from "next/link";

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-6 px-4 py-10">
      <h1 className="text-3xl font-semibold tracking-tight">Cardápio Digital</h1>
      <p className="opacity-70">
        Cardápio em stories para o seu restaurante, com QR Code em cada mesa e mudanças que
        aparecem na hora para o cliente.
      </p>
      <div className="flex gap-3">
        <Link href="/cadastro" className="rounded-lg bg-foreground px-4 py-3 font-medium text-background">
          Cadastrar restaurante
        </Link>
        <Link href="/entrar" className="rounded-lg border border-black/15 px-4 py-3 font-medium dark:border-white/20">
          Entrar
        </Link>
      </div>
    </main>
  );
}
