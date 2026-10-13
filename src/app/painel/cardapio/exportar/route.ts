import * as db from "@/lib/db/nocodb";
import { tagLabel } from "@/lib/menu/tags";
import { currentRestaurant } from "../../current";

// Cardápio inteiro em CSV (abre no Excel e no Google Planilhas).
export async function GET() {
  const { restaurant: r } = await currentRestaurant("languages");
  type It = {
    category_id: string; name: string; description: string | null; price_cents: number; promo_price_cents: number | null;
    price_options: unknown; tags: string[] | null; active: boolean; featured: boolean;
  };
  const [cats, items] = await Promise.all([
    db.list<{ id: string; name: string; active: boolean }>("categories", { restaurant_id: r.id }, { sort: "position,Id" }),
    db.list<It>("items", { restaurant_id: r.id }, { sort: "position,Id" }),
  ]);
  const cell = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const price = (c: number | null) => (c == null ? "" : (c / 100).toFixed(2).replace(".", ","));
  const lines = [["Categoria", "Produto", "Descrição", "Preço", "Preço desconto", "Opções de preço", "Selos", "Destaque", "Visível"]];
  for (const c of cats) {
    for (const i of items.filter((x) => x.category_id === c.id)) {
      const opts = (i.price_options as { label: string; price_cents: number }[] | null) ?? [];
      lines.push([
        c.name,
        i.name,
        i.description ?? "",
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
