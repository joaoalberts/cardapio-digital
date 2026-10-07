"use client";

import { useActionState, useState } from "react";
import { createRestaurant } from "./actions";
import type { FormState } from "@/app/(auth)/actions";
import { Field, FormMessage, SubmitButton } from "@/components/field";
import { slugify } from "@/lib/slug";

export function CreateRestaurantForm({
  initialName = "",
  initialSlug = "",
}: {
  initialName?: string;
  initialSlug?: string;
}) {
  const [state, action, pending] = useActionState<FormState, FormData>(createRestaurant, {});
  const [name, setName] = useState(initialName);
  const [slug, setSlug] = useState(initialSlug || slugify(initialName));

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
        value={slug}
        onChange={(e) => setSlug(slugify(e.target.value))}
        hint={`Link do cardápio: …/${slug || "seu-restaurante"}`}
        required
        minLength={3}
        maxLength={40}
      />
      <FormMessage error={state.error} />
      <SubmitButton pending={pending}>Criar restaurante</SubmitButton>
    </form>
  );
}
