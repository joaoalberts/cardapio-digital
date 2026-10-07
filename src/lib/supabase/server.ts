import "server-only";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { requireSupabaseEnv } from "./env";

// Cliente do Supabase com a sessão de quem está logado (lida dos cookies).
export async function createClient() {
  // cookies() primeiro: marca a página como dinâmica antes de qualquer outra checagem.
  const cookieStore = await cookies();
  const { url, key } = requireSupabaseEnv();

  return createServerClient(url, key, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options),
          );
        } catch {
          // Em Server Components não dá para gravar cookies; o proxy renova a sessão.
        }
      },
    },
  });
}
