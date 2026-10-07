import { createBrowserClient } from "@supabase/ssr";
import { requireSupabaseEnv } from "./env";

// Cliente do navegador: usa a sessão dos cookies; serve para enviar arquivos direto ao Storage.
export function createClient() {
  const { url, key } = requireSupabaseEnv();
  return createBrowserClient(url, key);
}
