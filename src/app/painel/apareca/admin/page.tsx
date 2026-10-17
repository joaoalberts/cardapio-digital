import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { currentUser } from "@/lib/auth";
import * as db from "@/lib/db/nocodb";
import { estimateUsd, tetoUsd, uploadGate } from "@/lib/apareca/cost";
import { deleteMuxAsset } from "@/lib/apareca/mux-video";
import { monthUsage } from "@/lib/apareca/store";
import { adminRows, isSuperAdmin } from "@/lib/apareca/superadmin";
import { Liberacao } from "./liberacao";
import "../../panel.css";
import "../apareca.css";

// Super admin do Apareça (T17): o João libera o recurso e a IA por restaurante e acompanha o gasto
// do Mux. Sem item no menu do painel. Quem não está em SUPERADMIN_EMAILS recebe 404 de verdade:
// a conferência roda antes de qualquer Suspense (instant = false deixa a rota esperar a sessão),
// então a resposta não começa com 200 e não revela que a página existe.

export const instant = false;

export default async function AdminPage() {
  await connection();
  const user = await currentUser().catch(() => null);
  if (!isSuperAdmin(user?.email, process.env.SUPERADMIN_EMAILS)) notFound();
  return (
    <div className="ap">
      <main className="app-setup app-admin">
        <header className="app-adm-top">
          <Link href="/painel/apareca">Voltar ao painel</Link>
          <h1>Apareça na TV: liberação</h1>
        </header>
        <Suspense fallback={<div className="ap-loading" />}>
          <Admin />
        </Suspense>
      </main>
    </div>
  );
}

const WARN_TEXT = {
  warn: "O uso do Mux deste mês passou de 75%.",
  paused: "Envios pausados: o teto do Mux está perto.",
} as const;

// Mês do teto no fuso de Brasília, como no painel e nas rotas do cliente.
const monthOf = (now: Date) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit" }).format(now);
const usd = (n: number) => n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const min = (n: number) => n.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

type Raw = Record<string, unknown>;

async function Admin() {
  const now = new Date();
  const month = monthOf(now);
  const [restaurants, videos, tallies, houses, usage] = await Promise.all([
    db.list<Raw>("restaurants"),
    db.list<Raw>("apareca_videos"),
    db.list<Raw>("apareca_tally", { month }),
    db.list<Raw>("apareca_house_videos"),
    monthUsage({ db, mux: { deleteAsset: deleteMuxAsset } }, month).catch(() => null),
  ]);
  const rows = adminRows({ month, now, restaurants, videos, tallies, houses });
  const teto = tetoUsd(process.env.APARECA_TETO_USD);
  const spent = usage ? estimateUsd(usage) : null;
  const gate = spent === null ? null : uploadGate(spent, teto);
  const pct = spent === null ? 0 : Math.min(100, Math.round((spent / teto) * 100));

  return (
    <>
      <section className="ap-card" aria-labelledby="app-adm-cost">
        <div className="ap-card-head">
          <h2 id="app-adm-cost">Gasto do Mux neste mês</h2>
        </div>
        {spent === null ? (
          <p className="app-band app-band-off" role="status">
            Não foi possível ler o uso do Mux agora. Recarregue a página.
          </p>
        ) : (
          <>
            {gate !== "ok" && gate !== null && (
              <p className={`app-band ${gate === "paused" ? "app-band-stop" : "app-band-off"}`} role="status">
                {WARN_TEXT[gate]}
              </p>
            )}
            <p className="app-adm-usd">
              <b>US$ {usd(spent)}</b> de US$ {usd(teto)} ({pct}%)
            </p>
            <div className="app-adm-meter" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label="Uso do teto do Mux">
              <i style={{ transform: `scaleX(${pct / 100})` }} data-gate={gate ?? "ok"} />
            </div>
            <small className="app-small">
              Estimativa de todas as casas juntas (o teto é da conta do Mux). Aviso no painel a partir de 75%; envios pausados a partir de 90%.
            </small>
          </>
        )}
      </section>

      <section className="ap-card" aria-labelledby="app-adm-list">
        <div className="ap-card-head">
          <h2 id="app-adm-list">Restaurantes</h2>
        </div>
        {rows.length === 0 ? (
          <p className="app-empty">Nenhum restaurante cadastrado.</p>
        ) : (
          <ul className="app-adm-list">
            {rows.map((r) => (
              <li key={r.id}>
                <div className="app-adm-name" id={`app-adm-name-${r.id}`}>
                  <b>{r.name}</b>
                  <small>/{r.slug}</small>
                </div>
                <Liberacao rid={r.id} allowed={r.allowed} aiAllowed={r.ai_allowed} />
                <dl className="app-adm-facts">
                  <div>
                    <dt>Ligado pelo dono</dt>
                    <dd>{r.enabled ? "Sim" : "Não"}</dd>
                  </div>
                  <div>
                    <dt>Vídeos guardados agora</dt>
                    <dd>{r.stored_now}</dd>
                  </div>
                  <div>
                    <dt>Minutos no Mux no mês</dt>
                    <dd>{min(r.mux_min_month)}</dd>
                  </div>
                </dl>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
