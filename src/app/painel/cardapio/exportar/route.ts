import { createClient } from "@/lib/supabase/server";
import { tagLabel } from "@/lib/menu/tags";
import { currentRestaurant } from "../../current";

// Cardápio inteiro em CSV (abre no Excel e no Google Planilhas).
export async function GET() {
  const { restaurant: r } = await currentRestaurant("languages");
  const supabase = await createClient();
  const [cats, items] = await Promise.all([
    supabase.from("categories").select("id, name, active").eq("restaurant_id", r.id).order("position").order("created_at"),
    supabase
      .from("items")
      .select("category_id, name, description, price_cents, promo_price_cents, price_options, tags, active, featured")
      .eq("restaurant_id", r.id)
      .order("position")
      .order("created_at"),
  ]);
  const cell = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const price = (c: number | null) => (c == null ? "" : (c / 100).toFixed(2).replace(".", ","));
  const lines = [["Categoria", "Produto", "Descrição", "Preço", "Preço desconto", "Opções de preço", "Selos", "Destaque", "Visível"]];
  for (const c of cats.data ?? []) {
    for (const i of (items.data ?? []).filter((x) => x.category_id === c.id)) {
      const opts = (i.price_options as { label: string; price_cents: number }[] | null) ?? [];
      lines.push([
        c.name,
        i.name,
        i.description,
        price(i.price_cents),
        price(i.promo_price_cents),
        opts.map((o) => `${o.label}: ${price(o.price_cents)}`).join(" | "),
        (i.tags ?? []).map((t: string) => tagLabel(t)).join(", "),
        i.featured ? "sim" : "não",
        c.active && i.active ? "sim" : "não",
      ]);
    }
  }
  // BOM para o Excel reconhecer os acentos; ";" porque é o separador do Excel em português.
  const body = "﻿" + lines.map((l) => l.map(cell).join(";")).join("\r\n");
  return new Response(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="cardapio-${r.slug}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
