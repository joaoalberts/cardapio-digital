"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ZONE_NAME_MAX, ZONES_MAX } from "@/lib/apareca/panel-logic";
import type { Zone } from "@/lib/apareca/types";
import { uuid } from "@/lib/uuid";
import { saveZones } from "./actions";

// Zonas do salão: criar, renomear e apagar; a zona de cada mesa (o vídeo dela vai só para as TVs
// da zona) e de cada TV pareada (toca só os vídeos da zona). Mesa sem zona manda para todas as TVs;
// TV sem zona toca todas. Apagar uma zona deixa as mesas e TVs dela sem zona: nada some da TV.

type Opt = { id: string; label: string };
const SAVE_FAIL = "Não foi possível salvar. Confira a internet.";

export function Zonas({
  rid, zones: initialZones, tableZones, tvZones, tables, tvs,
}: {
  rid: string; zones: Zone[]; tableZones: Record<string, string>; tvZones: Record<string, string>; tables: Opt[]; tvs: Opt[];
}) {
  const router = useRouter();
  const [zones, setZones] = useState(initialZones);
  const [tz, setTz] = useState(tableZones);
  const [vz, setVz] = useState(tvZones);
  const [saving, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const exists = (id: string | undefined) => !!id && zones.some((z) => z.id === id);
  const add = () => setZones((zs) => (zs.length >= ZONES_MAX ? zs : [...zs, { id: uuid(), name: "" }]));
  const rename = (id: string, name: string) => setZones((zs) => zs.map((z) => (z.id === id ? { ...z, name } : z)));
  const drop = (id: string) => setZones((zs) => zs.filter((z) => z.id !== id));
  const setOf = (set: typeof setTz) => (key: string, zone: string) =>
    set((m) => {
      const n = { ...m };
      if (zone) n[key] = zone;
      else delete n[key];
      return n;
    });

  const save = () =>
    start(async () => {
      setMsg(null);
      const r = await saveZones(rid, zones.map((z) => ({ id: z.id, name: z.name.trim() })), tz, vz).catch(() => ({ error: SAVE_FAIL }));
      setMsg(r.error ? { ok: false, text: r.error } : { ok: true, text: "Zonas salvas." });
      if (!r.error) router.refresh();
    });

  const select = (value: string | undefined, onChange: (v: string) => void, empty: string, label: string) => (
    <select value={exists(value) ? value : ""} onChange={(e) => onChange(e.target.value)} aria-label={label}>
      <option value="">{empty}</option>
      {zones.map((z) => (
        <option key={z.id} value={z.id}>
          {z.name.trim() || "Zona sem nome"}
        </option>
      ))}
    </select>
  );

  return (
    <section className="ap-card app-zones" aria-labelledby="app-h-zones">
      <div className="ap-card-head">
        <h2 id="app-h-zones">Zonas</h2>
      </div>
      <p className="app-small">
        Use zonas quando houver mais de uma TV (ex.: salão e varanda). O vídeo de uma mesa passa só nas TVs da mesma zona. Sem zonas,
        todo vídeo passa em todas as TVs.
      </p>

      {zones.length > 0 && (
        <ul className="app-zlist">
          {zones.map((z, k) => (
            <li key={z.id}>
              <input
                type="text"
                value={z.name}
                maxLength={ZONE_NAME_MAX}
                placeholder="Nome da zona"
                aria-label={`Nome da zona ${k + 1}`}
                onChange={(e) => rename(z.id, e.target.value)}
              />
              <button type="button" className="app-del" onClick={() => drop(z.id)}>
                Apagar
              </button>
            </li>
          ))}
        </ul>
      )}
      <button type="button" className="app-add" onClick={add} disabled={zones.length >= ZONES_MAX}>
        {zones.length >= ZONES_MAX ? `Limite de ${ZONES_MAX} zonas` : "Adicionar zona"}
      </button>

      {zones.length > 0 && (
        <>
          <h3 className="app-sub">Mesas</h3>
          {tables.length === 0 ? (
            <p className="app-empty">Nenhuma mesa cadastrada. Crie as mesas no menu Mesas.</p>
          ) : (
            <ul className="app-map">
              {tables.map((t) => (
                <li key={t.id}>
                  <span>Mesa {t.label.replace(/^mesa\s+/i, "")}</span>
                  {select(tz[t.id], (v) => setOf(setTz)(t.id, v), "Sem zona", `Zona da mesa ${t.label}`)}
                </li>
              ))}
            </ul>
          )}

          <h3 className="app-sub">TVs</h3>
          {tvs.length === 0 ? (
            <p className="app-empty">Nenhuma TV conectada. Conecte as TVs na Comunidade.</p>
          ) : (
            <ul className="app-map">
              {tvs.map((t) => (
                <li key={t.id}>
                  <span>{t.label}</span>
                  {select(vz[t.id], (v) => setOf(setVz)(t.id, v), "Todas as zonas", `Zona da TV ${t.label}`)}
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {msg && (
        <p className={`app-msg${msg.ok ? " ok" : ""}`} role={msg.ok ? "status" : "alert"}>
          {msg.text}
        </p>
      )}
      <button type="button" className="app-save" onClick={save} disabled={saving}>
        {saving ? "Salvando…" : "Salvar zonas"}
      </button>
    </section>
  );
}
