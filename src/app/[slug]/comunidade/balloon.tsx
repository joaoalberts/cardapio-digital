"use client";
/* eslint-disable @next/next/no-img-element -- logo e miniaturas pequenas, já no tamanho certo */

import { useEffect, useMemo, useRef, useState } from "react";
import { BALLOON_H, balloonMode, balloonNeed, clockText, houseHighlight, pollTiming, questionText } from "@/lib/comunidade/client-logic";
import { ct, ctf } from "@/lib/comunidade/i18n";
import { mediaUrl, thumbSrc } from "@/lib/menu/media";
import { useOrder } from "../order/order-context";
import { Live, Ring, useClock } from "./parts";
import { useComunidade } from "./provider";

// Balão da Comunidade na capa (ficha do protótipo, "Balão na capa: posição real").
// Fica na faixa livre entre os botões do topo e a logo, sem cobrir nenhum dos dois. Se a
// faixa não comporta o balão grande + 8 px de cada lado, vira a pílula compacta de uma linha
// na altura dos botões, entre o ≡ e o carrinho. Com enquete aberta: a casa falando (pergunta
// e anel do tempo); sem enquete: o Mural (miniaturas e o destaque da casa).
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
const W = { poll: 254, mural: 240 } as const;
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
  const highlight = useMemo(() => (o.menu ? houseHighlight(o.menu, new Date(nowSeed)) : null), [o.menu, nowSeed]);
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

  const anchorEl = <span ref={anchor} className="cmu-anchor" aria-hidden />;
  if (!show || !geom || !kind || !s) return anchorEl;

  const logo = mediaUrl(o.menu?.restaurant.logo_path);
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
          <button className="cmu-bal cmu-bal-c" style={style} onClick={open} aria-label={ctf("openPollAria", L, { q: question })}>
            {logo && <img src={logo} alt="" />}
            <span className="cmu-t">{ct("pollOpen", L)}</span>
            <Ring angle={timing?.angle ?? 0} />
          </button>
        </>
      );
    }
    const mini = (thumbs.length ? thumbs : hlThumb ? [hlThumb] : []).slice(0, 2);
    return (
      <>
        {anchorEl}
        <button className="cmu-bal cmu-bal-c" style={style} onClick={open} aria-label={ct("openMuralAria", L)}>
          {mini.length > 0 && (
            <span className="cmu-mfan">
              {mini.map((src, k) => (
                <img key={k} src={src} alt="" />
              ))}
            </span>
          )}
          <span className="cmu-t">🔥 {ct("muralPill", L)}</span>
        </button>
      </>
    );
  }

  const top = Math.round(bandTop + (band - BALLOON_H[kind]) / 2);
  if (kind === "poll" && poll && timing) {
    return (
      <>
        {anchorEl}
        <button className="cmu-bal cmu-bal-p" style={{ top }} onClick={open} aria-label={ctf("openPollAria", L, { q: question })}>
          <span className="cmu-bh">
            {logo && <img src={logo} alt="" />}
            <span>{ct("pollOpen", L)}</span>
          </span>
          <Ring angle={timing.angle} text={clockText(timing.left)} />
          <span className="cmu-bq fd">{question}</span>
          <span className="cmu-bc">
            <Live />
            {ct(s.has_tv ? "liveOnTv" : "liveNowCap", L)} · <b>{voted ? ct("youVotedMark", L) : ct("tapToVote", L)}</b>
          </span>
        </button>
      </>
    );
  }

  // Mural: até 3 miniaturas em leque (a mais nova no meio, por cima) e o destaque da casa.
  const fan = thumbs.length ? thumbs : hlThumb ? [hlThumb] : [];
  const n = s.mural.length;
  const title = n
    ? highlight
      ? `🔥 ${ctf("muralHighlight", L, { name: highlight.name })}`
      : `🔥 ${ct("muralPill", L)}`
    : highlight
      ? ctf("highlightIs", L, { name: highlight.name })
      : "";
  return (
    <>
      {anchorEl}
      <button className="cmu-bal cmu-bal-m" style={{ top }} onClick={open} aria-label={ct("openMuralAria", L)}>
        <span className="cmu-fan">
          {fan[1] && <img className="l" src={fan[1]} alt="" />}
          {fan[2] && <img className="r" src={fan[2]} alt="" />}
          {fan[0] && <img className="c" src={fan[0]} alt="" />}
        </span>
        <b>{title}</b>
        {n > 0 && <span className="cmu-s">{n === 1 ? ct("muralCount1", L) : ctf("muralCount", L, { n })}</span>}
      </button>
    </>
  );
}
