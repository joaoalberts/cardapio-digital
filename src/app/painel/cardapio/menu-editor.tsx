"use client";
/* eslint-disable @next/next/no-img-element -- miniaturas enviadas pelo restaurante */

import { useOptimistic, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { formatPrice } from "@/lib/menu/media";
import { createCategory, reorder, updateCategory } from "./actions";
import { CategoryDrawer, ItemDrawer } from "./drawers";

export type EditorTranslation = { language: string; name: string; description: string; auto: boolean };

export type EditorItem = {
  id: string;
  categoryId: string;
  name: string;
  description: string;
  priceCents: number;
  promoCents: number | null;
  tags: string[];
  active: boolean;
  photo: { url: string; thumb: string } | null;
  translations: EditorTranslation[];
};

export type EditorCategory = {
  id: string;
  name: string;
  active: boolean;
  translations: EditorTranslation[];
  items: EditorItem[];
};

export type EditorContext = {
  restaurantId: string;
  languages: string[];
  canTranslate: boolean;
  categories: EditorCategory[];
};

type Drawer =
  | { kind: "item"; item: EditorItem | null; categoryId: string }
  | { kind: "category"; category: EditorCategory }
  | null;

type Change =
  | { type: "orderCats"; ids: string[] }
  | { type: "orderItems"; categoryId: string; ids: string[] }
  | { type: "catActive"; id: string; active: boolean };

function applyChange(cats: EditorCategory[], c: Change): EditorCategory[] {
  if (c.type === "orderCats") return c.ids.map((id) => cats.find((x) => x.id === id)!).filter(Boolean);
  if (c.type === "catActive") return cats.map((x) => (x.id === c.id ? { ...x, active: c.active } : x));
  return cats.map((x) =>
    x.id === c.categoryId ? { ...x, items: c.ids.map((id) => x.items.find((i) => i.id === id)!).filter(Boolean) } : x,
  );
}

const move = <T,>(arr: T[], from: number, to: number) => {
  const a = [...arr];
  const [x] = a.splice(from, 1);
  a.splice(to, 0, x);
  return a;
};

export function MenuEditor({
  restaurantId,
  slug,
  languages,
  canTranslate,
  categories,
}: {
  restaurantId: string;
  slug: string;
  languages: string[];
  canTranslate: boolean;
  categories: EditorCategory[];
}) {
  const router = useRouter();
  const [cats, change] = useOptimistic(categories, applyChange);
  const [, startTransition] = useTransition();
  // Todas abertas no início; o dono fecha as que não está mexendo.
  const [closed, setClosed] = useState<Set<string>>(() => new Set());
  const [drawer, setDrawer] = useState<Drawer>(null);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const ctx: EditorContext = { restaurantId, languages, canTranslate, categories: cats };

  const flash = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast((t) => (t === msg ? null : t)), 2600);
  };

  const run = (c: Change, action: () => Promise<{ error?: string }>) =>
    startTransition(async () => {
      change(c);
      const res = await action();
      if (res.error) flash(res.error);
      router.refresh();
    });

  const toggle = (id: string) =>
    setClosed((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const moveCat = (i: number, d: number) => {
    const ids = move(cats.map((c) => c.id), i, i + d);
    run({ type: "orderCats", ids }, () => reorder(restaurantId, "categories", ids));
  };

  const moveItem = (c: EditorCategory, i: number, d: number) => {
    const ids = move(c.items.map((x) => x.id), i, i + d);
    run({ type: "orderItems", categoryId: c.id, ids }, () => reorder(restaurantId, "items", ids));
  };

  const toggleCat = (c: EditorCategory) =>
    run({ type: "catActive", id: c.id, active: !c.active }, () =>
      updateCategory(restaurantId, c.id, { name: c.name, active: !c.active }),
    );

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim() || creating) return;
    setCreating(true);
    const res = await createCategory(restaurantId, newName);
    setCreating(false);
    if (res.error) return flash(res.error);
    setNewName("");
    router.refresh();
  };

  const closeDrawer = (msg?: string) => {
    setDrawer(null);
    if (msg) flash(msg);
    router.refresh();
  };

  return (
    <div className="me">
      <div className="me-top">
        <form className="me-new" onSubmit={create}>
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Nova categoria, ex.: Bebidas"
            maxLength={60}
            aria-label="Nome da nova categoria"
          />
          <button className="btn primary" disabled={!newName.trim() || creating}>
            {creating ? "Criando…" : "Criar categoria"}
          </button>
        </form>
        <a className="btn ghost me-open" href={`/${slug}`} target="_blank" rel="noreferrer">
          Ver cardápio
        </a>
      </div>

      {cats.length === 0 && (
        <div className="me-empty">
          <b>Comece pelas categorias</b>
          <span>Por exemplo: Entradas, Pizzas, Bebidas, Sobremesas. Depois adicione os pratos em cada uma.</span>
        </div>
      )}

      <ul className="me-cats">
        {cats.map((c, ci) => {
          const isOpen = !closed.has(c.id);
          return (
            <li key={c.id} className={`me-cat${c.active ? "" : " off"}`}>
              <div className="me-cat-row">
                <button className="me-chev" aria-expanded={isOpen} aria-label={isOpen ? "Fechar" : "Abrir"} onClick={() => toggle(c.id)}>
                  <Icon d={isOpen ? "M6 9l6 6 6-6" : "M9 6l6 6-6 6"} />
                </button>
                <button className="me-cat-name" onClick={() => toggle(c.id)}>
                  <b>{c.name}</b>
                  <span>
                    {c.items.length} {c.items.length === 1 ? "prato" : "pratos"}
                    {!c.active && " · escondida"}
                  </span>
                </button>
                <div className="me-tools">
                  <Arrows
                    label={c.name}
                    up={ci > 0 ? () => moveCat(ci, -1) : undefined}
                    down={ci < cats.length - 1 ? () => moveCat(ci, 1) : undefined}
                  />
                  <button
                    className="me-icon"
                    aria-label={c.active ? `Esconder ${c.name}` : `Mostrar ${c.name}`}
                    title={c.active ? "Esconder do cardápio" : "Mostrar no cardápio"}
                    onClick={() => toggleCat(c)}
                  >
                    <Icon d={c.active ? EYE : EYE_OFF} />
                  </button>
                  <button className="me-icon" aria-label={`Editar ${c.name}`} title="Editar categoria" onClick={() => setDrawer({ kind: "category", category: c })}>
                    <Icon d={PENCIL} />
                  </button>
                  <button className="btn small" onClick={() => setDrawer({ kind: "item", item: null, categoryId: c.id })}>
                    + Prato
                  </button>
                </div>
              </div>

              {isOpen && (
                <ol className="me-items">
                  {c.items.length === 0 && <li className="me-none">Nenhum prato ainda.</li>}
                  {c.items.map((it, ii) => (
                    <li key={it.id} className={`me-item${it.active ? "" : " off"}`}>
                      <button className="me-item-main" onClick={() => setDrawer({ kind: "item", item: it, categoryId: c.id })}>
                        {it.photo ? <img src={it.photo.thumb} alt="" /> : <span className="me-noimg"><Icon d={CAMERA} /></span>}
                        <span className="me-item-txt">
                          <b>{it.name}</b>
                          <span>
                            {!it.active && <em className="me-badge">escondido</em>}
                            {it.translations.some((t) => t.auto) && <em className="me-badge gold">tradução a revisar</em>}
                            {it.description}
                          </span>
                        </span>
                        <span className="me-price">
                          {it.promoCents != null && <s>{formatPrice(it.priceCents, "pt-BR")}</s>}
                          {formatPrice(it.promoCents ?? it.priceCents, "pt-BR")}
                        </span>
                      </button>
                      <Arrows
                        label={it.name}
                        up={ii > 0 ? () => moveItem(c, ii, -1) : undefined}
                        down={ii < c.items.length - 1 ? () => moveItem(c, ii, 1) : undefined}
                      />
                    </li>
                  ))}
                </ol>
              )}
            </li>
          );
        })}
      </ul>

      {drawer?.kind === "item" && (
        <ItemDrawer key={drawer.item?.id ?? "new"} ctx={ctx} item={drawer.item} categoryId={drawer.categoryId} onClose={closeDrawer} />
      )}
      {drawer?.kind === "category" && (
        <CategoryDrawer key={drawer.category.id} ctx={ctx} category={drawer.category} onClose={closeDrawer} />
      )}
      {toast && (
        <div className="ap-toast" role="status">
          {toast}
        </div>
      )}
    </div>
  );
}

