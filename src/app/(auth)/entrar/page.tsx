import type { Metadata } from "next";
import Link from "next/link";
import { SignInForm } from "./sign-in-form";

export const metadata: Metadata = { title: "Entrar" };

export default function SignInPage() {
  return (
    <>
      <h1 className="text-[26px] font-semibold">Login</h1>
      <SignInForm />
      <div className="flex flex-col gap-1 text-sm">
        <Link href="/esqueci-senha" className="font-semibold text-[#c08a3e]">
          Esqueci minha senha
        </Link>
        <p>
          Novo por aqui?{" "}
          <Link href="/cadastro" className="font-semibold text-[#c08a3e]">
            Cadastre agora
          </Link>
        </p>
      </div>
    </>
  );
}
