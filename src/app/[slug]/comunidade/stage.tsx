"use client";
/* eslint-disable @next/next/no-img-element -- fotos dos pratos e logo já vêm no tamanho certo */

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  clockText, houseHighlight, leaderOf, localTime, pollTiming, questionText, shownPcts, storyChoices,
} from "@/lib/comunidade/client-logic";
import { ct, ctf, type CmuKey } from "@/lib/comunidade/i18n";
import type { OptionId, PublicPoll } from "@/lib/comunidade/types";
import { mediaUrl, thumbSrc } from "@/lib/menu/media";
import type { MenuItem } from "@/lib/menu/types";
import { useOrder } from "../order/order-context";
import { BuyButton, type BuySource } from "./buy-button";
import { IconChevron, IconClock, IconQr, IconTv, Live, Ring, useClock } from "./parts";
import { useComunidade } from "./provider";
import { ShareStoryButton } from "./share";

// Palco da casa (ficha: telas 06 a 10, 13 e 14). Cartão da casa "ao vivo agora" (com o selo
// "no telão" quando há telão), a enquete com voto em 1 toque e as barras em % depois, o tempo
// com anel; encerrada, a vencedora, com "Pedir também" só quando ligada a um prato (sem
// votos, o destaque da casa); sem enquete, a próxima e o destaque. Quem não tem mesa vê o
// resultado e o aviso do QR da mesa. "Compartilhar no story" aparece com o resultado à mostra
// (enquete com votos, depois do voto, sem mesa ou encerrada; storyChoices).

const TIP_KEY = "cmu-dica-vista";

export function Stage({ onShare }: { onShare: () => void }) {
  const c = useComunidade();
  const o = useOrder();
  const s = c.state;
  const L = o.lang;
  const menu = o.menu;
  const nowSeed = s ? Date.parse(s.now) : 0;
  const pollOpen = !!s?.poll && !s.poll.closed;
  const now = useClock(c.open && pollOpen, nowSeed, c.skew);
  // Destaque pelo relógio por minuto do provider (anda sem a leitura mudar).
  const minute = c.minute || nowSeed;
  const highlight = useMemo(() => (menu ? houseHighlight(menu, new Date(minute)) : null), [menu, minute]);

  // Primeira vez: uma linha de explicação, dispensável; some também ao votar ou ao fechar.
  // Só conta como vista quando aparece no Palco (quem abre direto no Mural vê depois).
  const [tip, setTip] = useState<"off" | "on" | "out">("off");
  const tipRef = useRef<HTMLDivElement>(null);
  const onStage = c.open && c.tab === "palco";
  useEffect(() => {
    if (!onStage) return;
    let seen = true;
    try {
      seen = localStorage.getItem(TIP_KEY) === "1";
      localStorage.setItem(TIP_KEY, "1");
    } catch {}
    if (!seen) queueMicrotask(() => setTip("on"));
    return () => queueMicrotask(() => setTip("off"));
  }, [onStage]);
  const dismissTip = () => {
    const el = tipRef.current;
    if (tip !== "on" || !el) return;
    const h = el.offsetHeight + 12;
    const after = [...(el.parentElement?.children ?? [])].filter((x) => x !== el) as HTMLElement[];
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    setTip("out");
    setTimeout(
      () => {
        setTip("off");
        if (!reduce) after.forEach((x) => x.animate([{ transform: `translateY(${h}px)` }, { transform: "none" }], { duration: 380, easing: "cubic-bezier(.2,.9,.25,1)" }));
      },
      reduce ? 0 : 180,
    );
  };

  if (!s || !menu) return null;
  const logo = mediaUrl(menu.restaurant.logo_path);
  const poll = s.poll;
  const hlSource: BuySource = poll ? { kind: "palco", ref: poll.id } : null;
  const canShare = !!storyChoices(s, { mine: poll ? c.myVote(poll.id) : null, canVote: c.canVote, highlightId: null, hasItem: () => false }).poll;

  return (
    <>
      {tip !== "off" && (
        <div ref={tipRef} className={`cmu-tip${tip === "out" ? " out" : ""}`}>
          <p>{ct("tip", L)}</p>
          <button onClick={dismissTip}>{ct("tipOk", L)}</button>
        </div>
      )}

      <div className="cmu-house">
        {logo ? <img src={logo} alt="" /> : <span className="cmu-house-l" aria-hidden />}
        <div className="cmu-hn">
          <b>{menu.restaurant.name}</b>
          <span>
            <Live hidden={c.offline} />
            <em>{ct(c.offline ? "paused" : "liveNow", L)}</em>
          </span>
        </div>
        {s.has_tv && (
          <span className="cmu-seal">
            <IconTv />
            {ct("onTv", L)}
          </span>
        )}
      </div>

      {poll && !poll.closed && <PollCard poll={poll} now={now} onVoted={dismissTip} />}
      {poll && !poll.closed && !poll.has_votes && !c.myVote(poll.id) && highlight && (
        <HighlightRow item={highlight} source={hlSource} />
      )}
      {poll?.closed && <ClosedCard poll={poll} highlight={highlight} />}
      {canShare && <ShareStoryButton onClick={onShare} />}
      {s.next && (
        <div className="cmu-next">
          <IconClock />
          <div>
            <small>{ctf("nextAt", L, { t: localTime(s.next.starts_at, menu.restaurant.timezone, L) })}</small>
            <b>{questionText(s.next, L)}</b>
          </div>
        </div>
      )}
      {!poll && highlight && <WinCard item={highlight} kind="highlight" small={null} line={ct("recommends", L)} source={null} />}
      {s.mural.length > 0 && (
        <button className="cmu-peek" onClick={() => c.setTab("mural")}>
          <span className="cmu-pf3">
            {s.mural.slice(0, 3).map((p) => (
              <img key={p.id} src={p.thumb} alt="" loading="lazy" />
            ))}
          </span>
          <div>
            <small>{ct("muralNow", L)}</small>
            <b>{s.mural.length === 1 ? ct("muralCount1", L) : ctf("muralCount", L, { n: s.mural.length })}</b>
          </div>
          <IconChevron />
        </button>
      )}
    </>
  );
}

