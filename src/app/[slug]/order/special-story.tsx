"use client";

import { useEffect, useRef, useState } from "react";
import type { MenuItem } from "@/lib/menu/types";
import { tf, t as tr } from "@/lib/menu/i18n";
import { formatPrice } from "@/lib/menu/media";
import { useOrder } from "./order-context";

// Story da oferta relâmpago (visual aprovado pelo João em 16/10/2026; CSS em special.css).
// Linha do tempo: contagem "OFERTA RELÂMPAGO EM 3, 2, 1" (3 s, fora do tempo da oferta) →
// oferta por item.special.show_s segundos → preço novo faltando 4 s. Tocar em "Pedir agora"
// grava o registro no servidor; o toque vale mesmo que o tempo acabe durante a resposta.
// Só anima com `live` ligado (story vivo). Quem tira o story da categoria é o menu-app, no onDone.

const INTRO_MS = 3000;
const COUNT_STEP_MS = 900;
const REVEAL_LEFT_S = 4;
const GOT_MS = 1600;
const FAIL_MS = 1500;
const GONE_MS = 1500;
const SPARKS = ["#fff8ea", "#f3e7cf", "#b8a582", "#ffffff"];

type Phase = "idle" | "pre" | "live" | "wait" | "got" | "fail" | "out";

