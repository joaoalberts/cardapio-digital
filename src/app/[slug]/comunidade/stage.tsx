"use client";
/* eslint-disable @next/next/no-img-element -- fotos dos pratos e logo já vêm no tamanho certo */

import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import {
  houseHighlight, localTime, pollOutcome, pollTiming, priceInfo, questionText, shownPcts, soleLeader, stageCover, storyChoices,
} from "@/lib/comunidade/client-logic";
import { ct, ctf, type CmuKey } from "@/lib/comunidade/i18n";
import type { OptionId, PublicOption, PublicPoll } from "@/lib/comunidade/types";
import { mediaUrl, thumbSrc } from "@/lib/menu/media";
import type { MenuItem } from "@/lib/menu/types";
import { useOrder } from "../order/order-context";
import { BuyButton, useBuyState, type BuySource } from "./buy-button";
import { houseCover, IconCheck, IconQr, IconShare, Live, priceText, Ring, useClock } from "./parts";
import { useComunidade } from "./provider";

// Palco da casa (ficha v2, telas 04 a 09, 14 e 15): capa de revista com o tríptico das fotos
// das opções (cada coluna também vota), a pergunta grande na fonte da casa e as opções como
// cartões com foto, nome e preço. Depois do voto, as barras em % e o cartão "Seu voto" com
// "Pedir também" (o voto leva à venda). Encerrada: "Deu <prato>" com a foto inteira na capa e
// o anel ônix e champanhe no "Pedir também"; empate com as duas fotos; vencedora que não é
// prato (ou sem votos), "Pra acompanhar" com o destaque da casa. Sem mesa: vê o resultado,
// não vota. Sem conexão: pausado no último valor, sem toque e sem "Pedir também".
// "Postar" (story) aparece com o resultado à mostra (storyChoices).

const TIP_KEY = "cmu-dica-vista";

type Ctx = {
  menu: NonNullable<ReturnType<typeof useOrder>["menu"]>;
  L: string;
  itemOf: (o: { item_id: string | null }) => MenuItem | undefined;
  nameOf: (o: PublicOption) => string;
  logo: string | null;
  house: string | null;
  highlight: MenuItem | null;
  canShare: boolean;
  onShare: () => void;
};

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

  // Primeira vez: um aviso de uma frase sobre a capa, com "Entendi". Só conta como visto
  // quando aparece no Palco (quem abre direto no Mural vê depois); some também ao votar.
  const [tip, setTip] = useState<"off" | "on" | "out">("off");
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
  const tipTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(tipTimer.current), []);
  const dismissTip = () => {
    if (tip !== "on") return;
    setTip("out");
    tipTimer.current = setTimeout(() => setTip("off"), matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 200);
  };

  if (!s || !menu) return null;
  const poll = s.poll;
  const x: Ctx = {
    menu,
    L,
    itemOf: (opt) => (opt.item_id ? o.itemById(opt.item_id) : undefined),
    // Nome da opção no idioma do cliente (pelo prato); prato que saiu do cardápio fica com o
    // texto da casa, ou "indisponível".
    nameOf: (opt) => (opt.item_id ? o.itemById(opt.item_id)?.name : undefined) ?? (opt.label || ct("unavailable", L)),
    logo: mediaUrl(menu.restaurant.logo_path),
    house: houseCover(menu),
    highlight,
    canShare: !!storyChoices(s, { mine: poll ? c.myVote(poll.id) : null, canVote: c.canVote, highlightId: null, hasItem: () => false }).poll,
    onShare,
  };

  return (
    <>
      {tip !== "off" && (
        <div className={`cmu-note${tip === "out" ? " out" : ""}`} role="note">
          <p>
            <b>{ct("tipBold", L)}</b> {ct("tipRest", L)}
          </p>
          <button onClick={dismissTip}>{ct("tipOk", L)}</button>
        </div>
      )}
      {poll && !poll.closed && <LivePoll x={x} poll={poll} now={now} onVoted={dismissTip} />}
      {poll?.closed && <ClosedPoll x={x} poll={poll} />}
      {!poll && <NoPoll x={x} />}
      <Strip x={x} />
    </>
  );
}

// Linha de cima da capa: logo com aro da casa, o rótulo, o "ao vivo" e o anel do tempo.
function Kick({ x, label, live, ring }: { x: Ctx; label: string; live?: ReactNode; ring?: ReactNode }) {
  return (
    <div className="cmu-kick">
      {x.logo ? <img className="cmu-ml" src={x.logo} alt="" /> : <i className="cmu-ml" aria-hidden />}
      <span className="cmu-kl">{label}</span>
      {live}
      {ring}
    </div>
  );
}