// Nome da opção no idioma do cliente (pelo prato); prato que saiu do cardápio fica com o
// texto da casa, ou "indisponível".
function optionName(opt: { label: string; item_id: string | null }, item: MenuItem | undefined, lang: string) {
  return item?.name ?? (opt.label || ct("unavailable", lang));
}

function PollCard({ poll, now, onVoted }: { poll: PublicPoll; now: number; onVoted: () => void }) {
  const c = useComunidade();
  const o = useOrder();
  const L = o.lang;
  const [msg, setMsg] = useState<CmuKey | null>(null);
  const mine = c.myVote(poll.id);
  const timing = pollTiming(poll, now);
  const over = timing.left <= 0;
  const show = !!mine || !c.canVote;
  const pcts = shownPcts(poll, mine);
  const lead = show ? leaderOf(pcts) : null;
  const locked = show || c.offline || over;

  const tap = async (id: OptionId) => {
    if (locked) return;
    setMsg(null);
    onVoted();
    const r = await c.vote(id);
    if (r.ok) return;
    const key: CmuKey =
      r.code === "too_many" ? "voteTooMany" : r.code === "table" ? "voteTable" : r.code === "poll" || r.code === "closed" ? "voteClosed" : "voteErr";
    setMsg(key);
  };

  return (
    <section className={`cmu-poll${show ? " show" : ""}`} aria-label={ct("housePoll", L)}>
      <div className="cmu-ph">
        <span className="cmu-plb">{ct("housePoll", L)}</span>
        <span className="cmu-ptm">
          {ct("closesIn", L)} <b>{clockText(timing.left)}</b>
          <Ring angle={timing.angle} />
        </span>
      </div>
      <h2 className="fd">{questionText(poll, L)}</h2>
      <div className="cmu-opts" role="group" aria-label={questionText(poll, L)}>
        {poll.options.map((opt) => {
          const item = opt.item_id ? o.itemById(opt.item_id) : undefined;
          const th = item ? thumbSrc(item) : null;
          const pct = pcts[opt.id] ?? 0;
          const isMine = mine === opt.id;
          return (
            <button
              key={opt.id}
              className={`cmu-opt${lead === opt.id ? " lead" : ""}${isMine ? " mine" : ""}`}
              onClick={() => void tap(opt.id)}
              disabled={locked}
              aria-pressed={isMine}
            >
              <i className="cmu-fill" style={{ transform: `scaleX(${show ? pct / 100 : 0})` }} />
              {th && <img className="cmu-em" src={th} alt="" />}
              <span className="cmu-tx">
                <b>{optionName(opt, item, L)}</b>
                {isMine ? <small>{ct("youVotedMark", L)}</small> : item?.description ? <small>{item.description}</small> : null}
              </span>
              <Pct value={pct} on={show} />
              <span className="cmu-rd" />
            </button>
          );
        })}
      </div>
      {!c.canVote ? (
        <div className="cmu-needmesa">
          <IconQr />
          <div>
            <b>{ct("needTable", L)}</b>
            <small>{ct("needTableSub", L)}</small>
          </div>
        </div>
      ) : (
        <p className="cmu-pf" role="status">
          {msg ? (
            ct(msg, L)
          ) : over ? (
            ct("closing", L)
          ) : mine ? (
            <>
              <b>{ct("youVoted", L)}</b> · {ct(c.state?.has_tv ? "resultLiveTv" : "resultLive", L)}
            </>
          ) : poll.has_votes ? (
            ct("tapOption", L)
          ) : (
            ct("beFirst", L)
          )}
        </p>
      )}
    </section>
  );
}

