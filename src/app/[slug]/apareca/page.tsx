import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense, type CSSProperties, type ReactNode } from "react";
import { publicHead } from "@/lib/apareca/submit";
import { routeDeps } from "@/lib/apareca/submit-server";
import { getPublicMenu, getTableLabel } from "@/lib/menu/data";
import { fontVariables } from "@/lib/menu/fonts";
import { DEFAULT_FONT_THEME, isFontTheme } from "@/lib/menu/font-themes";
import { mediaUrl } from "@/lib/menu/media";
import { isValidSlug } from "@/lib/slug";
import { AparecaApp } from "./apareca-app";
import "@/styles/font-themes.css";
import "./apareca.css";

// "Apareça na TV!": a página do cliente, aberta pelo convite do cardápio (/<slug>/apareca?mesa=CODE).
// O servidor confere o restaurante, o recurso, a mesa, o horário e o teto; a gravação e o envio
// acontecem no celular (apareca-app.tsx). Com o recurso desligado a página não existe (404).

const CODE = /^[A-Z2-9]{6}$/;

export const viewport: Viewport = { themeColor: "#0b0a09", viewportFit: "cover", width: "device-width", initialScale: 1 };

export const metadata: Metadata = { title: "Apareça na TV", robots: { index: false, follow: false } };

export default function AparecaPage({ params, searchParams }: PageProps<"/[slug]/apareca">) {
  return (
    <Suspense fallback={<div className="apa apa-boot" aria-busy="true" />}>
      <Apareca params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function Apareca({
  params,
  searchParams,
}: {
  params: PageProps<"/[slug]/apareca">["params"];
  searchParams: PageProps<"/[slug]/apareca">["searchParams"];
}) {
  await connection();
  const slug = (await params).slug.toLowerCase();
  if (!isValidSlug(slug)) notFound();
  const h = await headers();
  const [menu, head] = await Promise.all([
    getPublicMenu(slug),
    publicHead(routeDeps(new Request(`https://${slug}.apareca.local/`, { headers: h })), slug).catch(() => null),
  ]);
  if (!menu || !head) notFound();
  // Desligado (geral, pelo super admin, ou pelo dono): para o cliente, não existe.
  if (!head.enabled) notFound();

  const r = menu.restaurant;
  const shell = (children: ReactNode) => (
    <div className={fontVariables}>
      <div
        className="apa"
        data-font={isFontTheme(r.font_theme) ? r.font_theme : DEFAULT_FONT_THEME}
        style={{ "--accent": r.brand_color ?? undefined } as CSSProperties}
      >
        {children}
      </div>
    </div>
  );
  const logo = mediaUrl(r.logo_path);

  const raw = (await searchParams).mesa;
  const code = typeof raw === "string" ? raw.trim().toUpperCase() : "";
  const label = CODE.test(code) ? await getTableLabel(slug, code) : null;
  const back = `/${slug}${label ? `?mesa=${code}` : ""}`;

  if (!label) return shell(<Notice logo={logo} name={r.name} back={back} title="Leia o QR da sua mesa para participar" text="O QR Code fica na mesa. Aponte a câmera do celular para ele e toque no convite “Apareça na TV!”." />);
  if (head.why === "closed") return shell(<Notice logo={logo} name={r.name} back={back} title="Volte durante nosso horário" text="Os vídeos para a TV só podem ser enviados com a casa aberta." />);
  if (head.why === "paused" || !head.open) return shell(<Notice logo={logo} name={r.name} back={back} title="Os envios estão pausados por agora" text="Tente de novo daqui a pouco." />);

  return shell(<AparecaApp slug={slug} mesa={code} mesaLabel={label} name={r.name} logo={logo} back={back} />);
}

function Notice({ logo, name, back, title, text }: { logo: string | null; name: string; back: string; title: string; text: string }) {
  return (
    <main className="apa-page apa-notice">
      <header className="apa-top">
        <a className="apa-back" href={back} aria-label="Voltar ao cardápio">
          <svg viewBox="0 0 24 24" className="apa-ic" aria-hidden>
            <path d="M15 5l-7 7 7 7" />
          </svg>
        </a>
        <span className="apa-house">
          {logo && (
            // eslint-disable-next-line @next/next/no-img-element -- logo pequena, já no tamanho certo
            <img src={logo} alt="" />
          )}
          <span>{name}</span>
        </span>
      </header>
      <section className="apa-card apa-notice-card">
        <h1 className="fd">{title}</h1>
        <p>{text}</p>
        <a className="apa-btn apa-btn-2" href={back}>
          Voltar ao cardápio
        </a>
      </section>
    </main>
  );
}
