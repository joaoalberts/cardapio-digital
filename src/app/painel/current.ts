import "server-only";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Restaurante que o painel está editando: o primeiro de que o usuário é membro.
export async function currentRestaurant<T extends string>(columns: T) {
  await connection();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/entrar");

  const { data, error } = await supabase
    .from("restaurants")
    .select(`id, name, slug, ${columns}, members!inner(role)`)
    .eq("members.user_id", user.id)
    .order("created_at")
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data) redirect("/painel");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const row = data as any;
  return {
    restaurant: row as { id: string; name: string; slug: string } & Record<string, unknown>,
    isOwner: (row.members as { role: string }[]).some((m) => m.role === "owner"),
  };
}
