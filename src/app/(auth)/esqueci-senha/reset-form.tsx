"use client";

import { useActionState } from "react";
import { requestPasswordReset, type FormState } from "../actions";
import { Field, FormMessage, SubmitButton } from "@/components/field";

export function ResetForm() {
  const [state, action, pending] = useActionState<FormState, FormData>(requestPasswordReset, {});
  return (
    <form action={action} className="flex flex-col gap-4">
      <Field label="E-mail" name="email" type="email" autoComplete="email" required />
      <FormMessage {...state} />
      <SubmitButton pending={pending}>ENVIAR LINK</SubmitButton>
    </form>
  );
}
