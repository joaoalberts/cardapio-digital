"use client";

import { useActionState, useState } from "react";
import { signUp, type FormState } from "../actions";
import { Field, FormMessage, SubmitButton } from "@/components/field";
import { slugify } from "@/lib/slug";

export function SignUpForm() {
  const [state, action, pending] = useActionState<FormState, FormData>(signUp, {});
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);
  const [email, setEmail] = useState("");
  const shownSlug = slugEdited ? slug : slugify(name);

  if (state.message) return <FormMessage message={state.message} />;

  return (
    <form action={action} className="flex flex-col gap-4">
      <Field
        label="Nome do restaurante"
        name="restaurant_name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        required
        maxLength={80}
      />
      <Field
        label="Endereço do cardápio"
        name="slug"
        value={shownSlug}
        onChange={(e) => {
          setSlugEdited(true);
          setSlug(slugify(e.target.value));
        }}
        hint={`Link do cardápio: …/${shownSlug || "seu-restaurante"}`}
        required
        minLength={3}
        maxLength={40}
      />
      <Field
        label="Seu e-mail"
        name="email"
        type="email"
        autoComplete="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        required
      />
      <Field
        label="Senha"
        name="password"
        type="password"
        autoComplete="new-password"
        minLength={8}
        required
        hint="Pelo menos 8 caracteres."
      />
      <FormMessage error={state.error} />
      <SubmitButton pending={pending}>Criar conta</SubmitButton>
    </form>
  );
}
