"use client";

import { useActionState } from "react";
import { updatePassword, type FormState } from "../actions";
import { Field, FormMessage, SubmitButton } from "@/components/field";

export function NewPasswordForm() {
  const [state, action, pending] = useActionState<FormState, FormData>(updatePassword, {});
  return (
    <form action={action} className="flex flex-col gap-4">
      <Field label="Nova senha" name="password" type="password" autoComplete="new-password" minLength={8} hint="Pelo menos 8 caracteres." required />
      <FormMessage {...state} />
      <SubmitButton pending={pending}>SALVAR SENHA</SubmitButton>
    </form>
  );
}
