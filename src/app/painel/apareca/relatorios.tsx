"use client";

import { useState, useTransition } from "react";
import { loadReport, type ReportResult } from "./actions";

// Relatórios do Apareça: 7 ou 30 dias. Barras em CSS (sem biblioteca), cada barra com o número escrito ao lado.
// O tempo dos institucionais aparece à parte e nunca entra nos números de clientes.

const LOAD_FAIL = "Não foi possível carregar o relatório. Confira a internet.";
const nf = new Intl.NumberFormat("pt-BR");
const n = (v: number) => nf.format(Math.round(v));
const dayLabel = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
const plural = (v: number, one: string, many: string) => `${n(v)} ${v === 1 ? one : many}`;

function minutes(s: number) {
  const m = Math.round(s / 60);
  return m < 1 ? `${Math.round(s)} s` : `${n(m)} min`;
}

export function Relatorios({ rid, initial }: { rid: string; initial: ReportResult | null }) {
  const [data, setData] = useState<ReportResult | null>(initial);
  const [range, setRange] = useState<7 | 30>(initial?.range ?? 7);
  const [msg, setMsg] = useState<string | null>(initial ? null : LOAD_FAIL);
  const [loading, start] = useTransition();

  const pick = (r: 7 | 30) => {
    if (r === range && data) return;
    setRange(r);
    start(async () => {
      try {
        setData(await loadReport(rid, r));
        setMsg(null);
      } catch {
        setMsg(LOAD_FAIL);
      }
    });
  };

  const maxDay = Math.max(1, ...(data?.days.map((d) => d.sent) ?? [1]));
  const maxHour = Math.max(1, ...(data?.hours ?? [1]));
  const peak = data ? data.hours.reduce((best, v, h) => (v > data.hours[best] ? h : best), 0) : 0;
  const t = data?.totals;

  return (
    <section className="ap-card app-rep" aria-labelledby="app-h-rep" aria-busy={loading}>
      <div className="ap-card-head">
        <h2 id="app-h-rep">Relatórios</h2>
      </div>
      <div className="app-rep-tabs" role="group" aria-label="Período">
        {([7, 30] as const).map((r) => (
          <button key={r} type="button" aria-pressed={range === r} onClick={() => pick(r)}>
            {r} dias
          </button>
        ))}
      </div>
      {msg && (
        <p className="app-msg" role="alert">
          {msg}
        </p>
      )}

      {data && t && (
        <div className="app-rep-body" data-loading={loading ? "1" : undefined}>
          <ul className="app-rep-tiles">
            <li><b>{n(t.sent)}</b><span>enviados</span></li>
            <li><b>{n(t.approved)}</b><span>aprovados</span></li>
            <li><b>{n(t.rejected)}</b><span>reprovados{t.ai_rejected > 0 ? ` (${n(t.ai_rejected)} pela IA)` : ""}</span></li>
            <li><b>{n(t.removed)}</b><span>tirados da TV</span></li>
            <li><b>{n(t.downloads)}</b><span>downloads</span></li>
          </ul>

          <h3 className="app-sub">Enviados por dia</h3>
          <ul className="app-rep-legend" aria-hidden="true">
            <li><i className="ok" />aprovados</li>
            <li><i className="no" />reprovados</li>
            <li><i className="rest" />outros</li>
          </ul>
          {t.sent === 0 ? (
            <p className="app-empty">Nenhum vídeo enviado neste período.</p>
          ) : null}
          <ol className="app-rep-days">
            {data.days.map((d) => {
              const other = Math.max(0, d.sent - d.approved - d.rejected);
              return (
                <li key={d.day} aria-label={`${dayLabel(d.day)}: ${plural(d.sent, "envio", "envios")}, ${n(d.approved)} aprovados, ${n(d.rejected)} reprovados, ${plural(d.downloads, "download", "downloads")}`}>
                  <span className="app-rep-date">{dayLabel(d.day)}</span>
                  <span className="app-rep-track" aria-hidden="true">
                    <i className="ok" style={{ width: `${(d.approved / maxDay) * 100}%` }} />
                    <i className="no" style={{ width: `${(d.rejected / maxDay) * 100}%` }} />
                    <i className="rest" style={{ width: `${(other / maxDay) * 100}%` }} />
                  </span>
                  <span className="app-rep-num" aria-hidden="true">
                    {n(d.sent)}
                  </span>
                  {d.downloads > 0 && (
                    <small className="app-rep-dl" aria-hidden="true">
                      {plural(d.downloads, "download", "downloads")}
                    </small>
                  )}
                </li>
              );
            })}
          </ol>

          <h3 className="app-sub">Horários de pico</h3>
          <p className="app-small">
            {data.hours[peak] > 0
              ? `Mais envios às ${peak}h (${plural(data.hours[peak], "vídeo", "vídeos")}). Horário do restaurante.`
              : "Sem envios para mostrar horários."}
          </p>
          <ol className="app-rep-hours">
            {data.hours.map((v, h) => (
              <li key={h} aria-label={`${h}h: ${plural(v, "vídeo", "vídeos")}`}>
                <span className="app-rep-col" aria-hidden="true">
                  <i style={{ height: `${(v / maxHour) * 100}%` }} />
                </span>
                <span className="app-rep-h" aria-hidden="true">{h % 3 === 0 ? h : ""}</span>
              </li>
            ))}
          </ol>

          {(t.house_played_s ?? 0) > 0 && (
            <p className="app-small app-rep-house">Vídeos da casa exibidos: {minutes(t.house_played_s ?? 0)} (fora dos números acima).</p>
          )}
          <p className="app-small">
            O que já foi apagado entra pelo resumo guardado; os vídeos ainda no ar entram pelo dia em que foram enviados.
          </p>
        </div>
      )}
    </section>
  );
}
