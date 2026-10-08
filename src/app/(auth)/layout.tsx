import Link from "next/link";

// Entrar e cadastro no formato do DGuests: foto do restaurante à esquerda e o
// formulário à direita. No celular a foto vira uma faixa no topo.
export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="grid min-h-dvh flex-1 bg-[#f7f7f7] text-[#333] [color-scheme:light] md:grid-cols-[1.15fr_1fr]">
      <div className="relative h-44 overflow-hidden md:h-auto">
        {/* eslint-disable-next-line @next/next/no-img-element -- foto fixa do sistema */}
        <img src="/demo/v-forno-poster.jpg" alt="" className="absolute inset-0 h-full w-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/10 to-transparent" />
        <Link href="/" className="absolute bottom-5 left-6 text-lg font-extrabold tracking-[0.2em] text-white">
          <span className="text-[#c08a3e]">C</span>ARDÁPIO
        </Link>
      </div>
      <main className="flex items-center justify-center px-6 py-10">
        <div className="flex w-full max-w-[300px] flex-col gap-6">{children}</div>
      </main>
    </div>
  );
}
