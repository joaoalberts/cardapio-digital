import type { Metadata } from "next";
import Link from "next/link";
import { SignUpForm } from "./sign-up-form";

export const metadata: Metadata = { title: "Cadastrar restaurante" };

export default function SignUpPage() {
  return (
    <>
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">Cadastre seu restaurante</h1>
        <p className="text-sm text-black/60 dark:text-white/60">14 dias grátis para testar.</p>
      </div>
      <SignUpForm />
      <p className="text-sm text-black/60 dark:text-white/60">
        Já tem conta?{" "}
        <Link href="/entrar" className="font-medium underline">
          Entrar
        </Link>
      </p>
    </>
  );
}
