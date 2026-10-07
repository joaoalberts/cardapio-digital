import type { Metadata } from "next";
import Link from "next/link";
import { ResetForm } from "./reset-form";

export const metadata: Metadata = { title: "Esqueci minha senha" };

export default function ForgotPage() {
  return (
    <>
      <div className="flex flex-col gap-1">
        <h1 className="text-[26px] font-semibold">Esqueci minha senha</h1>
        <p className="text-sm text-black/60">Mandamos um link para o seu e-mail para criar uma senha nova.</p>
      </div>
      <ResetForm />
      <Link href="/entrar" className="text-sm font-semibold text-[#c08a3e]">
        Voltar para o login
      </Link>
    </>
  );
}
