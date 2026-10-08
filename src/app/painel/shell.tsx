import Link from "next/link";
import { Raleway } from "next/font/google";
import { MUX_PENDING } from "@/lib/media-store";
import { createClient } from "@/lib/supabase/server";
import { ShellMenu, TopButton, VideoSync } from "./shell-menu";

// Fonte do painel (a mesma família leve do DGuests); só o painel baixa.
const raleway = Raleway({ subsets: ["latin"], display: "swap", variable: "--f-panel" });

const NAV = [
  { href: "/painel/cardapio", label: "Cardápio", icon: "M7 3v8M5 3v5a2 2 0 004 0V3M7 11v10M17 3c-2 0-3 2-3 5s1 4 3 4v9" },
  { href: "/painel/aparencia", label: "Aparência", icon: "M12 3a9 9 0 100 18c1 0 1.5-.7 1.5-1.5 0-1.2-1-1.6-1-2.6 0-.8.7-1.4 1.5-1.4H16a5 5 0 005-5c0-4-4-7.5-9-7.5zM7.5 12a1 1 0 100-2 1 1 0 000 2zM10.5 8a1 1 0 100-2 1 1 0 000 2zM15 8a1 1 0 100-2 1 1 0 000 2z" },
  { href: "/painel/perfil", label: "Editar Perfil", icon: "M10 12a4 4 0 100-8 4 4 0 000 8zM3 21c0-4 3.1-7 7-7 1.3 0 2.5.3 3.5.9M17.5 14.5l3 3-4.5 4.5h-3v-3z" },
  { href: "/painel/suporte", label: "Suporte", icon: "M4 6h16v12H4zM4 7l8 6 8-6" },
] as const;

export type PanelHref = (typeof NAV)[number]["href"];

export async function PanelShell({
  restaurant,
  active,
  title,
  children,
}: {
  restaurant: { id: string; name: string; slug: string; logo: string | null };
  active: PanelHref;
  title: string;
  children: React.ReactNode;
}) {
  // Vídeos ainda em preparo no Mux (de prato, categoria ou banner): qualquer página do
  // painel confere até ficarem prontos.
  const supabase = await createClient();
  const { count } = await supabase
    .from("media")
    .select("id", { count: "exact", head: true })
    .eq("restaurant_id", restaurant.id)
    .or(MUX_PENDING)
    .not("mux_upload_id", "is", null);
  return (
    <div className={`ap-app ${raleway.variable}`}>
      <aside>
        <div className="ap-brand">
          <b>C</b>ARDÁPIO
        </div>
        <ShellMenu
          name={restaurant.name}
          slug={restaurant.slug}
          avatar={
            // eslint-disable-next-line @next/next/no-img-element -- logo enviada pelo restaurante
            <i className="ap-avatar">{restaurant.logo ? <img src={restaurant.logo} alt="" /> : initials(restaurant.name)}</i>
          }
        />
        <nav>
          {NAV.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className={n.href === active ? "on" : undefined}
              aria-current={n.href === active ? "page" : undefined}
            >
              <svg className="icon" viewBox="0 0 24 24" aria-hidden>
                <path d={n.icon} />
              </svg>
              {n.label}
            </Link>
          ))}
          <a href={`/${restaurant.slug}`} target="_blank" rel="noreferrer">
            <svg className="icon" viewBox="0 0 24 24" aria-hidden>
              <path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 01-1 1H5a1 1 0 01-1-1V7a1 1 0 011-1h5" />
            </svg>
            Abrir cardápio
          </a>
        </nav>
      </aside>
      <div className="ap-main">
        <header className="ap-top">
          <h1>{title}</h1>
        </header>
        <main>{children}</main>
      </div>
      <TopButton />
      {!!count && <VideoSync restaurantId={restaurant.id} pending={count} />}
    </div>
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
