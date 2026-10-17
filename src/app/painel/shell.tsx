import Link from "next/link";
import { Raleway } from "next/font/google";
import * as db from "@/lib/db/nocodb";
import { muxPending } from "@/lib/media-store";
import { ShellMenu, TopButton, VideoSync } from "./shell-menu";
import { ownerMenuHref } from "./menu-link";
import { pendingCount } from "./apareca/actions";
import { BOTTOM_NAV, MAIS_GROUPS, NAV_GROUPS, type NavItem } from "@/lib/painel/nav";

// Fonte do painel (a mesma família leve do DGuests); só o painel baixa.
const raleway = Raleway({ subsets: ["latin"], display: "swap", variable: "--f-panel" });

// Toda tela do painel que usa o shell. As do "Mais" acendem o botão Mais na barra de baixo do celular.
export type PanelHref =
  | "/painel/pedidos"
  | "/painel/agora"
  | "/painel/cardapio"
  | "/painel/especiais"
  | "/painel/aparencia"
  | "/painel/mesas"
  | "/painel/tvs"
  | "/painel/comunidade"
  | "/painel/apareca"
  | "/painel/perfil"
  | "/painel/suporte"
  | "/painel/mais";

export const OPEN_MENU_ICON = "M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 01-1 1H5a1 1 0 01-1-1V7a1 1 0 011-1h5";
const IN_MAIS = new Set<string>(["/painel/mais", ...MAIS_GROUPS.flatMap((g) => g.items.map((i) => i.href))]);

export async function PanelShell({
  restaurant,
  active,
  title,
  lead,
  children,
}: {
  restaurant: { id: string; name: string; slug: string; logo: string | null };
  active: PanelHref;
  title: string;
  lead?: string; // a linha "para que serve", sob o título (opcional: Produtos especiais ainda não tem)
  children: React.ReactNode;
}) {
  // Vídeos ainda em preparo no Mux (de prato, categoria ou banner): qualquer página do
  // painel confere até ficarem prontos.
  type Pending = { status: string | null; mux_mp4: string | null; mux_upload_id: string | null };
  const count = (await db.list<Pending>("media", { restaurant_id: restaurant.id })).filter(muxPending).length;
  // "Abrir cardápio" com "Pedir" e carrinho; pending = vídeos esperando aprovação (0 sem o Apareça ou em erro).
  const [newOrders, menuHref, pending] = await Promise.all([
    db.count("orders", { restaurant_id: restaurant.id, status: "new" }).catch(() => 0),
    ownerMenuHref(restaurant.id, restaurant.slug),
    pendingCount(restaurant.id),
  ]);
  const badge = (href: string) => (href === "/painel/pedidos" ? newOrders : href === "/painel/agora" ? pending : 0);
  const avatar = (
    // eslint-disable-next-line @next/next/no-img-element -- logo enviada pelo restaurante
    <i className="ap-avatar">{restaurant.logo ? <img src={restaurant.logo} alt="" /> : initials(restaurant.name)}</i>
  );
  return (
    <div className={`ap-app ${raleway.variable}`}>
      <aside>
        <div className="ap-brand">
          <b>C</b>ARDÁPIO
        </div>
        <ShellMenu name={restaurant.name} menuHref={menuHref} avatar={avatar} />
        <nav aria-label="Menu do painel">
          {NAV_GROUPS.map((g, i) => (
            <div key={g.title} className="ap-navgroup">
              <span className="ap-navtitle">{g.title}</span>
              {g.items.map((n) => (
                <SideLink key={n.href} item={n} on={n.href === active} badge={badge(n.href)} />
              ))}
              {/* "Abrir cardápio" fecha o grupo Conta: abre o cardápio público numa aba nova. */}
              {i === NAV_GROUPS.length - 1 && (
                <a href={menuHref} target="_blank" rel="noreferrer">
                  <svg className="icon" viewBox="0 0 24 24" aria-hidden>
                    <path d={OPEN_MENU_ICON} />
                  </svg>
                  Abrir cardápio
                </a>
              )}
            </div>
          ))}
        </nav>
      </aside>
      <div className="ap-main">
        <header className="ap-top">
          <h1>{title}</h1>
          {/* No celular a barra lateral some: o avatar (Editar Perfil, Ver cardápio, Suporte, Sair) vem para o topo. */}
          <div className="ap-top-rest">
            <ShellMenu name={restaurant.name} menuHref={menuHref} avatar={avatar} />
          </div>
        </header>
        <main>
          {lead && <p className="ap-purpose">{lead}</p>}
          {children}
        </main>
      </div>
      {/* Celular: 4 botões fixos embaixo. Mais fica aceso também nas telas que moram dentro dele. */}
      <nav className="ap-bottom" aria-label="Menu principal">
        {BOTTOM_NAV.map((n) => {
          const here = n.href === active;
          const on = n.href === "/painel/mais" ? IN_MAIS.has(active) : here;
          const count = badge(n.href);
          return (
            <Link key={n.href} href={n.href} className={on ? "on" : undefined} aria-current={here ? "page" : on ? "true" : undefined}>
              <svg className="icon" viewBox="0 0 24 24" aria-hidden>
                <path d={n.icon} />
              </svg>
              <span>{n.label}</span>
              {count > 0 && <span className="ap-badge">{count}</span>}
            </Link>
          );
        })}
      </nav>
      <TopButton />
      {!!count && <VideoSync restaurantId={restaurant.id} pending={count} />}
    </div>
  );
}

function SideLink({ item, on, badge }: { item: NavItem; on: boolean; badge: number }) {
  return (
    <Link href={item.href} className={on ? "on" : undefined} aria-current={on ? "page" : undefined}>
      <svg className="icon" viewBox="0 0 24 24" aria-hidden>
        <path d={item.icon} />
      </svg>
      {item.label}
      {badge > 0 && <span className="ap-badge">{badge}</span>}
    </Link>
  );
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
}
