"use client";
/* eslint-disable @next/next/no-img-element -- logo e miniaturas pequenas, já no tamanho certo */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BALLOON_H, balloonMode, balloonNeed, balloonPath, houseHighlight, lowerFirst, pollTiming, questionText } from "@/lib/comunidade/client-logic";
import { ct, ctf } from "@/lib/comunidade/i18n";
import { thumbSrc } from "@/lib/menu/media";
import { useOrder } from "../order/order-context";
import { Live, Ring, useClock } from "./parts";
import { useComunidade } from "./provider";

// Balão da Comunidade na capa (ficha v2, "Balão na capa: posição real", telas 01 a 03).
// Fica na faixa livre entre os botões do topo e a logo, sem cobrir nenhum dos dois. Se a
// faixa não comporta o balão + 16 px, vira a pílula de uma linha na altura dos botões, entre
// o ≡ e o carrinho. Com enquete aberta: "Enquete da casa", a pergunta em até 2 linhas, o anel
// "41 min" e "Toque para votar"; sem enquete: o leque de 3 miniaturas, "★ X é o destaque da
// casa" e "Ver o mural e pedir". A ponta aponta para a logo (clip-path medido, para o
// desfoque seguir a ponta).
// Só aparece com a Comunidade ligada, o restaurante aberto e uma mesa válida (lida agora ou
// lembrada). Quem veio pelo QR do telão sem mesa não vê balão (a camada abre sozinha).

type Geom = {
  heroW: number;
  btnTop: number; // topo dos botões redondos do topo
  btnBottom: number; // fim dos botões do topo
  colRight: number; // borda direita da coluna da esquerda (≡ e bandeira)
  colBottom: number; // fim da coluna da esquerda (fechada)
  logoTop: number; // topo da logo (.brand)
  pillLeft: number; // a pílula vai do ≡ + 8 px…
  pillRight: number; // …até o carrinho (ou o ⓘ) − 8 px, medido da direita
};
const W = { poll: 262, mural: 254 } as const;
const TAIL = { w: 28, h: 12 } as const;
const GAP = 8;

function measure(hero: HTMLElement): Geom | null {
  const home = hero.parentElement;
  const brand = hero.querySelector<HTMLElement>(".brand");
  if (!home || !brand) return null;
  const h = hero.getBoundingClientRect();
  const rel = (el: Element | null) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { top: r.top - h.top, bottom: r.bottom - h.top, left: r.left - h.left, right: r.right - h.left };
  };
  const list = rel(home.querySelector(".hero-top > .round"));
  const flag = rel(home.querySelector(".hero-top .flagbtn.cur"));
  const cart = rel(home.querySelector(".hero-cart"));
  const info = rel(home.querySelector(".hero-info"));
  const top = [list, cart, info].filter((x) => !!x);
  if (!top.length) return null;
  const rightSide = [cart, info].filter((x) => !!x);
  const col = [list, flag].filter((x) => !!x);
  return {
    heroW: h.width,
    btnTop: Math.min(...top.map((x) => x.top)),
    btnBottom: Math.max(...top.map((x) => x.bottom)),
    colRight: col.length ? Math.max(...col.map((x) => x.right)) : 0,
    colBottom: col.length ? Math.max(...col.map((x) => x.bottom)) : 0,
    logoTop: brand.getBoundingClientRect().top - h.top,
    pillLeft: (list?.right ?? 16) + GAP,
    pillRight: h.width - (rightSide.length ? Math.min(...rightSide.map((x) => x.left)) - GAP : h.width - 16),
  };
}

