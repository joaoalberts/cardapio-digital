"use client";

import { useEffect, useOptimistic, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { formatPrice } from "@/lib/menu/media";
import { createCategory, reorder, syncVideos } from "./actions";
import { CategoryModal, ItemModal } from "./modals";
import { LinkModal, SettingsModal } from "./menu-modals";

export type EditorTranslation = { language: string; name: string; description: string; auto: boolean };

export type EditorMedia = { kind: "photo" | "video"; url: string; thumb: string; status: "processing" | "ready" | "failed" } | null;

export type EditorItem = {
  id: string;
  categoryId: string;
  name: string;
  description: string;
  priceCents: number;
  promoCents: number | null;
  tags: string[];
  active: boolean;
  featured: boolean;
  hidePrice: boolean;
  serves: number | null;
  country: string | null;
  priceOptions: { label: string; priceCents: number }[] | null;
  media: EditorMedia;
  translations: EditorTranslation[];
};

export type EditorCategory = {
  id: string;
  name: string;
  active: boolean;
  description: string;
  availableFrom: string | null;
  availableTo: string | null;
  media: EditorMedia;
  translations: EditorTranslation[];
  items: EditorItem[];
};

export type EditorRestaurant = {
  id: string;
  name: string;
  slug: string;
  brandColor: string | null;
  wifiName: string | null;
  wifiPassword: string | null;
  isOwner: boolean;
};

export type EditorContext = {
  restaurantId: string;
  languages: string[];
  canTranslate: boolean;
  categories: EditorCategory[];
};

type Modal =
  | { kind: "item"; item: EditorItem | null; categoryId: string }
  | { kind: "category"; category: EditorCategory }
  | { kind: "link" }
  | { kind: "settings" }
  | null;

type Change = { type: "orderCats"; ids: string[] } | { type: "orderItems"; categoryId: string; ids: string[] };

function applyChange(cats: EditorCategory[], c: Change): EditorCategory[] {
  if (c.type === "orderCats") return c.ids.map((id) => cats.find((x) => x.id === id)!).filter(Boolean);
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

const FEATURED = "__destaques";

export function MenuEditor({
  restaurant,
  languages,
  canTranslate,
  categories,
}: {
  restaurant: EditorRestaurant;
  languages: string[];
  canTranslate: boolean;
  categories: EditorCategory[];
}) {
  const restaurantId = restaurant.id;
  const router = useRouter();
  const [cats, change] = useOptimistic(categories, applyChange);
  const [, startTransition] = useTransition();
  // Como no DGuests, as categorias começam fechadas; a seta laranja abre os produtos.
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const [modal, setModal] = useState<Modal>(null);
  const [ordering, setOrdering] = useState(false);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [help, setHelp] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  // Vídeos ainda em preparo no Mux: confere a cada poucos segundos até ficarem prontos.
  const preparing = categories.some(
    (c) => c.media?.status === "processing" || c.items.some((i) => i.media?.status === "processing"),
  );
  useEffect(() => {
    if (!preparing) return;
    const id = setInterval(async () => {
      const { pending } = await syncVideos(restaurantId);
      if (pending === 0) router.refresh();
    }, 6000);
    return () => clearInterval(id);
  }, [preparing, restaurantId, router]);

  const ctx: EditorContext = { restaurantId, languages, canTranslate, categories: cats };
  const featured = cats.flatMap((c) => c.items.filter((i) => i.featured));

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
    setOpen((s) => {
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

  const closeModal = (msg?: string) => {
    setModal(null);
    if (msg) flash(msg);
    router.refresh();
  };

  return (
    <div className="me">
      <section className="ap-card me-head">
        <div className="ap-card-head">
          <svg className="icon" viewBox="0 0 24 24" aria-hidden>
            <path d="M4 4h14l-7 8zM11 12v7M7 20h8M15 3.5c1-1.5 3.5-1.5 4.5 0" />
          </svg>
          <h2>Cardápio - {restaurant.name}</h2>
          <button className="ap-help" aria-label="Ajuda" aria-expanded={help} onClick={() => setHelp((h) => !h)}>
            ?
          </button>
        </div>
        {help && (
          <p className="me-help">
            Crie as categorias e, no <b className="g">+</b> de cada uma, os produtos. O lápis edita a categoria (foto ou
            vídeo do card, observação e horário). Toque num produto para editar. Tudo o que você salvar aparece no
            cardápio dos clientes na hora. Para mudar a ordem, use Configurações.
          </p>
        )}
        <div className="me-head-btns">
          <button className="btn primary" onClick={() => setModal({ kind: "link" })}>
            Acesse seu cardápio
          </button>
          <button className="btn outline" onClick={() => setModal({ kind: "settings" })}>
            Configurações
          </button>
        </div>
      </section>

      <form className="me-new" onSubmit={create}>
        <label htmlFor="me-new">Criar categoria</label>
        <div>
          <input
            id="me-new"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Ex: Cervejas"
            maxLength={60}
          />
          <button className="btn primary" disabled={!newName.trim() || creating}>
            {creating ? "Criando…" : "Criar"}
          </button>
        </div>
      </form>

      {ordering && (
        <div className="me-ordering" role="status">
          <span>Use as setas para mudar a ordem das categorias e dos produtos.</span>
          <button className="btn primary" onClick={() => setOrdering(false)}>
            Concluir
          </button>
        </div>
      )}

      <ul className="me-cats">
        {featured.length > 0 && (
          <li className={`me-cat${open.has(FEATURED) ? " open" : ""}`}>
            <div className="me-cat-row" onClick={() => toggle(FEATURED)}>
              <span className="me-star" aria-hidden>
                ★
              </span>
              <b className="me-cat-name">Destaques</b>
              <Count n={featured.length} />
              <Expand open={open.has(FEATURED)} label="Destaques" onClick={() => toggle(FEATURED)} />
            </div>
            {open.has(FEATURED) && (
              <ol className="me-items">
                {featured.map((it, ii) => (
                  <ItemRow key={it.id} item={it} n={ii + 1} onOpen={() => setModal({ kind: "item", item: it, categoryId: it.categoryId })} />
                ))}
              </ol>
            )}
          </li>
        )}

        {cats.map((c, ci) => {
          const isOpen = open.has(c.id);
          return (
            <li key={c.id} className={`me-cat${isOpen ? " open" : ""}`}>
              <div className="me-cat-row" onClick={() => toggle(c.id)}>
                <button
                  className="me-plus"
                  aria-label={`Novo produto em ${c.name}`}
                  title="Criar produto"
                  onClick={(e) => {
                    e.stopPropagation();
                    setModal({ kind: "item", item: null, categoryId: c.id });
                  }}
                >
                  +
                </button>
                <button
                  className="me-edit"
                  aria-label={`Editar ${c.name}`}
                  title="Editar categoria"
                  onClick={(e) => {
                    e.stopPropagation();
                    setModal({ kind: "category", category: c });
                  }}
                >
                  <Icon d={EDIT} />
                </button>
                <span className="me-cat-name">
                  {c.name}
                  {c.media?.status === "processing" && <em className="me-badge">preparando vídeo</em>}
                  {c.availableFrom && (
                    <em className="me-badge">
                      {c.availableFrom}–{c.availableTo}
                    </em>
                  )}
                </span>
                {!c.active && (
                  <span className="me-hidden" title="Categoria oculta">
                    <Icon d={EYE_OFF} />
                  </span>
                )}
                {ordering && (
                  <Arrows
                    label={c.name}
                    up={ci > 0 ? () => moveCat(ci, -1) : undefined}
                    down={ci < cats.length - 1 ? () => moveCat(ci, 1) : undefined}
                  />
                )}
                <Count n={c.items.length} />
                <Expand open={isOpen} label={c.name} onClick={() => toggle(c.id)} />
              </div>

              {isOpen && (
                <ol className="me-items">
                  {c.items.length === 0 && (
                    <li className="me-none">
                      Nenhum produto ainda.{" "}
                      <button onClick={() => setModal({ kind: "item", item: null, categoryId: c.id })}>Criar produto</button>
                    </li>
                  )}
                  {c.items.map((it, ii) => (
                    <ItemRow
                      key={it.id}
                      item={it}
                      n={ii + 1}
                      onOpen={() => setModal({ kind: "item", item: it, categoryId: c.id })}
                      arrows={
                        ordering && (
                          <Arrows
                            label={it.name}
                            up={ii > 0 ? () => moveItem(c, ii, -1) : undefined}
                            down={ii < c.items.length - 1 ? () => moveItem(c, ii, 1) : undefined}
                          />
                        )
                      }
                    />
                  ))}
                </ol>
              )}
            </li>
          );
        })}
      </ul>

      {cats.length === 0 && (
        <div className="me-empty">
          <b>Comece pelas categorias</b>
          <span>Por exemplo: Entradas, Pizzas, Bebidas, Sobremesas. Depois adicione os produtos em cada uma.</span>
        </div>
      )}

      {modal?.kind === "item" && (
        <ItemModal key={modal.item?.id ?? "new"} ctx={ctx} item={modal.item} categoryId={modal.categoryId} onClose={closeModal} />
      )}
      {modal?.kind === "category" && (
        <CategoryModal key={modal.category.id} ctx={ctx} category={modal.category} onClose={closeModal} />
      )}
      {modal?.kind === "link" && <LinkModal slug={restaurant.slug} onClose={() => setModal(null)} />}
      {modal?.kind === "settings" && (
        <SettingsModal
          restaurant={restaurant}
          onClose={closeModal}
          onOrder={() => {
            setModal(null);
            setOrdering(true);
            setOpen(new Set(cats.map((c) => c.id)));
          }}
        />
      )}
      {toast && (
        <div className="ap-toast" role="status">
          {toast}
        </div>
      )}
    </div>
  );
}

function ItemRow({ item: it, n, onOpen, arrows }: { item: EditorItem; n: number; onOpen: () => void; arrows?: React.ReactNode }) {
  const price = it.priceOptions?.length
    ? `${formatPrice(Math.min(...it.priceOptions.map((o) => o.priceCents)), "pt-BR")}+`
    : formatPrice(it.promoCents ?? it.priceCents, "pt-BR");
  return (
    <li className={`me-item${it.active ? "" : " off"}`}>
      <button className="me-item-main" onClick={onOpen}>
        <span className="me-num">{n}</span>
        <span className="me-item-txt">
          <b>{it.name}</b>
          {it.media?.kind === "video" && it.media.status === "processing" && <em className="me-badge">preparando vídeo</em>}
          {it.media?.status === "failed" && <em className="me-badge bad">vídeo com erro</em>}
          {it.translations.some((t) => t.auto) && <em className="me-badge">tradução a revisar</em>}
        </span>
        {it.media && (
          <span className="me-has" title={it.media.kind === "video" ? "Tem vídeo" : "Tem foto"}>
            <Icon d={it.media.kind === "video" ? VIDEO : CAMERA} />
          </span>
        )}
        {!it.active && (
          <span className="me-hidden" title="Produto oculto">
            <Icon d={EYE_OFF} />
          </span>
        )}
        <span className={`me-price${it.hidePrice ? " muted" : ""}`} title={it.hidePrice ? "Preço oculto no cardápio" : undefined}>
          <Icon d={MONEY} />
          {it.promoCents != null && !it.priceOptions && <s>{formatPrice(it.priceCents, "pt-BR")}</s>}
          {price}
        </span>
      </button>
      {arrows}
    </li>
  );
}

function Count({ n }: { n: number }) {
  return (
    <span className="me-count" title={`${n} ${n === 1 ? "produto" : "produtos"}`}>
      <Icon d={GLASS} />
      {n}
    </span>
  );
}

function Expand({ open, label, onClick }: { open: boolean; label: string; onClick: () => void }) {
  return (
    <button
      className="me-expand"
      aria-expanded={open}
      aria-label={open ? `Fechar ${label}` : `Abrir ${label}`}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      <svg viewBox="0 0 24 24" aria-hidden>
        <circle cx="12" cy="12" r="10" />
        <path d={open ? "M8 14l4-4 4 4" : "M8 10l4 4 4-4"} />
      </svg>
    </button>
  );
}

function Arrows({ label, up, down }: { label: string; up?: () => void; down?: () => void }) {
  return (
    <span className="me-arrows" onClick={(e) => e.stopPropagation()}>
      <button className="me-icon" aria-label={`Subir ${label}`} disabled={!up} onClick={up}>
        <Icon d="M6 15l6-6 6 6" />
      </button>
      <button className="me-icon" aria-label={`Descer ${label}`} disabled={!down} onClick={down}>
        <Icon d="M6 9l6 6 6-6" />
      </button>
    </span>
  );
}

export const EYE_OFF = "M3 3l18 18M10.6 5.1A10 10 0 0112 5c6.5 0 10 7 10 7a17 17 0 01-3.2 4.2M6.6 6.6A17 17 0 002 12s3.5 7 10 7a9.7 9.7 0 005.4-1.6M9.9 9.9a3 3 0 004.2 4.2";
export const EDIT = "M11 4H5a1 1 0 00-1 1v14a1 1 0 001 1h14a1 1 0 001-1v-6M18.5 2.5a2.1 2.1 0 013 3L12 15l-4 1 1-4z";
export const CAMERA = "M4 8h3l2-3h6l2 3h3v11H4zM12 17a4 4 0 100-8 4 4 0 000 8z";
const VIDEO = "M3 6h12v12H3zM15 10l6-3v10l-6-3";
const MONEY = "M2 6h20v12H2zM12 15a3 3 0 100-6 3 3 0 000 6zM6 9v.01M18 15v.01";
const GLASS = "M6 3h12l-1 6a5 5 0 01-10 0zM12 14v6M8 21h8M16 4l3-2";

export function Icon({ d }: { d: string }) {
  return (
    <svg className="icon" viewBox="0 0 24 24" aria-hidden>
      <path d={d} />
    </svg>
  );
}