// Fotos da capa encerrada (vencedora, empate, destaque): as fotos inteiras lado a lado.
function Solo({ photos }: { photos: (string | null)[] }) {
  const ok = photos.filter((p): p is string => !!p);
  return (
    <div className="cmu-solo" style={{ "--n": Math.max(1, ok.length) } as CSSProperties}>
      {ok.map((src, k) => (
        <figure key={k}>
          <img src={src} alt="" />
          <span className="cmu-streak" />
        </figure>
      ))}
    </div>
  );
}

function LivePoll({ x, poll, now, onVoted }: { x: Ctx; poll: PublicPoll; now: number; onVoted: () => void }) {
  const c = useComunidade();
  const { L } = x;
  const [msg, setMsg] = useState<CmuKey | null>(null);
  const mine = c.myVote(poll.id);
  const timing = pollTiming(poll, now);
  const over = timing.left <= 0;
  const show = !!mine || !c.canVote;
  const pcts = shownPcts(poll, mine);
  const lead = show ? soleLeader(pcts) : null;
  const locked = show || c.offline || over;
  const items = poll.options.map((opt) => x.itemOf(opt));
  const tri = stageCover(items.map((i) => (i ? thumbSrc(i) : null)));
  const q = questionText(poll, L);

  const tap = async (id: OptionId) => {
    if (locked) return;
    setMsg(null);
    onVoted();
    const r = await c.vote(id);
    if (r.ok) return;
    setMsg(r.code === "too_many" ? "voteTooMany" : r.code === "table" ? "voteTable" : r.code === "poll" || r.code === "closed" ? "voteClosed" : "voteErr");
  };

  const live = (
    <span className="cmu-lv">
      <Live off={c.offline} />
      {c.offline ? (
        <em>{ct("pausedShort", L)}</em>
      ) : s_hasTv(c) ? (
        <>
          <em className="cmu-lv-l">{ct("liveTv", L)}</em>
          <em className="cmu-lv-s">{ct("live", L)}</em>
        </>
      ) : (
        <em>{ct("live", L)}</em>
      )}
    </span>
  );

  const go: ReactNode = msg ? (
    <span className="cmu-gm">{ct(msg, L)}</span>
  ) : !c.canVote ? (
    <span className="cmu-gm">{ct(s_hasTv(c) ? "readonlyTv" : "readonly", L)}</span>
  ) : c.offline ? (
    <span className="cmu-gm">{ct(mine ? "offlineVoted" : "offlineWait", L)}</span>
  ) : over ? (
    <span className="cmu-gm">{ct("closing", L)}</span>
  ) : mine ? (
    <>
      {ct("voteSaved", L)} <span className="cmu-gm">· {ct("resultLive", L)}</span>
    </>
  ) : (
    ct("tapDish", L)
  );

  const mineOpt = mine ? poll.options.find((p) => p.id === mine) : undefined;

  return (
    <>
      <div className={`cmu-cov${show ? " voted" : ""}`}>
        {tri ? (
          <div className="cmu-tri" style={{ "--n": tri.length } as CSSProperties}>
            {poll.options.map((opt, k) => (
              <button
                key={opt.id}
                className={`cmu-col${lead === opt.id ? " lead" : ""}`}
                onClick={() => void tap(opt.id)}
                disabled={locked}
                tabIndex={-1}
                aria-hidden
              >
                <img src={tri[k]} alt="" />
                <span className="cmu-streak" />
              </button>
            ))}
          </div>
        ) : (
          <Solo photos={[x.house]} />
        )}
        <div className="cmu-ptx">
          <Kick x={x} label={ct("housePoll", L)} live={live} ring={<Ring angle={timing.angle} left={timing.left} lang={L} paused={c.offline} />} />
          <h2 className="fd">{q}</h2>
          <p className="cmu-gol" role="status">
            {go}
          </p>
        </div>
      </div>

      <div className={`cmu-opts${c.offline ? " dim" : ""}`} role="group" aria-label={q}>
        {poll.options.map((opt, k) => {
          const item = items[k];
          const th = item ? thumbSrc(item) : null;
          const pct = pcts[opt.id] ?? 0;
          const isMine = mine === opt.id;
          const pr = priceText(priceInfo(item), L);
          return (
            <button
              key={opt.id}
              className={`cmu-opt${lead === opt.id ? " lead" : ""}${th ? "" : " nophoto"}`}
              onClick={() => void tap(opt.id)}
              disabled={locked}
              aria-pressed={isMine}
            >
              <span className="cmu-fill" style={{ "--p": show ? pct : 0 } as CSSProperties} />
              {th && <img className="cmu-oth" src={th} alt="" />}
              <span className="cmu-tx">
                <span className="cmu-on fd">{x.nameOf(opt)}</span>
                {isMine ? (
                  <span className="cmu-od mine">
                    <IconCheck />
                    {ct("yourVoteMark", L)}
                  </span>
                ) : pr || item?.description ? (
                  <span className="cmu-od">
                    {pr && <b>{pr}</b>}
                    {item?.description}
                  </span>
                ) : null}
              </span>
              <span className="cmu-rt">
                {show ? (
                  <span className="cmu-pc">
                    {pct}
                    <small>%</small>
                  </span>
                ) : (
                  <span className="cmu-radio" />
                )}
              </span>
            </button>
          );
        })}
      </div>

      {!c.canVote ? (
        <div className="cmu-nomesa">
          <IconQr />
          <div>
            <b>{ct("needTable", L)}</b>
            <span>{ct("needTableSub", L)}</span>
          </div>
        </div>
      ) : c.offline ? (
        <p className="cmu-hint">{ct("offlineHint", L)}</p>
      ) : mineOpt ? (
        <YourVote x={x} poll={poll} opt={mineOpt} />
      ) : null}
    </>
  );
}