// Porcentagem que sobe até o valor em 0,7 s (direto no valor com "reduzir movimento").
function Pct({ value, on }: { value: number; on: boolean }) {
  const el = useRef<HTMLSpanElement>(null);
  const shown = useRef(0);
  useEffect(() => {
    const node = el.current;
    if (!node || !on) return;
    const from = shown.current;
    shown.current = value;
    if (from === value || matchMedia("(prefers-reduced-motion: reduce)").matches) {
      node.textContent = `${value}%`;
      return;
    }
    const t0 = performance.now();
    let raf = 0;
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / 700);
      node.textContent = `${Math.round(from + (value - from) * (1 - Math.pow(1 - k, 3)))}%`;
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value, on]);
  return (
    <span className="cmu-pc" ref={el}>
      0%
    </span>
  );
}

function ClosedCard({ poll, highlight }: { poll: PublicPoll; highlight: MenuItem | null }) {
  const o = useOrder();
  const L = o.lang;
  const q = questionText(poll, L);
  const source: BuySource = { kind: "palco", ref: poll.id };
  const win = poll.winner ? poll.options.find((x) => x.id === poll.winner) : undefined;
  if (poll.has_votes && win) {
    const item = win.item_id ? o.itemById(win.item_id) : undefined;
    const others = poll.options.filter((x) => x.id !== win.id);
    return (
      <WinCard
        item={item}
        name={optionName(win, item, L)}
        kind="winner"
        small={ctf("closedQ", L, { q })}
        line={
          <>
            {ct("wonWith", L)} <b>{win.pct}%</b>
            {others.map((x) => ` · ${optionName(x, x.item_id ? o.itemById(x.item_id) : undefined, L)} ${x.pct}%`).join("")}
          </>
        }
        itemId={win.item_id}
        source={source}
      />
    );
  }
  if (highlight) return <WinCard item={highlight} kind="highlight" small={ctf("closedNoVotesQ", L, { q })} line={ct("recommends", L)} source={source} />;
  return (
    <section className="cmu-win">
      <div className="cmu-wb">
        <small>{ctf("closedNoVotesQ", L, { q })}</small>
      </div>
    </section>
  );
}

// Cartão grande com foto: a vencedora ("🏆 Deu na enquete") ou o destaque da casa ("★").
function WinCard({
  item, name, kind, small, line, itemId, source,
}: {
  item: MenuItem | undefined;
  name?: string;
  kind: "winner" | "highlight";
  small: string | null;
  line: ReactNode;
  itemId?: string | null;
  source: BuySource;
}) {
  const o = useOrder();
  const L = o.lang;
  const photo = item ? thumbSrc(item) : null;
  const chip =
    kind === "winner" ? (
      <span className="cmu-chip">🏆 {ct("pollWon", L)}</span>
    ) : (
      <span className="cmu-chip">
        <i className="cmu-star">★</i> {ct("highlightTitle", L)}
      </span>
    );
  return (
    <section className={`cmu-win${photo ? "" : " nophoto"}`}>
      {photo ? (
        <div className="cmu-wph">
          <img src={photo} alt="" />
          {chip}
        </div>
      ) : (
        <div className="cmu-wchip">{chip}</div>
      )}
      <div className="cmu-wb">
        {small && <small>{small}</small>}
        <h2 className="fd">{name ?? item?.name ?? ""}</h2>
        <p>{line}</p>
        <BuyButton itemId={itemId === undefined ? (item?.id ?? null) : itemId} source={source} big />
      </div>
    </section>
  );
}

// Enquete aberta e ninguém votou ainda: o destaque da casa embaixo, com "Pedir também".
function HighlightRow({ item, source }: { item: MenuItem; source: BuySource }) {
  const o = useOrder();
  const th = thumbSrc(item);
  return (
    <div className="cmu-hlrow">
      {th && <img src={th} alt="" />}
      <div>
        <small>
          <i className="cmu-star">★</i> {ct("highlightLower", o.lang)}
        </small>
        <b>{item.name}</b>
      </div>
      <BuyButton itemId={item.id} source={source} />
    </div>
  );
}
