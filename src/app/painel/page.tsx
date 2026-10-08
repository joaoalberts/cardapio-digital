import type { Metadata } from "next";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { CreateRestaurantForm } from "./create-restaurant-form";
import { signOut } from "./actions";

export const metadata: Metadata = { title: "Painel" };

export default function PainelPage() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-8 px-4 py-8">
      <header className="flex items-center justify-between">
        <span className="text-sm font-semibold tracking-tight">Cardápio Digital</span>
        <form action={signOut}>
          <button className="text-sm underline">Sair</button>
        </form>
      </header>
      <Suspense fallback={<p className="text-sm opacity-60">Carregando…</p>}>
        <PainelContent />
      </Suspense>
    </main>
  );
}

async function PainelContent() {
  // O cliente do Supabase confere a validade da sessão pelo relógio; só na hora do pedido.
  await connection();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/entrar");

  // As regras do banco só devolvem restaurantes de que este usuário é membro.
  const { data: restaurants, error } = await supabase
    .from("restaurants")
    .select("id")
    .order("created_at");
  if (error) throw error;

  if (!restaurants.length) {
    const pending = user.user_metadata?.pending_restaurant as
      | { name?: string; slug?: string }
      | null
      | undefined;
    return (
      <section className="flex flex-col gap-4">
        <h1 className="text-2xl font-semibold">Crie seu restaurante</h1>
        <p className="text-sm opacity-70">Confira o nome e o endereço do cardápio.</p>
        <CreateRestaurantForm initialName={pending?.name} initialSlug={pending?.slug} />
      </section>
    );
  }

  // Com restaurante criado, o painel abre direto no cardápio.
  redirect("/painel/cardapio");
}
