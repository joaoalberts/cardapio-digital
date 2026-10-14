"use server";

import { redirect } from "next/navigation";
import { EMAIL, checkCredentials, createUser, currentUser, currentUserId, findUserByEmail, normalizeEmail, setPassword, startSession } from "@/lib/auth";
import { createRestaurantFor, slugTaken } from "@/lib/restaurants";
import { isValidSlug, slugify } from "@/lib/slug";

export type FormState = { error?: string; message?: string };

// Falha do banco (token ausente na Vercel, NocoDB fora do ar) vira mensagem no
// formulário em vez da tela de erro do servidor.
function dbError(e: unknown): FormState {
  console.error(e);
  if (e instanceof Error && /Falta (AUTH_SECRET|NOCODB_API_TOKEN)/.test(e.message)) {
    return { error: "O site ainda não está ligado ao banco: falta o NOCODB_API_TOKEN na Vercel (e um Redeploy depois de colocar)." };
  }
  return { error: "O banco não respondeu agora. Tente de novo em alguns segundos." };
}

function text(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

export async function signIn(_prev: FormState, formData: FormData): Promise<FormState> {
  const email = text(formData, "email");
  const password = String(formData.get("password") ?? "");
  if (!email || !password) return { error: "Preencha e-mail e senha." };

  try {
    const user = await checkCredentials(email, password);
    if (!user) return { error: "E-mail ou senha incorretos." };
    await startSession(user.id);
  } catch (e) {
    return dbError(e);
  }
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
  try {
    if (await findUserByEmail(email)) {
      return { error: "Já existe uma conta com esse e-mail. Use a opção Entrar." };
    }
    if (await slugTaken(slug)) return { error: "Esse endereço já está em uso. Escolha outro." };

    // Sem confirmação por e-mail: a conta já entra no painel com o restaurante criado.
    const user = await createUser(email, password);
    await createRestaurantFor(user.id, restaurantName, slug);
    await startSession(user.id);
  } catch (e) {
    return dbError(e);
  }
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
  try {
    const userId = await currentUserId();
    if (!userId) return { error: "Entre de novo para trocar a senha." };
    await setPassword(userId, password);
  } catch (e) {
    return dbError(e);
  }
  redirect("/painel");
}

// Painel > Editar Perfil: troca a senha conferindo a atual. Continua logado.
export async function changePassword(_prev: FormState, formData: FormData): Promise<FormState> {
  const current = String(formData.get("current") ?? "");
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");
  if (!current || !password) return { error: "Preencha a senha atual e a nova." };
  if (password.length < 8) return { error: "A senha nova precisa ter pelo menos 8 caracteres." };
  if (password !== confirm) return { error: "A confirmação não bate com a senha nova." };
  if (password === current) return { error: "A senha nova precisa ser diferente da atual." };
  try {
    const user = await currentUser();
    if (!user) return { error: "Entre de novo para trocar a senha." };
    if (!(await checkCredentials(user.email, current))) return { error: "A senha atual está errada." };
    await setPassword(user.id, password);
  } catch (e) {
    return dbError(e);
  }
  return { message: "Senha alterada. Use a nova no próximo login." };
}