export function Balloon() {
  const c = useComunidade();
  const o = useOrder();
  const s = c.state;
  const L = o.lang;
  const anchor = useRef<HTMLSpanElement>(null);
  const [geom, setGeom] = useState<Geom | null>(null);
  const [bodyH, setBodyH] = useState(0);

  // Mede a capa quando ela muda de tamanho (tela, altura do 52vh) e quando a logo sobe com o
  // selo "Aberto" que aparece depois. O carrinho só existe com o pedido ligado.
  useEffect(() => {
    const hero = anchor.current?.closest<HTMLElement>(".hero");
    if (!hero) return;
    const ro = new ResizeObserver(() => setGeom(measure(hero)));
    ro.observe(hero);
    const brand = hero.querySelector(".brand");
    if (brand) ro.observe(brand);
    return () => ro.disconnect();
  }, [o.enabled]);

  const poll = s?.poll && !s.poll.closed ? s.poll : null;
  const nowSeed = s ? Date.parse(s.now) : 0;
  const minute = c.minute || nowSeed;
  const highlight = useMemo(() => (o.menu ? houseHighlight(o.menu, new Date(minute)) : null), [o.menu, minute]);
  const kind: "poll" | "mural" | null = poll ? "poll" : s && (s.mural.length || highlight) ? "mural" : null;
  const show = !!s?.enabled && s.open && !!o.table && !!kind && !!geom;
  const now = useClock(show && kind === "poll", nowSeed, c.skew);

  // A primeira vez que aparece conta no funil.
  const seen = useRef(false);
  const { track } = c;
  useEffect(() => {
    if (show && !seen.current) {
      seen.current = true;
      track("balloon_seen");
    }
  }, [show, track]);

  // Altura real do corpo (a pergunta tem 1 ou 2 linhas): a ponta e o centro na faixa saem dela.
  const body = useCallback((el: HTMLSpanElement | null) => {
    if (!el) return;
    setBodyH(Math.ceil(el.offsetHeight));
    const ro = new ResizeObserver(() => setBodyH(Math.ceil(el.offsetHeight)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const anchorEl = <span ref={anchor} className="cmu-anchor" aria-hidden />;
  if (!show || !geom || !kind || !s) return anchorEl;

  const width = W[kind];
  // A coluna de idiomas desce mais que os botões: se o balão chega perto dela, a faixa começa
  // embaixo dela.
  const clears = geom.heroW / 2 - width / 2 >= geom.colRight + GAP;
  const bandTop = clears ? geom.btnBottom : Math.max(geom.btnBottom, geom.colBottom);
  const band = geom.logoTop - bandTop;
  const compact = balloonMode(band, balloonNeed(kind)) === "compact";
  const open = () => c.setOpen(true, kind === "poll" ? "palco" : "mural");

  const timing = poll ? pollTiming(poll, now) : null;
  const question = poll ? questionText(poll, L) : "";
  const voted = poll ? c.myVote(poll.id) : null;
  const thumbs = s.mural.slice(0, 3).map((p) => p.thumb);
  const hlThumb = highlight ? thumbSrc(highlight) : null;

  if (compact) {
    const style = { top: geom.btnTop + 2, left: geom.pillLeft, right: geom.pillRight };
    if (kind === "poll") {
      return (
        <>
          {anchorEl}
          <button className="cmu-bal cmu-pill" style={style} onClick={open} aria-label={ctf("openPollAria", L, { q: question })}>
            <Ring angle={timing?.angle ?? 0} />
            <span className="cmu-t">
              <b>{ct("pillVote", L)}</b> {lowerFirst(question, L)}
            </span>
          </button>
        </>
      );
    }
    const mini = [hlThumb, ...thumbs].filter((x, k, a): x is string => !!x && a.indexOf(x) === k).slice(0, 2);
    return (
      <>
        {anchorEl}
        <button className="cmu-bal cmu-pill" style={style} onClick={open} aria-label={ct("openMuralAria", L)}>
          {mini.length > 0 && (
            <span className="cmu-stack">
              {mini.map((src, k) => (
                <img key={k} src={src} alt="" />
              ))}
            </span>
          )}
          <span className="cmu-t">
            <b>{ct("pillSee", L)}</b> {ct("pillSeeRest", L)}
          </span>
        </button>
      </>
    );
  }

  // Corpo medido (até medir, a altura da ficha) + a ponta; centrado na faixa livre.
  const r = kind === "poll" ? 24 : 26;
  const h = bodyH || BALLOON_H[kind] - TAIL.h;
  const top = Math.round(bandTop + (band - h - TAIL.h) / 2);
  const shape = { top, height: h + TAIL.h, clipPath: `path("${balloonPath(width, h, r, TAIL.w, TAIL.h)}")` };

  if (kind === "poll" && poll && timing) {
    return (
      <>
        {anchorEl}
        <button className="cmu-bal cmu-bal-p" style={shape} onClick={open} aria-label={ctf("openPollAria", L, { q: question })}>
          <span className="cmu-bb" ref={body}>
            <span className="cmu-bk">
              <span>{ct("housePoll", L)}</span>
              <span className="cmu-lv">
                <Live />
                <em>{ct(s.has_tv ? "onTv" : "live", L)}</em>
              </span>
            </span>
            <Ring angle={timing.angle} left={timing.left} lang={L} />
            <span className="cmu-bq fd">{question}</span>
            <span className="cmu-bc">{ct(voted ? "balSeeResult" : "balTapToVote", L)}</span>
          </span>
        </button>
      </>
    );
  }

  // Mural: leque de 3 miniaturas (o destaque, ou a mais nova, no meio e por cima).
  const center = hlThumb ?? thumbs[0] ?? null;
  const sides = thumbs.filter((t) => t !== center).slice(0, 2);
  const n = s.mural.length;
  const hlParts = ct("balHighlight", L).split("{name}");
  return (
    <>
      {anchorEl}
      <button className="cmu-bal cmu-bal-m" style={shape} onClick={open} aria-label={ct("openMuralAria", L)}>
        <span className="cmu-bb" ref={body}>
          <span className="cmu-fan">
            {sides.map((src, k) => (
              <img key={k} className={k ? "r" : "l"} src={src} alt="" />
            ))}
            {center && <img className="c" src={center} alt="" />}
          </span>
          {highlight ? (
            // O nome encolhe com reticências; "é o destaque da casa" fica sempre inteiro.
            <span className={`cmu-bt fd${highlight.name.length > 8 ? " long" : ""}`}>
              <i>{"★ "}</i>
              {hlParts[0] && <span>{hlParts[0]}</span>}
              <span className="cmu-bn">{highlight.name}</span>
              {hlParts[1] && <span>{hlParts[1]}</span>}
            </span>
          ) : (
            <span className="cmu-bt fd">{n === 1 ? ct("muralCount1", L) : ctf("muralCount", L, { n })}</span>
          )}
          <span className="cmu-bc">{ct("balMuralGo", L)}</span>
        </span>
      </button>
    </>
  );
}
