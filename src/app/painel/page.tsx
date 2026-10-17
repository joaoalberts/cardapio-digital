import type { Metadata } from "next";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { currentUserId } from "@/lib/auth";
import * as db from "@/lib/db/nocodb";
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
  await connection();
  const userId = await currentUserId();
  if (!userId) redirect("/entrar");

  const memberships = await db.list("members", { user_id: userId }, { limit: 1 });
  if (!memberships.length) {
    return (
      <section className="flex flex-col gap-4">
        <h1 className="text-2xl font-semibold">Crie seu restaurante</h1>
        <p className="text-sm opacity-70">Confira o nome e o endereço do cardápio.</p>
        <CreateRestaurantForm />
      </section>
    );
  }

  // Com restaurante criado, o painel abre na tela Agora (o que precisa de você neste momento).
  redirect("/painel/agora");
}
