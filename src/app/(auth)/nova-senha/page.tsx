import type { Metadata } from "next";
import { NewPasswordForm } from "./new-password-form";

export const metadata: Metadata = { title: "Nova senha" };

export default function NewPasswordPage() {
  return (
    <>
      <h1 className="text-[26px] font-semibold">Nova senha</h1>
      <NewPasswordForm />
    </>
  );
}
