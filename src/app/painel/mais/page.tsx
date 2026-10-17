import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { mediaUrl } from "@/lib/menu/media";
import { MAIS_GROUPS } from "@/lib/painel/nav";
import { signOut } from "../actions";
import { currentRestaurant } from "../current";
import { ownerMenuHref } from "../menu-link";
import { OPEN_MENU_ICON, PanelShell } from "../shell";
import "../panel.css";
import "./mais.css";

export const metadata: Metadata = { title: "Mais" };

// "Mais" do celular: tudo o que não cabe nos 4 botões de baixo, em grupos. No computador mostra a mesma lista.

export default function MaisPage() {
  return (
    <div className="ap">
      <Suspense fallback={<div className="ap-loading" />}>
        <Mais />
      </Suspense>
    </div>
  );
}

async function Mais() {
  const { restaurant } = await currentRestaurant();
  const r = restaurant as typeof restaurant & { logo_path: string | null };
  const menuHref = await ownerMenuHref(r.id, r.slug); // o mesmo "Abrir cardápio" do menu, com "Pedir" e carrinho
  const last = MAIS_GROUPS.length - 1;
  return (
    <PanelShell restaurant={{ id: r.id, name: r.name, slug: r.slug, logo: mediaUrl(r.logo_path) }} active="/painel/mais" title="Mais">
      {MAIS_GROUPS.map((g, i) => (
        <section key={g.title} className="mx-group" aria-labelledby={`mx-${i}`}>
          <h2 id={`mx-${i}`}>{g.title}</h2>
          <ul>
            {g.items.map((n) => (
              <li key={n.href}>
                <Link href={n.href}>
                  <Icon d={n.icon} />
                  <span>{n.label}</span>
                  <Chevron />
                </Link>
              </li>
            ))}
            {/* Conta fecha com "Abrir cardápio" (aba nova) e "Sair". */}
            {i === last && (
              <>
                <li>
                  <a href={menuHref} target="_blank" rel="noreferrer">
                    <Icon d={OPEN_MENU_ICON} />
                    <span>Abrir cardápio</span>
                    <Chevron />
                  </a>
                </li>
                <li>
                  <form action={signOut}>
                    <button>
                      <Icon d="M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10" />
                      <span>Sair</span>
                    </button>
                  </form>
                </li>
              </>
            )}
          </ul>
        </section>
      ))}
    </PanelShell>
  );
}

function Icon({ d }: { d: string }) {
  return (
    <svg className="icon" viewBox="0 0 24 24" aria-hidden>
      <path d={d} />
    </svg>
  );
}

function Chevron() {
  return (
    <svg className="icon mx-go" viewBox="0 0 24 24" aria-hidden>
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}
