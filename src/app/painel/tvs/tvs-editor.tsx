"use client";

import { useRouter } from "next/navigation";
import { startTransition, useEffect, useOptimistic, useState, useTransition } from "react";
import type { Zone } from "@/lib/apareca/types";
import type { TvStatus } from "@/lib/painel/tv-status";
import { setTvZone } from "../apareca/actions";
import { Zonas } from "../apareca/zonas";
import { pairTv, revokeTv, setTvSimple } from "./actions";
import { Confirm } from "./confirm";

// Tela TVs, de cima para baixo: conectar uma TV nova, um cartão por TV (estado, zona e Desconectar),
// o modo simples e, dobradas, as zonas. As ações são as de sempre (pairTv, revokeTv, setTvSimple e
// setTvZone) e todas valem para qualquer membro; o servidor confere tudo de novo ao gravar.

type Res = { error?: string };
type Run = (fn: () => Promise<Res>, ok: string) => Promise<boolean>;
type Tv = { id: string; label: string; status: TvStatus; zone: string | null };
export type TvsData = {
  restaurantId: string;
  tvUrl: string;
  tvSimple: boolean;
  tvs: Tv[];
  aparecaOn: boolean;
  zones: Zone[];
  tableZones: Record<string, string>;
  tables: { id: string; label: string }[];
};

const NAME_MAX = 40; // o mesmo corte do servidor (cleanLabel em lib/tv/pair.ts)
const TV_ICON = "M5 5h14a2.5 2.5 0 012.5 2.5v7A2.5 2.5 0 0119 17H5a2.5 2.5 0 01-2.5-2.5v-7A2.5 2.5 0 015 5zM8 21h8M12 17v4";

export function TvsEditor({ data }: { data: TvsData }) {
  const router = useRouter();
  // Cada aviso é um objeto novo: o mesmo texto duas vezes seguidas reinicia o prazo.
  const [toast, setToast] = useState<{ msg: string } | null>(null);
  const flash = (msg: string) => setToast({ msg });
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(id);
  }, [toast]);

  // O aviso e o refresh saem na mesma transição de quem pediu, para o controle ficar no valor
  // novo até os dados novos chegarem.
  const run: Run = async (fn, ok) => {
    const res = await fn().catch(() => ({ error: "Não foi possível salvar. Tente de novo." }));
    if (res.error) {
      flash(res.error);
      return false;
    }
    startTransition(() => {
      flash(ok);
      router.refresh();
    });
    return true;
  };

  return (
    <div className="cp tvs">
      <Connect data={data} run={run} />
      <TvList data={data} run={run} />
      <Simple data={data} run={run} />
      {data.aparecaOn && (
        <details className="tvs-more">
          <summary>Mais de uma TV? Separe por zonas</summary>
          <div className="app-setup">
            <Zonas rid={data.restaurantId} zones={data.zones} tableZones={data.tableZones} tables={data.tables} />
          </div>
        </details>
      )}
      {toast && (
        <div className="ap-toast" role="status">
          {toast.msg}
        </div>
      )}
    </div>
  );
}

// ---------- Ligar uma TV nova ----------

function Connect({ data, run }: { data: TvsData; run: Run }) {
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [busy, startPair] = useTransition();
  const [ok, setOk] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  // Nome sugerido: "TV do salão", "TV do salão 2"… o primeiro que ainda não existe.
  const labels = new Set(data.tvs.map((t) => t.label));
  let suggested = "TV do salão";
  for (let n = 2; labels.has(suggested); n++) suggested = `TV do salão ${n}`;
  const clean = code.replace(/\s+/g, "");

  const copy = async () => {
    const done = await navigator.clipboard?.writeText(data.tvUrl).then(() => true, () => false);
    setCopied(done === true);
    if (!done) window.prompt("Copie o endereço:", data.tvUrl);
  };

  // "Conectando…" até a TV aparecer na lista; o "conectada agora" sai junto com ela.
  const connect = () => {
    setOk(null);
    const label = name.trim() || suggested;
    startPair(async () => {
      if (await run(() => pairTv(data.restaurantId, clean, label), `${label} conectada.`))
        startTransition(() => {
          setOk(label);
          setCode("");
          setName("");
        });
    });
  };

  return (
    <section className="ap-card" aria-labelledby="tvs-h-new">
      <div className="ap-card-head">
        <h2 id="tvs-h-new">Ligar uma TV nova</h2>
        <svg className="icon" viewBox="0 0 24 24" aria-hidden>
          <path d={TV_ICON} />
        </svg>
      </div>
      <p className="cp-lead">Abra este endereço na TV. Ela mostra um código de 6 letras e números: digite aqui.</p>
      <div className="tvs-url">
        <a className="cp-url" href={data.tvUrl} target="_blank" rel="noreferrer">
          {data.tvUrl.replace(/^https?:\/\//, "")}
        </a>
        <button type="button" className="btn outline" onClick={copy}>
          {copied ? "Copiado" : "Copiar"}
        </button>
      </div>
      <label className="cp-fld">
        <span>Código</span>
        <span className="cp-in cp-code">
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9 ]/g, ""))}
            onKeyDown={(e) => e.key === "Enter" && clean.length === 6 && !busy && connect()}
            maxLength={7}
            placeholder="ex.: K7M2Q9"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
          />
        </span>
      </label>
      <label className="cp-fld">
        <span>Nome da TV</span>
        <span className="cp-in">
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={NAME_MAX} placeholder={suggested} autoComplete="off" />
        </span>
      </label>
      <button type="button" className="btn primary tvs-go" disabled={clean.length !== 6 || busy} onClick={connect}>
        {busy ? "Conectando…" : "Conectar"}
      </button>
      {ok && (
        <p className="cp-pairok" role="status">
          ✓ {ok} conectada agora
        </p>
      )}
    </section>
  );
}