export function SpecialStory({ item, live, onDone }: { item: MenuItem; live: boolean; onDone: (outcome: "taken" | "missed") => void }) {
  const o = useOrder();
  const L = o.lang;
  const showS = item.special?.show_s ?? 6;
  const limit = item.special?.limit ?? 1;
  const [phase, setPhase] = useState<Phase>("idle");
  const [drop, setDrop] = useState(false);
  const [count, setCount] = useState(3);
  const [tick, setTick] = useState(0);
  const [qty, setQty] = useState(1);
  const [gotCents, setGotCents] = useState<number | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const phaseRef = useRef<Phase>("idle");
  const done = useRef(onDone);
  useEffect(() => {
    done.current = onDone;
  }, [onDone]);

  const go = (p: Phase) => {
    phaseRef.current = p;
    setPhase(p);
  };
  const later = (fn: () => void, ms: number) => timers.current.push(setTimeout(fn, ms));

  // Começa uma vez, quando o story fica vivo. Sair do story antes do fim é decidido pelo menu-app.
  useEffect(() => {
    if (!live || phaseRef.current !== "idle") return;
    go("pre");
    [3, 2, 1].forEach((n, i) =>
      later(() => {
        setCount(n);
        setTick((k) => k + 1);
      }, 200 + i * COUNT_STEP_MS),
    );
    later(() => {
      go("live");
      later(() => setDrop(true), Math.max(0, showS - REVEAL_LEFT_S) * 1000);
      later(() => {
        if (phaseRef.current !== "live") return; // tocou: o toque vale
        go("out");
        later(() => done.current("missed"), GONE_MS);
      }, showS * 1000);
    }, INTRO_MS);
    // Desmontar (ou o Strict Mode do React, que monta duas vezes) cancela a contagem e deixa
    // recomeçar do zero; sem isso a segunda montagem acharia a contagem já em andamento.
    const list = timers.current;
    return () => {
      list.forEach(clearTimeout);
      list.length = 0;
      if (phaseRef.current === "pre" || phaseRef.current === "live") phaseRef.current = "idle";
    };
  }, [live, showS]);

  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const take = async () => {
    if (phaseRef.current !== "live") return;
    go("wait");
    const r = await o.takeSpecial(item, qty);
    if (r.ok) {
      setGotCents(r.cents);
      setDrop(true);
      go("got");
      later(() => done.current("taken"), GOT_MS);
    } else {
      go("fail");
      later(() => done.current("missed"), FAIL_MS);
    }
  };

  const promo = item.promo_price_cents ?? item.price_cents;
  const cls = ["sp-story", phase === "pre" ? "pre" : "", ["live", "wait", "got", "fail"].includes(phase) ? "live" : "", drop ? "drop" : "", phase].join(" ");

  return (
    <div className={cls} style={{ ["--sp-dur" as string]: `${showS}s` }}>
      <div className="sp-streak" />
      <div className="sp-fuse">
        <i />
      </div>

      <div className="sp-foot">
        <div>
          <h3 className="fd sp-title">{item.name}</h3>
          <div className="sp-prices">
            <span className="sp-was">{formatPrice(item.price_cents, L)}</span>
            <span className="sp-now">
              {priceParts(promo, L).map((p, i) => (p.type === "currency" ? <small key={i}>{p.value}</small> : <span key={i}>{p.value}</span>))}
            </span>
          </div>
        </div>
        {limit > 1 && (
          <div className="sp-qty">
            <span>{tf("oSpecialMax", L, { n: limit })}</span>
            <div className="o-qty glass" role="group" aria-label={`${tr("oUnits", L).replace("{n} ", "")} · ${item.name}`}>
              <button onClick={() => setQty((q) => Math.max(1, q - 1))} disabled={qty <= 1} aria-label={tr("oLess", L)}>
                −
              </button>
              <output aria-live="polite">{qty}</output>
              <button onClick={() => setQty((q) => Math.min(limit, q + 1))} disabled={qty >= limit} aria-label={tr("oMoreOne", L)}>
                +
              </button>
            </div>
          </div>
        )}
        <div className="sp-gowrap">
          <button className="sp-go" onClick={take} disabled={phase !== "live"} aria-label={`${tr("oGo", L)}: ${item.name}`}>
            <span className="sp-fill" />
            <svg className="icon" viewBox="0 0 24 24" aria-hidden>
              <path d="M13 2L4 14h7l-1 8 9-12h-7z" />
            </svg>
            <span className="sp-tx">{tr("oGo", L)}</span>
            <svg className="icon" viewBox="0 0 24 24" aria-hidden>
              <path d="M5 12h14M13 6l6 6-6 6" />
            </svg>
          </button>
        </div>
      </div>

      <div className="sp-edge" />
      <div className="sp-edge-soft" />

      <div className="sp-burst" aria-hidden>
        {phase === "got" &&
          Array.from({ length: 14 }, (_, i) => <i key={i} style={{ ["--r" as string]: `${(i / 14) * 360}deg`, color: SPARKS[i % SPARKS.length] }} />)}
      </div>
      <div className="sp-toast" role="status">
        <i>
          <svg viewBox="0 0 24 24">
            <path d={phase === "fail" ? "M6 6l12 12M18 6L6 18" : "M5 12l5 5 9-10"} />
          </svg>
        </i>
        <span>{phase === "fail" ? tr("oSpecialFail", L) : tf("oSpecialGot", L, { price: formatPrice(gotCents ?? promo, L) })}</span>
      </div>

      <div className="sp-gone" aria-live="polite">
        {phase === "out" && (
          <div>
            <b className="fd">{tr("oSpecialGone", L)}</b>
            <span>{tr("oSpecialGoneSub", L)}</span>
          </div>
        )}
      </div>

      <div className="sp-intro" aria-hidden={phase !== "pre"}>
        <div className="sp-in">
          <span className="sp-k">{tr("oSpecialIntro", L)}</span>
          <span key={tick} className={`fd sp-cnt${tick ? " tick" : ""}`}>
            {count}
          </span>
          <p>{tr("oSpecialReady", L)}</p>
        </div>
      </div>
    </div>
  );
}

// Preço em partes: o símbolo (R$) fica menor e no lugar que cada língua usa ("R$ 69" ou "69 R$").
function priceParts(cents: number, lang: string) {
  const digits = cents % 100 === 0 ? 0 : 2;
  return new Intl.NumberFormat(lang, { style: "currency", currency: "BRL", minimumFractionDigits: digits, maximumFractionDigits: digits })
    .formatToParts(cents / 100)
    .filter((p) => p.type !== "literal" || p.value.trim());
}
