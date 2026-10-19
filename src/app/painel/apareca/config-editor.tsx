"use client";

import { useRouter } from "next/navigation";
import { useOptimistic, useState, useTransition } from "react";
import {
  CLIENTS_MAX, NOT_ALLOWED, PLAYS_MAX, RETENTION_OPTIONS,
} from "@/lib/apareca/panel-logic";
import type { ModMode } from "@/lib/apareca/types";
import { saveConfig, setAparecaEnabled } from "./actions";

// Configurações do Apareça: interruptor (só o dono; some enquanto o João não liberar a casa),
// modo de moderação (só os liberados), regra da programação, vezes que cada vídeo toca,
// horário e prazo para apagar.

export type ConfigView = {
  mode: ModMode; clients_max: number; plays: number;
  hours: { from: string; to: string } | null; retention_h: number;
};

const MODE_TEXT: Record<ModMode, { title: string; hint: string }> = {
  manual: { title: "Manual", hint: "A equipe aprova cada vídeo antes de ele ir para a TV." },
  hibrido: { title: "Híbrido", hint: "A análise automática reprova o que for impróprio; a equipe aprova o resto." },
  automatico: { title: "Automático", hint: "A análise automática aprova e reprova; a equipe pode remover depois." },
};

const RETENTION_TEXT: Record<number, string> = { 6: "6 horas", 12: "12 horas", 24: "24 horas", 72: "3 dias", 168: "7 dias" };
const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, k) => a + k);
const SAVE_FAIL = "Não foi possível salvar. Confira a internet.";

export function ConfigEditor({
  rid, isOwner, allowed, enabled, modes, cfg,
}: { rid: string; isOwner: boolean; allowed: boolean; enabled: boolean; modes: ModMode[]; cfg: ConfigView }) {
  const router = useRouter();
  const [on, setOn] = useOptimistic(enabled);
  const [toggling, startToggle] = useTransition();
  const [saving, startSave] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // Modo atual fora dos liberados (a IA foi desligada depois): o formulário mostra manual.
  const [mode, setMode] = useState<ModMode>(modes.includes(cfg.mode) ? cfg.mode : "manual");
  const [clients, setClients] = useState(cfg.clients_max);
  const [plays, setPlays] = useState(cfg.plays);
  const [ownHours, setOwnHours] = useState(cfg.hours !== null);
  const [from, setFrom] = useState(cfg.hours?.from ?? "18:00");
  const [to, setTo] = useState(cfg.hours?.to ?? "23:00");
  const [retention, setRetention] = useState(cfg.retention_h);

  const toggle = () =>
    startToggle(async () => {
      const next = !on;
      setOn(next);
      setMsg(null);
      const r = await setAparecaEnabled(rid, next).catch(() => ({ error: SAVE_FAIL }));
      if (r.error) setMsg({ ok: false, text: r.error });
      router.refresh();
    });

  const save = () =>
    startSave(async () => {
      setMsg(null);
      const r = await saveConfig(rid, {
        ...(mode !== cfg.mode ? { mode } : {}),
        rule: { kind: "intercalar", house_every: 1, clients_max: clients },
        plays: plays as 1 | 2 | 3,
        hours: ownHours ? { from, to } : null,
        retention_h: retention,
      }).catch(() => ({ error: SAVE_FAIL }));
      setMsg(r.error ? { ok: false, text: r.error } : { ok: true, text: "Configurações salvas." });
      if (!r.error) router.refresh();
    });

  return (
    <section className="ap-card app-cfg" aria-labelledby="app-h-cfg">
      <div className="ap-card-head">
        <h2 id="app-h-cfg">Configurações</h2>
      </div>

      {allowed ? (
        <>
          <div className="app-sw-row">
            <div>
              <b id="app-sw-l">Apareça na TV ligado</b>
              <small>{on ? "Ligado: o convite aparece no cardápio da mesa." : "Desligado: ninguém vê o convite."}</small>
            </div>
            <button
              type="button"
              className="app-sw"
              role="switch"
              aria-checked={on}
              aria-labelledby="app-sw-l"
              disabled={!isOwner || toggling}
              onClick={toggle}
            >
              <i />
            </button>
          </div>
          {!isOwner && <p className="app-small">Só o dono do restaurante liga ou desliga o Apareça na TV.</p>}
        </>
      ) : (
        <p className="app-band app-band-off" role="status">
          {NOT_ALLOWED}
        </p>
      )}

      <fieldset className="app-fld">
        <legend>Moderação</legend>
        {modes.map((m) => (
          <label key={m} className="app-radio">
            <input type="radio" name="app-mode" value={m} checked={mode === m} onChange={() => setMode(m)} />
            <span>
              <b>{MODE_TEXT[m].title}</b>
              <small>{MODE_TEXT[m].hint}</small>
            </span>
          </label>
        ))}
        {modes.length === 1 && <small className="app-small">A análise automática ainda não foi liberada para a sua casa.</small>}
      </fieldset>

      <label className="app-fld">
        <span>Programação da TV</span>
        <span className="app-inline">
          Depois de cada institucional, até
          <select value={clients} onChange={(e) => setClients(Number(e.target.value))} aria-label="Vídeos de clientes depois de cada institucional">
            {range(CLIENTS_MAX.min, CLIENTS_MAX.max).map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
          {clients === 1 ? "vídeo" : "vídeos"} de clientes
        </span>
      </label>

      <label className="app-fld">
        <span>Vezes que cada vídeo de cliente passa na TV</span>
        <select value={plays} onChange={(e) => setPlays(Number(e.target.value))}>
          {range(1, PLAYS_MAX).map((n) => (
            <option key={n} value={n}>
              {n === 1 ? "1 vez" : `${n} vezes`}
            </option>
          ))}
        </select>
      </label>

      <fieldset className="app-fld">
        <legend>Horário para enviar vídeos</legend>
        <label className="app-check">
          <input type="checkbox" checked={!ownHours} onChange={(e) => setOwnHours(!e.target.checked)} />
          <span>O mesmo horário de funcionamento do restaurante</span>
        </label>
        {ownHours && (
          <span className="app-hours">
            <label>
              <span>Das</span>
              <input type="time" value={from} onChange={(e) => setFrom(e.target.value)} required />
            </label>
            <label>
              <span>às</span>
              <input type="time" value={to} onChange={(e) => setTo(e.target.value)} required />
            </label>
          </span>
        )}
        {ownHours && <small className="app-small">Pode passar da meia-noite (ex.: das 19:00 às 02:00).</small>}
      </fieldset>

      <label className="app-fld">
        <span>Apagar os vídeos dos clientes depois de</span>
        <select value={retention} onChange={(e) => setRetention(Number(e.target.value))}>
          {RETENTION_OPTIONS.map((h) => (
            <option key={h} value={h}>
              {RETENTION_TEXT[h]}
            </option>
          ))}
        </select>
      </label>

      {msg && (
        <p className={`app-msg${msg.ok ? " ok" : ""}`} role={msg.ok ? "status" : "alert"}>
          {msg.text}
        </p>
      )}
      <button type="button" className="app-save" onClick={save} disabled={saving}>
        {saving ? "Salvando…" : "Salvar configurações"}
      </button>
    </section>
  );
}