function Arrows({ label, up, down }: { label: string; up?: () => void; down?: () => void }) {
  return (
    <span className="me-arrows">
      <button className="me-icon" aria-label={`Subir ${label}`} disabled={!up} onClick={up}>
        <Icon d="M6 15l6-6 6 6" />
      </button>
      <button className="me-icon" aria-label={`Descer ${label}`} disabled={!down} onClick={down}>
        <Icon d="M6 9l6 6 6-6" />
      </button>
    </span>
  );
}

export const EYE = "M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12zM12 15a3 3 0 100-6 3 3 0 000 6z";
export const EYE_OFF = "M3 3l18 18M10.6 5.1A10 10 0 0112 5c6.5 0 10 7 10 7a17 17 0 01-3.2 4.2M6.6 6.6A17 17 0 002 12s3.5 7 10 7a9.7 9.7 0 005.4-1.6M9.9 9.9a3 3 0 004.2 4.2";
export const PENCIL = "M4 20h4L19 9a2.8 2.8 0 00-4-4L4 16v4zM13.5 6.5l4 4";
export const CAMERA = "M4 8h3l2-3h6l2 3h3v11H4zM12 17a4 4 0 100-8 4 4 0 000 8z";

export function Icon({ d }: { d: string }) {
  return (
    <svg className="icon" viewBox="0 0 24 24" aria-hidden>
      <path d={d} />
    </svg>
  );
}
