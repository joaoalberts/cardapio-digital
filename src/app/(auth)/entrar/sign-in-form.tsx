"use client";

import { useActionState, useState } from "react";
import { signIn, type FormState } from "../actions";
import { Field, FormMessage, SubmitButton } from "@/components/field";

export function SignInForm() {
  const [state, action, pending] = useActionState<FormState, FormData>(signIn, {});
  // Controlado para o e-mail não sumir quando a senha estiver errada.
  const [email, setEmail] = useState("");
  return (
    <form action={action} className="flex flex-col gap-4">
      <Field
        label="E-mail"
        name="email"
        type="email"
        autoComplete="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        required
      />
      <Field label="Senha" name="password" type="password" autoComplete="current-password" required />
      <FormMessage {...state} />
      <SubmitButton pending={pending}>ENTRAR</SubmitButton>
    </form>
  );
}