// ---------- Cartões das TVs ----------

function TvList({ data, run }: { data: TvsData; run: Run }) {
  const zonesOn = data.aparecaOn && data.zones.length > 0;
  return (
    <section className="ap-card" aria-labelledby="tvs-h-list">
      <div className="ap-card-head">
        <h2 id="tvs-h-list">Suas TVs</h2>
      </div>
      {data.tvs.length === 0 ? (
        <p className="cp-empty">Nenhuma TV conectada ainda.</p>
      ) : (
        <ul className="tvs-list">
          {data.tvs.map((t) => (
            <TvItem key={t.id} tv={t} data={data} run={run} zonesOn={zonesOn} />
          ))}
        </ul>
      )}
    </section>
  );
}

function TvItem({ tv, data, run, zonesOn }: { tv: Tv; data: TvsData; run: Run; zonesOn: boolean }) {
  // A zona escolhida fica no seletor até o refresh; se a ação falhar, volta sozinha.
  const [zone, setZone] = useOptimistic(tv.zone);
  const [busy, startZone] = useTransition();
  const known = zone && data.zones.some((z) => z.id === zone) ? zone : "";
  const pick = (next: string) =>
    startZone(async () => {
      const z = next || null;
      setZone(z);
      await run(() => setTvZone(data.restaurantId, tv.id, z), z ? "Zona da TV salva." : "A TV passa a mostrar todas as zonas.");
    });

  return (
    <li className="tvs-item">
      <div className="tvs-head">
        <b>{tv.label}</b>
        <span className={`tvs-st${tv.status.on ? " on" : ""}`}>
          <i aria-hidden />
          {tv.status.text}
        </span>
      </div>
      {zonesOn && (
        <label className="tvs-zone">
          <span>Zona</span>
          <span className="cp-in">
            <select value={known} onChange={(e) => pick(e.target.value)} disabled={busy} aria-label={`Zona da ${tv.label}`}>
              <option value="">Todas as zonas</option>
              {data.zones.map((z) => (
                <option key={z.id} value={z.id}>
                  {z.name}
                </option>
              ))}
            </select>
          </span>
        </label>
      )}
      <Confirm label="Desconectar" ask="Desconectar esta TV?" yes="Sim" onYes={() => run(() => revokeTv(data.restaurantId, tv.id), "TV desconectada.")} />
    </li>
  );
}

// ---------- Modo simples ----------

function Simple({ data, run }: { data: TvsData; run: Run }) {
  // Valor novo até o refresh; falhou, volta sozinho.
  const [simple, setSimple] = useOptimistic(data.tvSimple);
  const [busy, start] = useTransition();
  const toggle = () =>
    start(async () => {
      const next = !simple;
      setSimple(next);
      await run(() => setTvSimple(data.restaurantId, next), next ? "Modo simples ligado." : "Modo simples desligado.");
    });
  return (
    <section className="ap-card">
      <div className="cp-sw-row tvs-simple">
        <div>
          <b id="tvs-simple-l">Modo simples</b>
          <small>Para TV mais antiga: sem animação. Liga sozinho se a TV engasgar.</small>
        </div>
        <button className="cp-sw" role="switch" aria-checked={simple} aria-labelledby="tvs-simple-l" disabled={busy} onClick={toggle}>
          <i />
        </button>
      </div>
    </section>
  );
}
