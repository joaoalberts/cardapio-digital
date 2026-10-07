import type { Metadata } from "next";
import Link from "next/link";
import { SignInForm } from "./sign-in-form";

export const metadata: Metadata = { title: "Entrar" };

export default function SignInPage() {
  return (
    <>
      <h1 className="text-2xl font-semibold">Entrar no painel</h1>
      <SignInForm />
      <p className="text-sm text-black/60 dark:text-white/60">
        Ainda não tem conta?{" "}
        <Link href="/cadastro" className="font-medium underline">
          Cadastre seu restaurante
        </Link>
      </p>
    </>
  );
}