const s_hasTv = (c: ReturnType<typeof useComunidade>) => !!c.state?.has_tv;

// Logo depois do voto: o voto vira venda (ficha v2, tela 06).
function YourVote({ x, poll, opt }: { x: Ctx; poll: PublicPoll; opt: PublicOption }) {
  const { L } = x;
  const item = x.itemOf(opt);
  const th = item ? thumbSrc(item) : null;
  const pr = priceText(priceInfo(item), L);
  const buy = useBuyState(opt.item_id) !== "hidden";
  return (
    <div className="cmu-after">
      <div className={`cmu-who${th ? "" : " nophoto"}`}>
        {th && <img src={th} alt="" />}
        <small>{ct("yourVote", L)}</small>
        <b className="fd">{x.nameOf(opt)}</b>
        {item && pr && (
          <span>
            <em>{pr}</em> · {ct("yourVoteWhy", L)}
          </span>
        )}
      </div>
      {(buy || x.canShare) && (
        <div className="cmu-arow">
          {buy && <BuyButton itemId={opt.item_id} source={{ kind: "palco", ref: poll.id }} variant="wide" price />}
          {x.canShare && (
            <button className={`cmu-ghost${buy ? "" : " grow"}`} onClick={x.onShare}>
              <IconShare />
              {ct("post", L)}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// "Pra acompanhar: ★ destaque da casa" (vencedora que não é prato, ou ninguém votou).
function WithIt({ x, source }: { x: Ctx; source: BuySource }) {
  const h = x.highlight;
  const buy = useBuyState(h?.id ?? null) !== "hidden";
  if (!h || !buy) return null;
  const th = thumbSrc(h);
  return (
    <div className="cmu-with">
      {th && <img src={th} alt="" />}
      <div>
        <small>
          {ct("withIt", x.L)} · <i>★</i> {ct("highlightLower", x.L)}
        </small>
        <b className="fd">{h.name}</b>
      </div>
      <BuyButton itemId={h.id} source={source} variant="sm" price />
    </div>
  );
}

function PostButton({ x }: { x: Ctx }) {
  if (!x.canShare) return null;
  return (
    <button className="cmu-ghost" onClick={x.onShare}>
      <IconShare />
      {ct("postResult", x.L)}
    </button>
  );
}

function ClosedPoll({ x, poll }: { x: Ctx; poll: PublicPoll }) {
  const { L } = x;
  const q = questionText(poll, L);
  const source: BuySource = { kind: "palco", ref: poll.id };
  const out = pollOutcome(poll);
  const byId = (id: OptionId) => poll.options.find((p) => p.id === id)!;
  const photo = (opt: PublicOption) => {
    const i = x.itemOf(opt);
    return (i ? thumbSrc(i) : null) ?? null;
  };
  const winId = out.kind === "win" ? out.id : null;
  const winBuy = useBuyState(winId ? byId(winId).item_id : null);

  if (out.kind === "win") {
    const win = byId(out.id);
    return (
      <>
        <div className="cmu-cov win">
          <Solo photos={[photo(win) ?? x.house]} />
          <div className="cmu-ptx">
            <Kick x={x} label={ct("housePollClosed", L)} />
            <p className="cmu-pq fd">{q}</p>
            <h2 className="fd">{ctf("won", L, { name: x.nameOf(win) })}</h2>
          </div>
        </div>
        <div className="cmu-res">
          <span className="cmu-big">
            {win.pct}
            <small>%</small>
          </span>
          <span className="cmu-rest">
            {out.rest.map((id) => {
              const r = byId(id);
              const th = photo(r);
              return (
                <span className="cmu-rr" key={id}>
                  {th && <img src={th} alt="" />}
                  {x.nameOf(r)} <b>{r.pct}%</b>
                </span>
              );
            })}
          </span>
        </div>
        <div className="cmu-ctas">
          {winBuy !== "hidden" ? (
            <div className="cmu-gowrap">
              <BuyButton itemId={win.item_id} source={source} variant="big" price />
            </div>
          ) : !win.item_id ? (
            <WithIt x={x} source={source} />
          ) : null}
          <PostButton x={x} />
        </div>
      </>
    );
  }

  if (out.kind === "tie") {
    const tied = out.ids.map(byId);
    const outside = out.rest[0] ? byId(out.rest[0]) : null;
    return (
      <>
        <div className="cmu-cov win">
          <Solo photos={tied.map((t) => photo(t) ?? x.house)} />
          <div className="cmu-ptx">
            <Kick x={x} label={ct("housePollClosed", L)} />
            <p className="cmu-pq fd">{q}</p>
            <h2 className="fd">{ct("tie", L)}</h2>
          </div>
        </div>
        <div className="cmu-tie" style={{ "--n": tied.length } as CSSProperties}>
          {tied.map((t) => {
            const pr = priceText(priceInfo(x.itemOf(t)), L);
            return (
              <div key={t.id}>
                <b className="fd">{x.nameOf(t)}</b>
                <span>
                  <em>{t.pct}%</em>
                  {pr}
                </span>
                <BuyButton itemId={t.item_id} source={source} variant="sm" />
              </div>
            );
          })}
        </div>
        <p className="cmu-hint">{outside ? ctf("tieRest", L, { name: x.nameOf(outside), p: outside.pct }) : ct("tieBoth", L)}</p>
        <div className="cmu-ctas">
          <PostButton x={x} />
        </div>
      </>
    );
  }

  // Ninguém votou: a pergunta e o destaque da casa para acompanhar.
  return (
    <>
      <div className="cmu-cov win">
        <Solo photos={[(x.highlight ? thumbSrc(x.highlight) : null) ?? x.house]} />
        <div className="cmu-ptx">
          <Kick x={x} label={ct("housePollClosed", L)} />
          <p className="cmu-pq fd">{q}</p>
          <h2 className="fd">{ct("noVotes", L)}</h2>
        </div>
      </div>
      <div className="cmu-ctas">
        <WithIt x={x} source={source} />
      </div>
    </>
  );
}

// Sem enquete: o destaque da casa na capa, com "Pedir também" (sem origem: não há enquete).
function NoPoll({ x }: { x: Ctx }) {
  const { L } = x;
  const h = x.highlight;
  return (
    <>
      <div className="cmu-cov win">
        <Solo photos={[(h ? thumbSrc(h) : null) ?? x.house]} />
        <div className="cmu-ptx">
          <Kick x={x} label={h ? `★ ${ct("highlightTitle", L)}` : ct("noPoll", L)} />
          <h2 className="fd">{h ? h.name : ct("noPoll", L)}</h2>
          {h?.description && <p className="cmu-gol cmu-gm">{h.description}</p>}
        </div>
      </div>
      {h && (
        <div className="cmu-ctas">
          <BuyButton itemId={h.id} source={null} variant="big" price />
        </div>
      )}
    </>
  );
}

// Rodapé único: a próxima enquete e o Mural, separados por um fio da cor da casa.
function Strip({ x }: { x: Ctx }) {
  const c = useComunidade();
  const s = c.state!;
  const n = s.mural.length;
  if (!s.next && !n) return null;
  return (
    <div className={`cmu-strip${s.next && n ? "" : " one"}`}>
      {s.next && (
        <div className="cmu-sb">
          <span className="cmu-stx">
            <small>{ctf("nextAt", x.L, { t: localTime(s.next.starts_at, x.menu.restaurant.timezone, x.L) })}</small>
            <b>{questionText(s.next, x.L)}</b>
          </span>
        </div>
      )}
      {s.next && n > 0 && <i aria-hidden />}
      {n > 0 && (
        <button className="cmu-sb" onClick={() => c.setTab("mural")}>
          <span className="cmu-stack">
            {s.mural.slice(0, 2).map((p) => (
              <img key={p.id} src={p.thumb} alt="" loading="lazy" />
            ))}
          </span>
          <span className="cmu-stx">
            <small>{ct("stripMural", x.L)}</small>
            <b>{n === 1 ? ct("stripPhotos1", x.L) : ctf("stripPhotos", x.L, { n })}</b>
          </span>
        </button>
      )}
    </div>
  );
}
