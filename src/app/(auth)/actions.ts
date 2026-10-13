"use server";

import { redirect } from "next/navigation";
import { EMAIL, checkCredentials, createUser, currentUserId, findUserByEmail, normalizeEmail, setPassword, startSession } from "@/lib/auth";
import { createRestaurantFor, slugTaken } from "@/lib/restaurants";
import { isValidSlug, slugify } from "@/lib/slug";

export type FormState = { error?: string; message?: string };

function text(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

export async function signIn(_prev: FormState, formData: FormData): Promise<FormState> {
  const email = text(formData, "email");
  const password = String(formData.get("password") ?? "");
  if (!email || !password) return { error: "Preencha e-mail e senha." };

  const user = await checkCredentials(email, password);
  if (!user) return { error: "E-mail ou senha incorretos." };
  await startSession(user.id);
  redirect("/painel");
}

export async function signUp(_prev: FormState, formData: FormData): Promise<FormState> {
  const restaurantName = text(formData, "restaurant_name");
  const slug = slugify(text(formData, "slug") || restaurantName);
  const email = normalizeEmail(text(formData, "email"));
  const password = String(formData.get("password") ?? "");

  if (!restaurantName) return { error: "Informe o nome do restaurante." };
  if (!isValidSlug(slug)) {
    return { error: "Esse endereço não pode ser usado. Use de 3 a 40 letras, números ou hífens." };
  }
  if (!EMAIL.test(email)) return { error: "Informe um e-mail válido." };
  if (password.length < 8) return { error: "A senha precisa ter pelo menos 8 caracteres." };
  if (await findUserByEmail(email)) {
    return { error: "Já existe uma conta com esse e-mail. Use a opção Entrar." };
  }
  if (await slugTaken(slug)) return { error: "Esse endereço já está em uso. Escolha outro." };

  // Sem confirmação por e-mail: a conta já entra no painel com o restaurante criado.
  const user = await createUser(email, password);
  await createRestaurantFor(user.id, restaurantName, slug);
  await startSession(user.id);
  redirect("/painel");
}

// "Esqueci minha senha": ainda não há serviço de e-mail ligado depois da saída do Supabase.
export async function requestPasswordReset(_prev: FormState, formData: FormData): Promise<FormState> {
  const email = text(formData, "email");
  if (!email) return { error: "Informe seu e-mail." };
  return {
    error: "A troca de senha por e-mail está temporariamente fora do ar. Fale com o suporte pelo WhatsApp que ajudamos você a entrar.",
  };
}

export async function updatePassword(_prev: FormState, formData: FormData): Promise<FormState> {
  const password = String(formData.get("password") ?? "");
  if (password.length < 8) return { error: "A senha precisa ter pelo menos 8 caracteres." };
  const userId = await currentUserId();
  if (!userId) return { error: "Entre de novo para trocar a senha." };
  await setPassword(userId, password);
  redirect("/painel");
}
