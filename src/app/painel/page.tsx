import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { CreateRestaurantForm } from "./create-restaurant-form";
import { signOut } from "./actions";

export const metadata: Metadata = { title: "Painel" };

const statusLabel: Record<string, string> = {
  trial: "Em teste",
  active: "Ativa",
  past_due: "Pagamento pendente",
  canceled: "Cancelada",
};

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
    .select("id, name, slug, subscription_status, trial_ends_at")
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

  return (
    <section className="flex flex-col gap-4">
      {restaurants.map((r) => (
        <article
          key={r.id}
          className="flex flex-col gap-1 rounded-xl border border-black/10 p-5 dark:border-white/15"
        >
          <h1 className="text-2xl font-semibold">{r.name}</h1>
          <p className="text-sm opacity-70">
            Link do cardápio:{" "}
            <a className="underline" href={`/${r.slug}`} target="_blank" rel="noreferrer">
              /{r.slug}
            </a>
          </p>
          <p className="text-sm opacity-70">
            Assinatura: {statusLabel[r.subscription_status] ?? r.subscription_status}
            {r.subscription_status === "trial" &&
              ` até ${new Date(r.trial_ends_at).toLocaleDateString("pt-BR")}`}
          </p>
        </article>
      ))}
      <Link href="/painel/perfil" className="text-sm underline">
        Logo e horário de funcionamento
      </Link>
      <Link href="/painel/aparencia" className="text-sm underline">
        Escolher a fonte do cardápio
      </Link>
      <p className="text-sm opacity-60">Categorias, itens e mídia chegam nas próximas etapas.</p>
    </section>
  );
}
