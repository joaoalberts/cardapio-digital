"use client";
/* eslint-disable @next/next/no-img-element -- miniatura do prato, já no tamanho certo */

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { halfPartners, radioStep, sizeChoices } from "@/lib/comunidade/client-logic";
import { ct } from "@/lib/comunidade/i18n";
import type { Origin } from "@/lib/comunidade/types";
import { formatPrice, thumbSrc } from "@/lib/menu/media";
import type { MenuItem } from "@/lib/menu/types";
import { flyTo } from "../order/fly";
import { useOrder } from "../order/order-context";
import { IconPlus } from "./parts";

// Folha de tamanhos dentro da Comunidade (ficha v2, tela 11): opaca (#1d1612), sem desfoque
// próprio, sobre um véu que escurece a camada; nada vaza por trás. Escolhe o tamanho e
// "Adicionar ao pedido" põe a linha com a origem da Comunidade; fecha e volta ao mesmo ponto
// (a camada não fecha). Pizza que aceita meio a meio: o aviso vem antes ("você escolhe a
// outra metade no cardápio e a Comunidade volta quando terminar") e o botão leva à escolha
// navegando pelos stories (onHalf, em layer.tsx).

export type SizesOpen = { item: MenuItem; origin: Origin | undefined };

export function SizesSheet({
  open, from, onClose, onHalf,
}: {
  open: SizesOpen;
  from: "palco" | "mural";
  onClose: () => void;
  onHalf: (item: MenuItem, option: string | null, origin: Origin | undefined) => void;
}) {
  const o = useOrder();
  const L = o.lang;
  const { item, origin } = open;
  const sizes = sizeChoices(item);
  // Como a folha do prato: começa no último tamanho (o maior, na ordem do painel).
  const [pick, setPick] = useState<string | null>(sizes.length ? sizes[sizes.length - 1].label : null);
  const cur = sizes.find((s) => s.label === pick) ?? sizes[0];
  const half = halfPartners(o.menu, item, cur?.label ?? null).length > 0;
  const addBtn = useRef<HTMLButtonElement>(null);
  const box = useRef<HTMLElement>(null);
  const th = thumbSrc(item);

  // Foco: entra na opção escolhida; ao fechar, quem abriu (o "Pedir também") volta a ter foco.
  useEffect(() => {
    const from = document.activeElement as HTMLElement | null;
    box.current?.querySelector<HTMLElement>('[aria-checked="true"], .cmu-buy')?.focus({ preventScroll: true });
    return () => from?.focus?.({ preventScroll: true });
  }, []);

  // Setas mudam a opção e levam o foco junto (o grupo tem um só item na ordem do Tab).
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const next = radioStep(sizes.findIndex((s) => s.label === cur?.label), sizes.length, e.key);
    if (next === null) return;
    e.preventDefault();
    setPick(sizes[next].label);
    e.currentTarget.querySelectorAll<HTMLElement>('[role="radio"]')[next]?.focus({ preventScroll: true });
  };

  const add = () => {
    if (!cur) return;
    o.add({ item: item.id, option: cur.label, half: null, qty: 1, note: "", ...(origin ?? {}) }, null, { quiet: true });
    const cart = addBtn.current?.closest(".cmu-layer")?.querySelector<HTMLElement>(".cmu-cart");
    if (addBtn.current && cart) void flyTo(addBtn.current, cart, th);
    onClose();
  };

  return (
    <>
      <div className="cmu-scrim" onClick={onClose} aria-hidden />
      <section ref={box} className="cmu-sizes" role="dialog" aria-modal="true" aria-label={ct("sizesAria", L)}>
        <button className="cmu-grab" onClick={onClose} aria-label={ct("sizesClose", L)} />
        <div className={`cmu-sh${th ? "" : " nophoto"}`}>
          {th && <img src={th} alt="" />}
          <div>
            <b className="fd">{item.name}</b>
            {item.description && <span>{item.description}</span>}
          </div>
        </div>
        <p className="cmu-sk">{ct(from === "mural" ? "sizesLeadMural" : "sizesLeadPalco", L)}</p>
        <div className="cmu-so" role="radiogroup" aria-label={ct("sizesAria", L)} onKeyDown={onKey}>
          {sizes.map((sz) => (
            <button
              key={sz.label ?? "-"}
              role="radio"
              aria-checked={sz.label === cur?.label}
              tabIndex={sz.label === cur?.label ? 0 : -1}
              onClick={() => setPick(sz.label)}
            >
              <span className="cmu-rad" aria-hidden />
              <span>{sz.label ?? ct("sizeWhole", L)}</span>
              <span className="cmu-pr">{formatPrice(sz.cents, L)}</span>
            </button>
          ))}
        </div>
        <button ref={addBtn} className="cmu-buy big" onClick={add} disabled={!cur}>
          <span className="cmu-disc" aria-hidden>
            <IconPlus />
          </span>
          <span className="cmu-t">{ct("sizesAdd", L)}</span>
          {cur && <span className="cmu-pr">{formatPrice(cur.cents, L)}</span>}
        </button>
        {half && (
          <div className="cmu-half">
            <p>{ct("halfNote", L)}</p>
            <button className="cmu-ghost" onClick={() => onHalf(item, cur?.label ?? null, origin)}>
              {ct("halfGo", L)}
            </button>
          </div>
        )}
      </section>
    </>
  );
}
