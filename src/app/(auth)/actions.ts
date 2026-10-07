"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isValidSlug, slugify } from "@/lib/slug";

export type FormState = { error?: string; message?: string };

function text(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

export async function signIn(_prev: FormState, formData: FormData): Promise<FormState> {
  const email = text(formData, "email");
  const password = String(formData.get("password") ?? "");
  if (!email || !password) return { error: "Preencha e-mail e senha." };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    if (error.code === "email_not_confirmed") {
      return { error: "Confirme seu e-mail pelo link que enviamos antes de entrar." };
    }
    return { error: "E-mail ou senha incorretos." };
  }
  redirect("/painel");
}

export async function signUp(_prev: FormState, formData: FormData): Promise<FormState> {
  const restaurantName = text(formData, "restaurant_name");
  const slug = slugify(text(formData, "slug") || restaurantName);
  const email = text(formData, "email");
  const password = String(formData.get("password") ?? "");

  if (!restaurantName) return { error: "Informe o nome do restaurante." };
  if (!isValidSlug(slug)) {
    return { error: "Esse endereço não pode ser usado. Use de 3 a 40 letras, números ou hífens." };
  }
  if (!email) return { error: "Informe seu e-mail." };
  if (password.length < 8) return { error: "A senha precisa ter pelo menos 8 caracteres." };

  const origin = (await headers()).get("origin") ?? "";
  const supabase = await createClient();
  // O restaurante fica guardado no perfil até o primeiro acesso ao painel,
  // porque com confirmação de e-mail ainda não há sessão aqui.
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: `${origin}/auth/callback`,
      data: { pending_restaurant: { name: restaurantName, slug } },
    },
  });
  if (error) {
    if (error.code === "user_already_exists") {
      return { error: "Já existe uma conta com esse e-mail. Use a opção Entrar." };
    }
    if (error.code === "weak_password") return { error: "Escolha uma senha mais forte." };
    return { error: "Não foi possível criar a conta. Tente de novo." };
  }

  if (!data.session) {
    return { message: `Enviamos um link de confirmação para ${email}. Abra-o para entrar no painel.` };
  }
  redirect("/painel");
}

// "Esqueci minha senha": manda o link por e-mail; ele volta em /nova-senha já logado.
export async function requestPasswordReset(_prev: FormState, formData: FormData): Promise<FormState> {
  const email = text(formData, "email");
  if (!email) return { error: "Informe seu e-mail." };
  const origin = (await headers()).get("origin") ?? "";
  const supabase = await createClient();
  await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${origin}/auth/callback?next=/nova-senha` });
  // Mesma resposta exista ou não a conta, para não revelar quem é cliente.
  return { message: "Se houver uma conta com esse e-mail, enviamos um link para criar uma nova senha." };
}

export async function updatePassword(_prev: FormState, formData: FormData): Promise<FormState> {
  const password = String(formData.get("password") ?? "");
  if (password.length < 8) return { error: "A senha precisa ter pelo menos 8 caracteres." };
  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    if (error.code === "weak_password") return { error: "Escolha uma senha mais forte." };
    if (error.code === "same_password") return { error: "Use uma senha diferente da anterior." };
    return { error: "O link expirou. Peça um novo em Esqueci minha senha." };
  }
  redirect("/painel");
}
