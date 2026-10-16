"use client";
/* eslint-disable @next/next/no-img-element -- fotos do cardápio ocupam a tela toda e já vêm em tamanho certo do Storage */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { preconnect } from "react-dom";
import type { CSSProperties, PointerEvent as ReactPointerEvent, ReactNode, RefObject } from "react";
import { fetchPublicMenu } from "@/lib/menu/client";
import { DEFAULT_FONT_THEME, isFontTheme } from "@/lib/menu/font-themes";
import { inWindow, statusLabel, type StatusLabel } from "@/lib/menu/hours";
import { countryLabel, tagLabel } from "@/lib/menu/tags";
import { paymentLabel } from "@/lib/menu/payments";
import { LANG_FLAG, LANG_NAME, pickLanguage, t as tr, type StringKey } from "@/lib/menu/i18n";
import { CARD_W, formatPrice, mediaUrl, photoSrc, posterSrc, STORY_W, THUMB_W, thumbSrc, videoSrc } from "@/lib/menu/media";
import { sizedSrc } from "@/lib/images/sized";
import { preloadHls, useAutoplay, useHls, warmVideo } from "@/lib/menu/use-hls";
import { openStartGate, useStartGate } from "@/lib/menu/start-gate";
import type { MenuCategory, MenuItem, MenuMedia, PublicMenu } from "@/lib/menu/types";
import { Flag } from "./flag";
import { OrderProvider, useOrder } from "./order/order-context";
import { OrderLayer } from "./order/order-layer";
import { StoryBuy } from "./order/story-actions";
import { SpecialStory } from "./order/special-story";
import {
  SPECIAL_KEY, afterShown, ensureFirstEligible, injectOffer, nextTimedStart, parseClock, pickSpecial, placeOffer,
  type OfferPlacement, type SpecialClock,
} from "@/lib/menu/special-schedule";
import { CartButton } from "./order/cart-button";

const AUTO_MS = 6000; // cada foto fica 6 s; vídeo usa a própria duração
const VIDEO_FALLBACK_MS = AUTO_MS * 2.5; // vídeo que não carrega não trava o cardápio
const LANG_KEY = "cardapio-lang";

type View = {
  open: boolean;
  cur: number; // categoria na tela
  target: number; // categoria para onde a animação vai
  idx: number[]; // item atual de cada categoria
  userPaused: boolean;
  held: boolean; // dedo segurando a tela
  listOpen: boolean;
  listCat: number;
  langOpen: boolean;
};

type Gesture = {
  id: number;
  x: number;
  y: number;
  t: number;
  mode: "h" | "v" | "x" | null;
  startPos: number;
  lastX: number;
  lastY: number;
  lastT: number;
  vx: number;
  vy: number;
  held: boolean;
};

const isVideo = (item: MenuItem | undefined) => item?.media[0]?.kind === "video";

const FEATURED_ID = "destaques";

// Categorias que o cliente vê agora: só as com pratos e dentro do horário (ex.: almoço),
// com "Destaques" na frente quando o restaurante marcou pratos em destaque.
// Sem relógio (primeira pintura, igual à do servidor) o horário ainda não filtra.
function visibleCats(menu: PublicMenu, now: number | null): MenuCategory[] {
  const tz = menu.restaurant.timezone;
  const base = menu.categories.filter(
    (c) => c.items.length > 0 && (now == null || inWindow(c.available_from, c.available_to, tz, new Date(now))),
  );
  const featured = base.flatMap((c) => c.items.filter((i) => i.featured));
  if (!featured.length) return base;
  const first = featured.find((i) => i.media[0]);
  return [
    { id: FEATURED_ID, name: tr("featured", menu.restaurant.language), items: featured, cover: first?.media[0] ?? null },
    ...base,
  ];
}

export function MenuApp(props: { initialMenu: PublicMenu; tableTag?: ReactNode }) {
  return (
    <OrderProvider slug={props.initialMenu.restaurant.slug}>
      <MenuAppInner {...props} />
    </OrderProvider>
  );
}

function MenuAppInner({ initialMenu, tableTag }: { initialMenu: PublicMenu; tableTag?: ReactNode }) {
  const slug = initialMenu.restaurant.slug;
  const [menu, setMenuState] = useState(initialMenu);
  const menuRef = useRef(initialMenu);
  const menus = useRef(new Map<string, PublicMenu>([[initialMenu.restaurant.language, initialMenu]]));
  const lang = menu.restaurant.language;
  const order = useOrder();
  const { syncMenu, setViewerOpen, setCurrent } = order;
  const sheetOpen = order.sheetOpenRef;
  const sheetNow = useRef(false); // espelho local: o ref do provider só atualiza depois dos efeitos deste componente
  const sheetOpenNow = order.sheet !== null;
  useEffect(() => syncMenu(menu), [menu, syncMenu]);
  // Vídeos e capas vêm do Mux: a conexão já abre junto com a página. O player de vídeo
  // carrega quando o celular fica livre, antes do primeiro toque num story.
  preconnect("https://stream.mux.com", { crossOrigin: "anonymous" });
  preconnect("https://image.mux.com");
  // Abertura: o banner vem primeiro; o resto (vídeos dos cards, player, listas de vídeo)
  // espera ele tocar. Sem banner em vídeo, ou se ele demorar, libera logo. Se a pessoa
  // já rolar ou tocar na tela, libera na hora (ela quer ver os cards).
  const gate = useStartGate();
  const hasHeroVideo = !!(initialMenu.restaurant.cover?.kind === "video" || (!initialMenu.restaurant.cover && initialMenu.restaurant.cover_video_path));
  useEffect(() => {
    const t = setTimeout(openStartGate, hasHeroVideo ? 3500 : 300);
    const now = () => openStartGate();
    addEventListener("scroll", now, { passive: true, once: true });
    addEventListener("pointerdown", now, { passive: true, once: true });
    return () => {
      clearTimeout(t);
      removeEventListener("scroll", now);
      removeEventListener("pointerdown", now);
    };
  }, [hasHeroVideo]);
  useEffect(() => {
    if (!gate) return;
    const idle = window.requestIdleCallback ?? ((f: () => void) => setTimeout(f, 1500));
    idle(() => preloadHls());
  }, [gate]);
  // Primeiro prato de cada categoria em vídeo: conexão aberta antes do toque no card.
  const firstVideos = useMemo(
    () =>
      visibleCats(menu, null)
        .slice(0, 12)
        .map((c) => c.items[0]?.media[0])
        .filter((m): m is MenuMedia => m?.kind === "video")
        .map((m) => videoSrc(m)),
    [menu],
  );
  useEffect(() => {
    if (!gate) return;
    const idle = window.requestIdleCallback ?? ((f: () => void) => setTimeout(f, 2500));
    idle(() => firstVideos.forEach(warmVideo));
  }, [firstVideos, gate]);
  // Relógio do horário das categorias: começa depois da primeira pintura e anda a cada minuto.
  const [now, setNow] = useState<number | null>(null);
  // Oferta relâmpago: o produto especial sorteado entra como story extra na categoria
  // (special-schedule.ts decide quando e onde; aqui só se injeta e se reage ao fim).
  const [placement, setPlacement] = useState<OfferPlacement | null>(null);
  const specialItem = useMemo(
    () => (placement ? (menu.specials?.items.find((i) => i.id === placement.itemId) ?? null) : null),
    [menu, placement],
  );
  const cats = useMemo(() => injectOffer(visibleCats(menu, now), placement, specialItem), [menu, now, placement, specialItem]);
  const catsRef = useRef(cats);
  const t = (k: StringKey) => tr(k, lang);

  const [view, setView] = useState<View>({
    open: false,
    cur: 0,
    target: 0,
    idx: cats.map(() => 0),
    userPaused: false,
    held: false,
    listOpen: false,
    listCat: 0,
    langOpen: false,
  });
  useEffect(() => setViewerOpen(view.open), [view.open, setViewerOpen]);
  // Prato do story na tela: a barrinha da outra metade da pizza usa para oferecer "½ Sabor".
  const storyItem = view.open ? (cats[view.cur]?.items[view.idx[view.cur]] ?? null) : null;
  useEffect(() => setCurrent(storyItem), [storyItem, setCurrent]);
  // O ref é a fonte da verdade para o código imperativo (gestos, animação);
  // o estado só serve para desenhar.
  const viewRef = useRef(view);
  const update = useCallback((patch: Partial<View>) => {
    const next = { ...viewRef.current, ...patch };
    viewRef.current = next;
    setView(next);
  }, []);

  const [toast, setToast] = useState<string | null>(null);
  const [hint, setHint] = useState(false);
  const [relang, setRelang] = useState(false);
  const [homeTab, setHomeTab] = useState(0);
  const [infoOpen, setInfoOpen] = useState(false);
  const [status, setStatus] = useState<StatusLabel | null>(null);

  const viewerRef = useRef<HTMLDivElement>(null);
  const panelEls = useRef<(HTMLDivElement | null)[]>([]);
  const vTabsRef = useRef<HTMLDivElement>(null);
  const lTabsRef = useRef<HTMLDivElement>(null);
  const hTabsRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const heroVidRef = useRef<HTMLVideoElement>(null);
  const cardsHeld = useRef(false);
  const closing = useRef(false);
  const cardEls = useRef<(HTMLButtonElement | null)[]>([]);
  const pos = useRef(0);
  const settled = useRef(true);
  const anim = useRef(0);
  const raf = useRef(0);
  const itemStart = useRef(0);
  const elapsed = useRef(0);
  const gesture = useRef<Gesture | null>(null);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const justOpened = useRef(false);
  const hintShown = useRef(false);
  const reduce = useRef(false);

  const catsOf = () => catsRef.current;
  useLayoutEffect(() => {
    catsRef.current = cats;
    // Mudou a lista (horário, idioma): cada categoria volta ao primeiro prato.
    if (viewRef.current.idx.length !== cats.length) {
      const v = viewRef.current;
      const cur = Math.min(v.cur, Math.max(0, cats.length - 1));
      const next = { ...v, idx: cats.map(() => 0), cur, target: cur, listCat: Math.min(v.listCat, cur) };
      viewRef.current = next;
      setView(next);
    }
  }, [cats]);
  useEffect(() => {
    const clock = () => {
      // Com o cardápio aberto, a lista não muda debaixo do dedo do cliente.
      if (!viewRef.current.open) setNow(Date.now());
    };
    const first = setTimeout(clock, 0);
    const id = setInterval(clock, 60_000);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, []);

  const showToast = useCallback((text: string) => {
    setToast(text);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 1800);
  }, []);

  const playing = useCallback(() => {
    const v = viewRef.current;
    return (
      v.open &&
      !v.userPaused &&
      !v.held &&
      !v.listOpen &&
      !v.langOpen &&
      !sheetOpen.current &&
      !sheetNow.current &&
      settled.current &&
      document.visibilityState === "visible"
    );
  }, [sheetOpen]);

  const resetTimer = useCallback(() => {
    elapsed.current = 0;
    itemStart.current = performance.now();
  }, []);

  // Cubo entre categorias: só transform e opacity, que rodam na GPU.
  const layout = useCallback(() => {
    const w = viewerRef.current?.clientWidth ?? 0;
    panelEls.current.forEach((p, i) => {
      if (!p) return;
      const o = i - pos.current;
      if (Math.abs(o) >= 1) {
        p.style.visibility = "hidden";
        p.style.transform = `translateX(${o * 100}%)`;
        return;
      }
      p.style.visibility = "visible";
      if (reduce.current) {
        p.style.transform = `translateX(${o * w}px)`;
        return;
      }
      p.style.transformOrigin = `${o < 0 ? "100%" : "0%"} 50%`;
      p.style.transform = `translateX(${o * w}px) rotateY(${o * 80}deg)`;
      const dim = p.querySelector<HTMLElement>(".dim");
      if (dim) dim.style.opacity = String(Math.min(0.6, Math.abs(o) * 0.7));
    });
  }, []);

  const syncPlayback = useCallback(() => {
    const v = viewRef.current;
    panelEls.current.forEach((p, i) => {
      const vid = p?.querySelector("video");
      if (!vid) return;
      const want = i === v.cur && playing();
      vid.dataset.want = want ? "1" : "";
      if (want) vid.play().catch(() => {});
      else vid.pause();
    });
    // Story aberto cobre a capa. Ao fechar, a capa já volta a tocar no próprio toque de
    // fechar (`closing`): o navegador do WhatsApp/Instagram só aceita dar play em vídeo
    // dentro de um toque, e depois da animação de saída o toque já tinha "expirado".
    const covered = (v.open && !closing.current) || document.visibilityState !== "visible";
    const hero = heroVidRef.current;
    if (hero) {
      // Com o story aberto o banner fica parado ("hold"), e o toque não o religa.
      const hold = covered;
      hero.dataset.hold = hold ? "1" : "";
      hero.dataset.want = hold ? "" : "1";
      if (hold) hero.pause();
      else hero.play().catch(() => {});
    }
    // Vídeos das categorias da capa: parados enquanto o story está aberto (senão seguem
    // tocando por baixo e disputam o celular com o vídeo do story). Ao fechar, volta a
    // tocar o que está na tela.
    const holdCards = covered;
    if (holdCards !== cardsHeld.current) {
      cardsHeld.current = holdCards;
      const cards = [...document.querySelectorAll<HTMLVideoElement>("video[data-loop]")];
      cards.forEach((o) => {
        o.dataset.hold = holdCards ? "1" : "";
        o.dataset.want = "";
        o.pause();
      });
      if (!holdCards)
        cards
          .filter((o) => o.dataset.vis === "1")
          .forEach((o) => {
            o.dataset.want = "1";
            o.play().catch(() => {});
          });
    }
  }, [playing]);

  // Folha ou carrinho abriu/fechou: pausa ou retoma o vídeo pelo caminho de sempre.
  useEffect(() => {
    sheetNow.current = sheetOpenNow;
    syncPlayback();
  }, [sheetOpenNow, syncPlayback]);

  const scrollTab = useCallback((c: number) => {
    centerTab(vTabsRef.current, c, !reduce.current);
  }, []);

  const goCat = useCallback(
    (to: number) => {
      const n = catsOf().length;
      to = Math.max(0, Math.min(n - 1, to));
      update({ target: to });
      const from = pos.current;
      const dur = reduce.current ? 1 : Math.max(180, Math.min(420, Math.abs(to - from) * 420));
      const t0 = performance.now();
      settled.current = false;
      syncPlayback();
      cancelAnimationFrame(anim.current);
      const ease = (x: number) => 1 - Math.pow(1 - x, 3);
      const step = (now: number) => {
        const k = Math.min(1, (now - t0) / dur);
        pos.current = from + (to - from) * ease(k);
        layout();
        if (k < 1) {
          anim.current = requestAnimationFrame(step);
          return;
        }
        pos.current = to;
        layout();
        settled.current = true;
        update({ cur: to, target: to });
        resetTimer();
        scrollTab(to);
      };
      anim.current = requestAnimationFrame(step);
    },
    [layout, resetTimer, scrollTab, syncPlayback, update],
  );

  const setItem = useCallback(
    (c: number, i: number) => {
      const idx = [...viewRef.current.idx];
      idx[c] = i;
      update({ idx });
      if (c === viewRef.current.cur) resetTimer();
    },
    [resetTimer, update],
  );

  const next = useCallback(() => {
    const { cur, idx } = viewRef.current;
    const list = catsOf();
    if (idx[cur] < list[cur].items.length - 1) setItem(cur, idx[cur] + 1);
    else if (cur < list.length - 1) {
      const nidx = [...idx];
      nidx[cur + 1] = 0;
      update({ idx: nidx });
      goCat(cur + 1);
    } else {
      // Fim: volta para o começo (primeira categoria, primeiro prato) e segue tocando.
      // A categoria atual mantém o prato até sair da tela, para não piscar durante a troca.
      update({ idx: idx.map((v, i) => (i === cur && cur !== 0 ? v : 0)) });
      if (cur === 0) resetTimer();
      else goCat(0);
    }
  }, [goCat, resetTimer, setItem, update]);

  const prev = useCallback(() => {
    const { cur, idx } = viewRef.current;
    if (idx[cur] > 0) setItem(cur, idx[cur] - 1);
    else if (cur > 0) goCat(cur - 1);
    else setItem(cur, 0);
  }, [goCat, setItem]);

  // ---------- Oferta relâmpago ----------
  // Relógio por cliente no localStorage (sem ele, vale só nesta visita). Um story especial
  // visto e encerrado (pegou, perdeu ou o cliente passou) espera o intervalo do produto.
  const clock = useRef<SpecialClock | null>(null);
  const placementRef = useRef<OfferPlacement | null>(null);
  const offerShown = useRef(false); // o story da oferta já ficou na tela
  const seen = useRef({ count: 0, last: "" });
  useEffect(() => {
    placementRef.current = placement;
  }, [placement]);
  const readClock = useCallback((): SpecialClock => {
    if (!clock.current) {
      try {
        clock.current = parseClock(localStorage.getItem(SPECIAL_KEY(slug)));
      } catch {
        clock.current = parseClock(null);
      }
    }
    return clock.current;
  }, [slug]);
  const saveClock = useCallback(
    (c: SpecialClock) => {
      clock.current = c;
      try {
        localStorage.setItem(SPECIAL_KEY(slug), JSON.stringify(c));
      } catch {}
    },
    [slug],
  );

  // Tira o story da oferta da categoria sem pular nenhum prato: se o cliente já passou
  // dela, o índice daquela categoria volta uma casa.
  const dropOffer = useCallback(
    (shown: SpecialClock | null) => {
      const pl = placementRef.current;
      if (!pl) return;
      if (shown) saveClock(shown);
      const list = catsOf();
      const ci = list.findIndex((c) => c.id === pl.catId);
      const at = ci >= 0 ? list[ci].items.findIndex((it) => it.id === pl.itemId) : -1;
      const v = viewRef.current;
      if (at >= 0 && v.idx[ci] > at) {
        const idx = [...v.idx];
        idx[ci] -= 1;
        update({ idx });
      }
      offerShown.current = false;
      placementRef.current = null;
      setPlacement(null);
      resetTimer();
    },
    [resetTimer, saveClock, update],
  );

  const specialItemRef = useRef<MenuItem | null>(null);
  useEffect(() => {
    specialItemRef.current = specialItem;
  }, [specialItem]);

  const endSpecial = useCallback(
    (outcome: "taken" | "missed") => {
      void outcome; // pegou ou perdeu: nos dois casos a oferta espera o intervalo
      const item = specialItemRef.current;
      dropOffer(item ? afterShown(readClock(), item, Date.now()) : null);
    },
    [dropOffer, readClock],
  );

  // A cada story novo: conta stories vistos, encerra a oferta se o cliente saiu dela,
  // recoloca a oferta pendente que ele pulou sem ver e sorteia uma nova quando é a hora.
  const curItem = view.open ? cats[view.cur]?.items[view.idx[view.cur]] : undefined;
  const storyKey = view.open && curItem ? `${view.cur}:${view.idx[view.cur]}:${curItem.id}` : "";
  const busyOrder = order.sheet !== null || order.pick !== null;
  useEffect(() => {
    if (!storyKey || seen.current.last === storyKey) return;
    seen.current.last = storyKey;
    seen.current.count += 1;
    const item = catsRef.current[viewRef.current.cur]?.items[viewRef.current.idx[viewRef.current.cur]];
    if (item?.special) {
      offerShown.current = true;
      return;
    }
    const pl = placementRef.current;
    if (pl && offerShown.current) {
      queueMicrotask(() => endSpecial("missed")); // passou para outro story: conta como perdida
      return;
    }
    const now0 = Date.now();
    const c0 = readClock();
    const c1 = ensureFirstEligible(c0, now0, Math.random);
    if (c1 !== c0) saveClock(c1);
    if (!order.enabled) return;
    const list = catsRef.current;
    const v = viewRef.current;
    if (pl) {
      const ci = list.findIndex((c) => c.id === pl.catId);
      const at = ci >= 0 ? list[ci].items.findIndex((it) => it.id === pl.itemId) : -1;
      const ahead = ci > v.cur || (ci === v.cur && at > v.idx[v.cur]);
      if (!ahead) queueMicrotask(() => dropOffer(null)); // pulou sem ver: volta a ser sorteada à frente
      return;
    }
    const sp = pickSpecial(menu.specials?.items ?? [], c1, { now: now0, storiesSeen: seen.current.count, timezone: menu.restaurant.timezone, busy: busyOrder, openingHours: menu.restaurant.opening_hours }, Math.random);
    if (!sp) return;
    const next = placeOffer(list, v.cur, v.idx[v.cur], sp.id, Math.random);
    if (next) queueMicrotask(() => setPlacement(next));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reage só à troca de story
  }, [storyKey]);

  // Barra de progresso: atualizada a cada quadro direto no DOM, sem re-render.
  const tick = useCallback(() => {
    const step = () => {
      raf.current = requestAnimationFrame(step);
      const v = viewRef.current;
      const cat = catsOf()[v.cur];
      const p = panelEls.current[v.cur];
      if (!cat || !p) return;
      const item = cat.items[v.idx[v.cur]];
      if (item?.special) return; // a oferta relâmpago tem o próprio tempo (SpecialStory)
      const vid = p.querySelector("video");
      let frac: number;
      if (isVideo(item) && vid && vid.duration) {
        frac = vid.currentTime / vid.duration;
      } else {
        const now = performance.now();
        const on = playing();
        const el = elapsed.current + (on ? now - itemStart.current : 0);
        if (!on) {
          itemStart.current = now;
          elapsed.current = el;
        }
        const limit = isVideo(item) ? VIDEO_FALLBACK_MS : AUTO_MS;
        frac = Math.min(1, el / limit);
        if (frac >= 1 && on) {
          next();
          return;
        }
        if (isVideo(item)) frac = 0;
      }
      p.querySelectorAll<HTMLElement>(".bars b").forEach((b, k) => {
        const cur = v.idx[v.cur];
        b.style.width = `${k < cur ? 100 : k > cur ? 0 : frac * 100}%`;
      });
    };
    step();
  }, [next, playing]);

  const openViewer = useCallback(
    (c: number, withList = false) => {
      pos.current = c;
      settled.current = true;
      justOpened.current = true;
      closing.current = false;
      update({ open: true, cur: c, target: c, userPaused: false, held: false, listOpen: withList, listCat: c });
      resetTimer();
      cancelAnimationFrame(raf.current);
      raf.current = requestAnimationFrame(tick);
      if (!hintShown.current && !withList) {
        hintShown.current = true;
        setHint(true);
        setTimeout(() => setHint(false), 2200);
      }
    },
    [resetTimer, tick, update],
  );

  const closeViewer = useCallback(() => {
    cancelAnimationFrame(raf.current);
    closing.current = true;
    syncPlayback();
    const el = viewerRef.current;
    const done = () => {
      if (el) {
        el.classList.remove("animating");
        el.style.transform = "";
        el.style.opacity = "";
        el.style.borderRadius = "";
      }
      update({ open: false, listOpen: false, held: false });
    };
    if (!el || reduce.current) return done();
    el.classList.add("animating");
    el.style.transform = "translateY(40%) scale(.85)";
    el.style.opacity = "0";
    setTimeout(done, 300);
  }, [syncPlayback, update]);

  // Prévia do painel (Aparência): o cardápio roda num iframe e o painel manda a fonte
  // escolhida e a tela a mostrar (capa, story ou lista). Fora de iframe, nada muda.
  const [previewFont, setPreviewFont] = useState<string | null>(null);
  useEffect(() => {
    if (window.parent === window) return;
    const on = (e: MessageEvent) => {
      if (e.origin !== location.origin || e.data?.type !== "cm-preview") return;
      const { font, view: screen } = e.data as { font?: string; view?: string };
      if (font && isFontTheme(font)) setPreviewFont(font);
      const v = viewRef.current;
      if (screen === "capa" && v.open) closeViewer();
      if (screen === "story") {
        if (v.open) update({ listOpen: false });
        else openViewer(0);
      }
      if (screen === "lista") {
        if (v.open) update({ listOpen: true, listCat: v.cur });
        else openViewer(0, true);
      }
    };
    addEventListener("message", on);
    parent.postMessage({ type: "cm-ready" }, location.origin);
    return () => removeEventListener("message", on);
  }, [openViewer, closeViewer, update]);

  // ---------- Idioma ----------
  const setMenu = useCallback((m: PublicMenu) => {
    menuRef.current = m;
    setMenuState(m);
  }, []);

  const changeLang = useCallback(
    async (l: string, byUser: boolean) => {
      if (byUser) {
        try {
          localStorage.setItem(LANG_KEY, l);
        } catch {}
      }
      let m = menus.current.get(l);
      if (!m) {
        m = (await fetchPublicMenu(slug, l)) ?? undefined;
        if (!m) return;
        menus.current.set(l, m);
      }
      setMenu(m);
      document.documentElement.lang = l;
      if (byUser) {
        setRelang(true);
        setTimeout(() => setRelang(false), 400);
        showToast(tr("now", l));
      }
    },
    [setMenu, showToast, slug],
  );

  // Primeira visita: escolha salva, senão idioma do celular.
  useEffect(() => {
    reduce.current = matchMedia("(prefers-reduced-motion: reduce)").matches;
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(LANG_KEY);
    } catch {}
    const want = pickLanguage(initialMenu.restaurant.languages, saved, navigator.languages ?? [navigator.language]);
    if (want !== initialMenu.restaurant.language) void changeLang(want, false);
  }, [changeLang, initialMenu]);

  // ---------- Efeitos de desenho ----------
  useLayoutEffect(() => {
    if (!view.open) return;
    layout();
    // Barras das categorias que não estão na tela.
    panelEls.current.forEach((p, i) => {
      if (!p || i === view.cur) return;
      p.querySelectorAll<HTMLElement>(".bars b").forEach((b, k) => {
        b.style.width = k < view.idx[i] ? "100%" : "0%";
      });
    });
    const el = viewerRef.current;
    if (justOpened.current && el && !reduce.current) {
      justOpened.current = false;
      el.style.transform = "scale(.9)";
      el.style.opacity = "0";
      el.style.borderRadius = "24px";
      void el.offsetWidth;
      el.classList.add("animating");
      el.style.transform = "";
      el.style.opacity = "";
      el.style.borderRadius = "";
      setTimeout(() => el.classList.remove("animating"), 340);
    }
  });

  useEffect(() => {
    syncPlayback();
  });

  useEffect(() => {
    const onVis = () => syncPlayback();
    const onResize = () => {
      if (viewRef.current.open) layout();
    };
    document.addEventListener("visibilitychange", onVis);
    addEventListener("resize", onResize);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      removeEventListener("resize", onResize);
      cancelAnimationFrame(raf.current);
      cancelAnimationFrame(anim.current);
    };
  }, [layout, syncPlayback]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Digitando (observação do pedido etc.): espaço, setas e Esc são do campo, não do story.
      if ((e.target as HTMLElement | null)?.closest?.("input, textarea, select, [contenteditable]")) return;
      const v = viewRef.current;
      if (v.langOpen) {
        if (e.key === "Escape") update({ langOpen: false });
        return;
      }
      if (!v.open) return;
      if (e.key === "ArrowRight") next();
      else if (e.key === "ArrowLeft") prev();
      else if (e.key === "Escape") {
        if (v.listOpen) update({ listOpen: false });
        else closeViewer();
      } else if (e.key === " ") {
        update({ userPaused: !v.userPaused });
        e.preventDefault();
      }
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [closeViewer, next, prev, update]);

  // iOS só toca sozinho com o vídeo mudo, e o React não escreve "muted" no HTML.
  useEffect(() => {
    const hero = heroVidRef.current;
    if (!hero) return;
    hero.muted = true;
    hero.play().catch(() => {});
  }, []);

  // Aba da capa acompanha o card no meio da tela.
  useEffect(() => {
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) setHomeTab(Number((e.target as HTMLElement).dataset.i));
        });
      },
      { rootMargin: "-45% 0px -45% 0px" },
    );
    cardEls.current.forEach((c) => c && io.observe(c));
    return () => io.disconnect();
  }, [cats.length]);

  // Oferta em horário marcado é pontual (decisão do João, 16/10): na hora exata ela aparece
  // onde o cliente estiver. Nos stories, vira o próximo story na hora; na capa ou na lista,
  // abre os stories direto nela. Com folha, carrinho ou meio a meio aberto, espera fechar
  // (até 1 minuto depois da hora).
  const fireTimed = useCallback(() => {
    if (!order.enabled) return false;
    const now0 = Date.now();
    const busy = order.sheet !== null || order.pick !== null;
    const sp = pickSpecial(menu.specials?.items ?? [], readClock(), { now: now0, storiesSeen: 0, timezone: menu.restaurant.timezone, busy, openingHours: menu.restaurant.opening_hours }, Math.random);
    if (!sp?.special?.times?.length) return busy; // ocupado: tenta de novo em instantes
    const list = catsRef.current.map((c) => ({ ...c, items: c.items.filter((it) => !it.special) }));
    const v = viewRef.current;
    if (v.open) {
      const c = list[v.cur];
      if (!c) return false;
      const at = Math.min(c.items.length, (v.idx[v.cur] ?? 0) + 1);
      placementRef.current = { itemId: sp.id, catId: c.id, at };
      setPlacement(placementRef.current);
      setTimeout(() => next(), 80); // depois de o story entrar na lista
    } else {
      const ci = Math.max(0, list.findIndex((c) => c.id !== "destaques"));
      const c = list[ci];
      if (!c) return false;
      placementRef.current = { itemId: sp.id, catId: c.id, at: v.idx[ci] ?? 0 };
      setPlacement(placementRef.current);
      setTimeout(() => openViewer(ci), 80);
    }
    return false;
  }, [menu, next, openViewer, order.enabled, order.pick, order.sheet, readClock]);
  const fireTimedRef = useRef(fireTimed);
  useEffect(() => {
    fireTimedRef.current = fireTimed;
  }, [fireTimed]);

  const timedSpecials = menu.specials?.items.filter((i) => i.special?.times?.length);
  const timedKey = (timedSpecials ?? []).map((i) => `${i.id}:${i.special!.times!.join(",")}:${i.special!.days.join(",")}`).join("|");
  useEffect(() => {
    if (!order.enabled || !timedKey) return;
    let t: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      const at = nextTimedStart(menuRef.current.specials?.items ?? [], menuRef.current.restaurant.timezone, new Date());
      if (at == null) return;
      t = setTimeout(() => {
        const until = at + 60_000;
        const attempt = () => {
          if (fireTimedRef.current() && Date.now() < until) t = setTimeout(attempt, 2000);
          else schedule();
        };
        attempt();
      }, Math.max(0, at - Date.now()));
    };
    schedule();
    return () => clearTimeout(t);
  }, [order.enabled, timedKey]);

  // ---------- Gestos ----------
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button > 0 || gesture.current || (e.target as HTMLElement).closest("button, .sp-foot")) return;
    cancelAnimationFrame(anim.current);
    const now = performance.now();
    gesture.current = {
      id: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      t: now,
      mode: null,
      startPos: pos.current,
      lastX: e.clientX,
      lastY: e.clientY,
      lastT: now,
      vx: 0,
      vy: 0,
      held: false,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
    holdTimer.current = setTimeout(() => {
      const g = gesture.current;
      if (g && !g.mode) {
        g.held = true;
        update({ held: true });
      }
    }, 220);
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    if (!g || e.pointerId !== g.id) return;
    const dx = e.clientX - g.x;
    const dy = e.clientY - g.y;
    const now = performance.now();
    if (!g.mode && Math.hypot(dx, dy) > 10) {
      g.mode = Math.abs(dx) > Math.abs(dy) ? "h" : dy > 0 ? "v" : "x";
      clearTimeout(holdTimer.current);
      if (g.mode === "h") {
        settled.current = false;
        update({ held: false });
      }
    }
    const n = catsOf().length;
    if (g.mode === "h") {
      const w = viewerRef.current?.clientWidth ?? 1;
      let p = g.startPos - dx / w;
      if (p < 0) p *= 0.3;
      if (p > n - 1) p = n - 1 + (p - n + 1) * 0.3;
      pos.current = p;
      layout();
    } else if (g.mode === "v" && viewerRef.current) {
      const d = Math.max(0, dy);
      viewerRef.current.style.transform = `translateY(${d}px) scale(${1 - Math.min(0.15, d / 2000)})`;
      viewerRef.current.style.borderRadius = `${Math.min(28, d / 6)}px`;
    }
    const dt = now - g.lastT;
    if (dt > 0) {
      g.vx = (e.clientX - g.lastX) / dt;
      g.vy = (e.clientY - g.lastY) / dt;
    }
    g.lastX = e.clientX;
    g.lastY = e.clientY;
    g.lastT = now;
  };

  const endGesture = (e: ReactPointerEvent<HTMLDivElement>, cancel: boolean) => {
    const g = gesture.current;
    if (!g || e.pointerId !== g.id) return;
    clearTimeout(holdTimer.current);
    gesture.current = null;
    const dx = e.clientX - g.x;
    const dy = e.clientY - g.y;
    const dtot = performance.now() - g.t;
    const w = viewerRef.current?.clientWidth ?? 1;
    if (g.held) update({ held: false });
    if (g.mode === "h") {
      let to = Math.round(pos.current);
      if (!cancel && (Math.abs(dx) > w * 0.18 || Math.abs(g.vx) > 0.45)) to = viewRef.current.cur + (dx < 0 ? 1 : -1);
      goCat(to);
    } else if (g.mode === "v") {
      if (!cancel && (dy > 130 || g.vy > 0.6)) closeViewer();
      else if (viewerRef.current) {
        const el = viewerRef.current;
        el.style.transition = "transform .25s, border-radius .25s";
        el.style.transform = "";
        el.style.borderRadius = "";
        setTimeout(() => (el.style.transition = ""), 260);
      }
    } else if (!g.mode && !g.held && !cancel && dtot < 350) {
      const x = e.clientX - (viewerRef.current?.getBoundingClientRect().left ?? 0);
      if (x < w * 0.3) prev();
      else next();
    }
  };

  // Lista: todas as categorias numa rolagem só; as abas acompanham a rolagem.
  const sectionOf = (c: number) => listRef.current?.querySelector<HTMLElement>(`.lsec[data-ci="${c}"]`);
  const openListAt = (c: number) => {
    const box = listRef.current;
    const sec = sectionOf(c);
    if (box && sec) box.scrollTo({ top: sec.offsetTop - box.offsetTop, behavior: reduce.current ? "auto" : "smooth" });
    update({ listCat: c });
  };
  const onListScroll = () => {
    const box = listRef.current;
    if (!box) return;
    let at = 0;
    box.querySelectorAll<HTMLElement>(".lsec").forEach((sec, i) => {
      if (sec.offsetTop - box.offsetTop <= box.scrollTop + 80) at = i;
    });
    if (box.scrollTop + box.clientHeight >= box.scrollHeight - 2) at = catsOf().length - 1;
    if (at !== viewRef.current.listCat) update({ listCat: at });
  };
  useLayoutEffect(() => {
    if (!view.listOpen) return;
    const box = listRef.current;
    const sec = sectionOf(viewRef.current.listCat);
    if (box && sec) box.scrollTop = sec.offsetTop - box.offsetTop;
  }, [view.listOpen]);
  useEffect(() => {
    centerTab(lTabsRef.current, view.listCat, true);
  }, [view.listCat, view.listOpen]);
  useEffect(() => {
    centerTab(hTabsRef.current, homeTab, !reduce.current);
  }, [homeTab]);
  const tabsKey = `${cats.map((c) => c.name).join("|")}#${lang}#${previewFont ?? menu.restaurant.font_theme}`;
  useFitTabs(hTabsRef, tabsKey);
  // Nos stories a letra não encolhe: o que não cabe fica para deslizar.
  useFitTabs(vTabsRef, `${tabsKey}#${view.open}`, 1);
  useFitTabs(lTabsRef, `${tabsKey}#${view.listOpen}`);

  const pickFromList = (c: number, i: number) => {
    const idx = [...viewRef.current.idx];
    idx[c] = i;
    update({ listOpen: false, idx });
    if (c === viewRef.current.cur) resetTimer();
    else goCat(c);
  };

  // Aberto/fechado no fuso do restaurante; calculado no celular e refeito a cada minuto.
  const { opening_hours: hours, timezone } = menu.restaurant;
  useEffect(() => {
    if (!hours) return;
    const run = () => setStatus(statusLabel(hours, timezone, lang));
    const first = setTimeout(run, 0);
    const id = setInterval(run, 60_000);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [hours, timezone, lang]);

  // Pré-carrega os próximos pratos da categoria e o prato atual das vizinhas,
  // para que a troca já encontre a imagem decodificada.
  const idxKey = view.idx.join(",");
  useEffect(() => {
    if (!view.open) return;
    const all = catsOf();
    const want: (MenuItem | undefined)[] = [];
    const cur = all[view.cur];
    const at = view.idx[view.cur] ?? 0;
    if (cur) for (let k = 1; k <= 2; k++) want.push(cur.items[(at + k) % cur.items.length]);
    for (const c of [view.cur - 1, view.cur + 1]) want.push(all[c]?.items[view.idx[c] ?? 0]);
    for (const item of want) {
      const m = item?.media[0];
      if (!m) continue;
      // Os mesmos endereços que o StoryMedia usa (miniatura por baixo, foto grande por cima).
      warm(posterSrc(m, THUMB_W));
      if (m.kind === "photo") {
        warm(photoSrc(m, THUMB_W));
        warm(photoSrc(m, STORY_W));
      } else warmVideo(videoSrc(m));
    }
    // idxKey resume view.idx sem disparar a cada novo array.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view.open, view.cur, idxKey, menu]);

  // ---------- Desenho ----------
  const { restaurant } = menu;
  const languages = restaurant.languages.length ? restaurant.languages : ["pt-BR"];
  const flagCode = LANG_FLAG[lang] ?? "xx";
  // Banner enviado em Editar Perfil (foto ou vídeo); sem ele, a capa antiga ou o 1º prato.
  const banner = restaurant.cover;
  const coverVideo = banner ? (banner.kind === "video" ? videoSrc(banner, "card") : null) : mediaUrl(restaurant.cover_video_path);
  const coverImage = banner
    ? banner.kind === "photo"
      ? photoSrc(banner, STORY_W)
      : posterSrc(banner, STORY_W)
    : (sizedSrc(mediaUrl(restaurant.cover_image_path), STORY_W) ?? thumbSrc(cats[0]?.items[0], STORY_W));
  const logo = sizedSrc(mediaUrl(restaurant.logo_path), THUMB_W);
  const near = (i: number) => view.open && (Math.abs(i - view.cur) <= 1 || Math.abs(i - view.target) <= 1);
  const style = { "--accent": restaurant.brand_color ?? undefined } as CSSProperties;

  return (
    <div className={`cm${relang ? " relang" : ""}`} data-font={previewFont ?? (isFontTheme(restaurant.font_theme) ? restaurant.font_theme : DEFAULT_FONT_THEME)} style={style}>
      <main className="home" aria-hidden={view.open}>
        <div className="hero-top">
          <button className="round" onClick={() => openViewer(0, true)} aria-label={t("viewList")} disabled={!cats.length}>
            <ListIcon />
          </button>
          {languages.length > 1 && (
            // Bandeira atual; tocou, abre a coluna com as outras. Escolheu, troca o idioma.
            <div className={`langpick${view.langOpen ? " open" : ""}`}>
              <button
                className="flagbtn cur"
                onClick={() => update({ langOpen: !viewRef.current.langOpen })}
                aria-expanded={view.langOpen}
                aria-label={`${t("lang")}: ${LANG_NAME[lang] ?? lang}`}
              >
                <span className="flag">
                  <Flag code={flagCode} />
                </span>
              </button>
              {view.langOpen &&
                languages
                  .filter((l) => l !== lang)
                  .map((l, k) => (
                    <button
                      key={l}
                      className="flagbtn"
                      style={{ "--k": k } as CSSProperties}
                      lang={l}
                      aria-label={LANG_NAME[l] ?? l}
                      onClick={() => {
                        update({ langOpen: false });
                        void changeLang(l, true);
                      }}
                    >
                      <span className="flag">
                        <Flag code={LANG_FLAG[l] ?? "xx"} />
                      </span>
                    </button>
                  ))}
            </div>
          )}
        </div>
        {tableTag}
        {view.langOpen && <div className="langcatch" onClick={() => update({ langOpen: false })} />}
        <CartButton inViewer={false} className="round hero-cart" />
        {hasInfo(restaurant) && (
          <button className="round hero-info" onClick={() => setInfoOpen(true)} aria-label={t("info")}>
            <svg className="icon" viewBox="0 0 24 24" aria-hidden>
              <path d="M12 22a10 10 0 100-20 10 10 0 000 20zM12 16v-5M12 8h.01" />
            </svg>
          </button>
        )}
        <section className="hero">
          {coverVideo ? (
            <LoopVideo ref={heroVidRef} src={coverVideo} poster={coverImage} eager />
          ) : (
            coverImage && <img src={coverImage} alt="" />
          )}
          <div className="brand">
            {/* A logo é a imagem enviada pelo restaurante; não muda com a fonte do cardápio. */}
            {logo ? <Logo src={logo} alt={restaurant.name} /> : <div className="logo"><b>{restaurant.name}</b></div>}
            {hours && status && (
              <span className={`status${status.open ? " is-open" : ""}`}>
                <i aria-hidden />
                {status.state}
                {status.detail && <em>{status.detail}</em>}
              </span>
            )}
          </div>
        </section>

        {cats.length === 0 ? (
          <p className="empty">{t("empty")}</p>
        ) : (
          <>
            <nav className="home-tabs">
              <div className="tabs" role="tablist" ref={hTabsRef}>
                {cats.map((c, i) => (
                  <button
                    key={c.id}
                    role="tab"
                    aria-selected={i === homeTab}
                    onClick={() =>
                      cardEls.current[i]?.scrollIntoView({ behavior: reduce.current ? "auto" : "smooth", block: "center" })
                    }
                  >
                    {c.name}
                  </button>
                ))}
              </div>
            </nav>
            <section className="cards">
              {cats.map((c, i) => (
                <CategoryCard
                  key={c.id}
                  cat={c}
                  index={i}
                  refCb={(el) => {
                    cardEls.current[i] = el;
                  }}
                  onOpen={() => openViewer(i)}
                />
              ))}
            </section>
          </>
        )}
      </main>

      {/* No computador, fora da coluna do story: clicar fecha. */}
      <div className="viewer-bg" hidden={!view.open} onClick={closeViewer} aria-hidden />
      <div className={`viewer${view.held ? " held" : ""}${view.listOpen ? " listing" : ""}`} ref={viewerRef} hidden={!view.open} aria-hidden={!view.open}>
        <div
          className="stage"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={(e) => endGesture(e, false)}
          onPointerCancel={(e) => endGesture(e, true)}
          onContextMenu={(e) => e.preventDefault()}
        >
          {cats.map((c, i) => {
            const item = c.items[view.idx[i]] ?? c.items[0];
            return (
              <div
                key={c.id}
                className={`panel${item.special ? " special" : ""}`}
                ref={(el) => {
                  panelEls.current[i] = el;
                }}
              >
                <div className="media">
                  {near(i) && (
                    <StoryMedia
                      key={item.media[0]?.id ?? item.id}
                      item={item}
                      live={i === view.cur && view.target === view.cur}
                      onEnded={() => {
                        if (viewRef.current.cur === i && playing() && !item.special) next();
                      }}
                    />
                  )}
                </div>
                <div className="shade" />
                <div className="bars">
                  {c.items.map((it) => (
                    <i key={it.id}>
                      <b />
                    </i>
                  ))}
                </div>
                <div className="info">
                  <h3 className="fd">{item.name}</h3>
                  {item.description && <p>{item.description}</p>}
                  {((item.tags?.length ?? 0) > 1 || item.serves || item.country) && (
                    <ul className="tags">
                      {item.serves && <li>{tr("serves", lang).replace("{n}", String(item.serves))}</li>}
                      {item.country && <li>{countryLabel(item.country, lang)}</li>}
                      {item.tags?.slice(1).map((tg) => (
                        <li key={tg}>{tagLabel(tg, lang)}</li>
                      ))}
                    </ul>
                  )}
                  {!item.hide_price && !!item.price_options?.length && (
                    <ul className="opts">
                      {item.price_options.map((o) => (
                        <li key={o.label}>
                          <span>{o.label}</span>
                          <b>{formatPrice(o.price_cents, lang)}</b>
                        </li>
                      ))}
                    </ul>
                  )}
                  {/* Preço e quantidade na mesma linha e, embaixo, "Pedir agora" (layout do João, 15/10). */}
                  <StoryBuy key={item.id} item={item} kind={c.name} price={!item.hide_price && <Price item={item} lang={lang} className="price solo" />} />
                </div>
                {item.special && (
                  <SpecialStory
                    key={`${item.id}:${placement?.catId}:${placement?.at}`}
                    item={item}
                    live={view.open && i === view.cur && view.target === view.cur}
                    onDone={endSpecial}
                  />
                )}
                <div className="dim" />
              </div>
            );
          })}
        </div>

        <div className="chrome">
          <button className="back glass" onClick={closeViewer} aria-label={t("back")}>
            <svg className="icon" viewBox="0 0 24 24">
              <path d="M19 12H5M11 6l-6 6 6 6" />
            </svg>
          </button>
          <div className="tabs vtabs" role="tablist" ref={vTabsRef}>
            {cats.map((c, i) => (
              <button key={c.id} role="tab" aria-selected={i === view.cur} onClick={() => goCat(i)}>
                {c.name}
              </button>
            ))}
          </div>
          <CartButton inViewer className="vcart glass" />
          <button
            className="listbtn"
            onClick={() => update({ listOpen: true, listCat: viewRef.current.cur })}
            aria-label={t("viewList")}
          >
            <ListIcon />
          </button>
        </div>


        {hint && <div className="hint">{t("hint")}</div>}

        {view.listOpen && (
          <div className="list" role="dialog" aria-labelledby="cm-list-title">
            {/* Fundo: a foto da categoria atual, bem desfocada (uma imagem pequena, leve). */}
            {thumbSrc(cats[view.listCat]?.items[0]) && (
              <img key={view.listCat} className="lbg" src={thumbSrc(cats[view.listCat]?.items[0])!} alt="" aria-hidden />
            )}
            <header>
              <div>
                <span className="kicker">{restaurant.name}</span>
                <h2 id="cm-list-title" className="fd">
                  {t("listTitle")}
                </h2>
              </div>
              <button className="close glass" onClick={() => update({ listOpen: false })} aria-label={t("close")}>
                <svg className="icon" viewBox="0 0 24 24">
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            </header>
            <div className="tabs ltabs" role="tablist" ref={lTabsRef}>
              {cats.map((c, i) => (
                <button key={c.id} role="tab" aria-selected={i === view.listCat} onClick={() => openListAt(i)}>
                  {c.name}
                </button>
              ))}
            </div>
            <div className="lscroll" ref={listRef} onScroll={onListScroll}>
              {cats.map((c, ci) => (
                <section key={c.id} className="lsec" data-ci={ci}>
                  <h3 className="fd">
                    {c.name}
                    <small>
                      {c.items.filter((it) => !it.special).length} {t("items")}
                    </small>
                  </h3>
                  {c.description && <p className="lobs">{c.description}</p>}
                  <div className="dgrid">
                    {c.items.map((it, i) => {
                      if (it.special) return null; // a oferta relâmpago só aparece como story
                      const th = thumbSrc(it);
                      return (
                        <button
                          key={it.id}
                          className="dish"
                          style={{ "--i": ci === view.listCat ? i : 0 } as CSSProperties}
                          onClick={() => pickFromList(ci, i)}
                        >
                          <span className="dimg">
                            {th ? <img src={th} alt="" loading={ci === view.listCat ? "eager" : "lazy"} /> : null}
                            <Price item={it} lang={lang} as="em" className="tagp" />
                            {isVideo(it) && (
                              <svg className="icon play" viewBox="0 0 24 24" aria-hidden>
                                <path d="M8 5.5v13l11-6.5z" />
                              </svg>
                            )}
                          </span>
                          <b>{it.name}</b>
                          {it.description && <span className="ddesc">{it.description}</span>}
                        </button>
                      );
                    })}
                  </div>
                </section>
              ))}
            </div>
          </div>
        )}
      </div>

      {infoOpen && (
        <InfoSheet
          restaurant={restaurant}
          lang={lang}
          status={status}
          onClose={() => setInfoOpen(false)}
          onCopy={(v) => {
            void navigator.clipboard?.writeText(v).catch(() => {});
            showToast(t("copied"));
          }}
        />
      )}

      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}

      <OrderLayer />
    </div>
  );
}

function CategoryCard({
  cat,
  index,
  refCb,
  onOpen,
}: {
  cat: MenuCategory;
  index: number;
  refCb: (el: HTMLButtonElement | null) => void;
  onOpen: () => void;
}) {
  // Foto ou vídeo da categoria (painel > editar categoria); sem ela, o primeiro prato.
  const cover: MenuMedia | null | undefined = cat.cover;
  // Card ocupa a largura do celular: foto na resolução cheia (CARD_W).
  const th = cover ? (cover.kind === "photo" ? (posterSrc(cover, CARD_W) ?? photoSrc(cover, CARD_W)) : posterSrc(cover, CARD_W)) : thumbSrc(cat.items[0], CARD_W);
  return (
    <button className={`card${cat.id === FEATURED_ID ? " feat" : ""}`} ref={refCb} data-i={index} onClick={onOpen}>
      {cover?.kind === "video" ? (
        <LoopVideo src={videoSrc(cover, "card")} poster={th} />
      ) : (
        th && <img src={th} alt="" loading={index < 2 ? "eager" : "lazy"} />
      )}
      <div className="card-txt">
        <b className="fd">{cat.name}</b>
      </div>
    </button>
  );
}

const hasInfo = (r: PublicMenu["restaurant"]) =>
  !!(r.description || r.address || r.phone || r.instagram || r.facebook || r.wifi_name || r.payment_methods?.length);

// Informações do restaurante (Editar Perfil): endereço, contato, redes, Wi-Fi e pagamento.
function InfoSheet({
  restaurant: r,
  lang,
  status,
  onClose,
  onCopy,
}: {
  restaurant: PublicMenu["restaurant"];
  lang: string;
  status: StatusLabel | null;
  onClose: () => void;
  onCopy: (v: string) => void;
}) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    addEventListener("keydown", k);
    return () => removeEventListener("keydown", k);
  }, [onClose]);
  const digits = (r.phone ?? "").replace(/\D/g, "");
  return (
    <div className="infowrap" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="infosheet" role="dialog" aria-label={r.name}>
        <header>
          <h2 className="fd">{r.name}</h2>
          <button className="close glass" onClick={onClose} aria-label={tr("close", lang)}>
            <svg className="icon" viewBox="0 0 24 24">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </header>
        {r.description && <p className="idesc">{r.description}</p>}
        {status && r.opening_hours && (
          <p className={`istatus${status.open ? " is-open" : ""}`}>
            <i aria-hidden />
            {status.state}
            {status.detail && <em>{status.detail}</em>}
          </p>
        )}
        <ul className="ilist">
          {r.address && (
            <li>
              <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(r.address)}`} target="_blank" rel="noreferrer">
                <svg className="icon" viewBox="0 0 24 24" aria-hidden>
                  <path d="M12 21s-7-6.1-7-11.5a7 7 0 0114 0C19 14.9 12 21 12 21zM12 12a2.5 2.5 0 100-5 2.5 2.5 0 000 5z" />
                </svg>
                {r.address}
              </a>
            </li>
          )}
          {digits.length >= 10 && (
            <li>
              <a href={`https://wa.me/${digits.length <= 11 ? "55" : ""}${digits}`} target="_blank" rel="noreferrer">
                <svg className="icon" viewBox="0 0 24 24" aria-hidden>
                  <path d="M4 20l1.3-4A8 8 0 1112 20a8 8 0 01-3.9-1zM9 9.5c0 3 2.5 5.5 5.5 5.5l1-1.5-2-1-1 .8a4 4 0 01-1.8-1.8l.8-1-1-2z" />
                </svg>
                {r.phone}
              </a>
            </li>
          )}
          {r.instagram && (
            <li>
              <a href={`https://instagram.com/${r.instagram}`} target="_blank" rel="noreferrer">
                <svg className="icon" viewBox="0 0 24 24" aria-hidden>
                  <path d="M7 3h10a4 4 0 014 4v10a4 4 0 01-4 4H7a4 4 0 01-4-4V7a4 4 0 014-4zM12 16a4 4 0 100-8 4 4 0 000 8zM17.5 6.5h.01" />
                </svg>
                @{r.instagram}
              </a>
            </li>
          )}
          {r.facebook && (
            <li>
              <a href={`https://facebook.com/${r.facebook}`} target="_blank" rel="noreferrer">
                <svg className="icon" viewBox="0 0 24 24" aria-hidden>
                  <path d="M14 8h3V4h-3a4 4 0 00-4 4v3H7v4h3v6h4v-6h3l1-4h-4V8z" />
                </svg>
                {r.facebook}
              </a>
            </li>
          )}
          {r.wifi_name && (
            <li>
              <button onClick={() => r.wifi_password && onCopy(r.wifi_password)}>
                <svg className="icon" viewBox="0 0 24 24" aria-hidden>
                  <path d="M2 9a15 15 0 0120 0M5.5 12.5a10 10 0 0113 0M9 16a5 5 0 016 0M12 19.5h.01" />
                </svg>
                <span>
                  {tr("wifi", lang)}: <b>{r.wifi_name}</b>
                  {r.wifi_password && (
                    <>
                      <br />
                      {tr("password", lang)}: <b>{r.wifi_password}</b>
                    </>
                  )}
                </span>
              </button>
            </li>
          )}
        </ul>
        {!!r.payment_methods?.length && (
          <div className="ipay">
            {r.payment_methods.map((p) => (
              <span key={p}>{paymentLabel(p, lang)}</span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// Vídeo mudo em loop (banner e cards): só toca enquanto aparece na tela, para não
// pesar o celular; Mux (HLS) entra pelo hls.js fora do Safari.
function LoopVideo({
  src,
  poster,
  eager,
  ref,
}: {
  src: string | null;
  poster: string | null;
  eager?: boolean;
  ref?: React.Ref<HTMLVideoElement>;
}) {
  const own = useRef<HTMLVideoElement>(null);
  // Só carrega o vídeo quando o card chega perto da tela (o banner, na hora), e solta de
  // volta quando sai: no celular, cada vídeo aberto ocupa memória e decodificação, e com
  // muitas categorias isso trava a página. Ao voltar, mostra a capa e retoma.
  const [active, setActive] = useState(!!eager);
  // Na tela: baixa tudo para tocar liso. Perto, mas fora da tela: só o começo, para não
  // disputar a internet com os vídeos que a pessoa está vendo.
  const [shown, setShown] = useState(!!eager);
  const setRefs = useCallback(
    (el: HTMLVideoElement | null) => {
      own.current = el;
      if (typeof ref === "function") ref(el);
      else if (ref) (ref as React.RefObject<HTMLVideoElement | null>).current = el;
    },
    [ref],
  );
  // Cards esperam o banner começar (start-gate.ts); o banner (eager) não espera ninguém.
  const gate = useStartGate();
  const live = active && (eager || gate) ? src : null;
  useEffect(() => {
    const v = own.current;
    if (!v || !eager) return;
    if (!v.paused && v.currentTime > 0) openStartGate();
    v.addEventListener("playing", openStartGate, { once: true });
    return () => v.removeEventListener("playing", openStartGate);
  }, [eager]);
  useAutoplay(own);
  // Perto da tela: lista lida e pronto para começar; baixa os trechos só quando aparece.
  useHls(own, live, true, shown);
  useEffect(() => {
    const v = own.current;
    if (!v) return;
    // Carrega antes de aparecer (uma tela de folga), para o vídeo já estar pronto quando o
    // card chega. Só solta quando ele fica bem longe: sem isso, cada vaivém da rolagem
    // recomeçava o download e o vídeo demorava de novo para começar.
    const load = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) setActive(true);
        else if (!eager) setActive(false);
      },
      { rootMargin: "100% 0px" },
    );
    // Todos os vídeos de categoria que aparecem na tela tocam juntos, em loop. Só pausa
    // o que saiu da tela (ninguém vê) e ele volta a tocar na hora em que reaparece: assim
    // o celular decodifica só os 2 ou 3 visíveis, nunca a página inteira.
    const play = new IntersectionObserver(
      ([e]) => {
        const vis = e.isIntersecting;
        v.dataset.vis = vis ? "1" : "";
        setShown(vis || !!eager);
        if (vis && !v.dataset.hold) {
          v.dataset.want = "1";
          v.play().catch(() => {});
        } else if (!vis) {
          v.dataset.want = "";
          v.pause();
        }
      },
      { threshold: 0 },
    );
    load.observe(v);
    play.observe(v);
    return () => {
      load.disconnect();
      play.disconnect();
    };
  }, [eager]);
  const hls = !!live && live.includes(".m3u8");
  return (
    <video
      ref={setRefs}
      src={hls ? undefined : (live ?? undefined)}
      poster={poster ?? undefined}
      muted
      playsInline
      loop
      // Já carregado antes de aparecer (uma tela de folga), para começar sem esperar.
      preload={!live ? "none" : shown ? "auto" : "metadata"}
      autoPlay={eager}
      data-loop={eager ? undefined : ""}
    />
  );
}

// Com promoção: preço antigo riscado e o novo em destaque. Vários preços: "a partir de".
// Preço oculto: nada.
function Price({ item, lang, className, as: Tag = "span" }: { item: MenuItem; lang: string; className?: string; as?: "span" | "em" }) {
  if (item.hide_price) return null;
  if (item.price_options?.length) {
    const min = Math.min(...item.price_options.map((o) => o.price_cents));
    return (
      <Tag className={className}>
        <small>{tr("from", lang)}</small> {formatPrice(min, lang)}
      </Tag>
    );
  }
  const promo = item.promo_price_cents;
  if (promo == null) return <Tag className={className}>{formatPrice(item.price_cents, lang)}</Tag>;
  return (
    <Tag className={`${className ?? ""} has-promo`.trim()}>
      <s>{formatPrice(item.price_cents, lang)}</s> {formatPrice(promo, lang)}
    </Tag>
  );
}

// Centraliza a aba só dentro da própria barra (scrollIntoView rolaria a tela toda).
/**
 * Mantém a barra de categorias numa linha só: primeiro encolhe um pouco a
 * letra e o espaçamento (até 80%) para tudo caber. Se ainda não couber, a
 * barra rola de lado e esmaece a borda onde há mais categorias.
 */
function useFitTabs(ref: RefObject<HTMLDivElement | null>, key: string, minFit = 0.8) {
  useLayoutEffect(() => {
    const bar = ref.current;
    if (!bar) return;
    const edges = () => {
      const max = bar.scrollWidth - bar.clientWidth;
      bar.toggleAttribute("data-more-l", bar.scrollLeft > 2);
      bar.toggleAttribute("data-more-r", bar.scrollLeft < max - 2);
    };
    const fit = () => {
      bar.style.setProperty("--fit", "1");
      const natural = bar.scrollWidth;
      const room = bar.clientWidth;
      const f = room > 0 && natural > room ? Math.max(minFit, Math.floor((room / natural) * 1000) / 1000) : 1;
      bar.style.setProperty("--fit", String(f));
      edges();
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(bar);
    bar.addEventListener("scroll", edges, { passive: true });
    document.fonts?.ready.then(fit).catch(() => {});
    return () => {
      ro.disconnect();
      bar.removeEventListener("scroll", edges);
    };
  }, [ref, key, minFit]);
}

function centerTab(bar: HTMLElement | null, i: number, smooth: boolean) {
  const tab = bar?.children[i] as HTMLElement | undefined;
  if (!bar || !tab) return;
  const left = tab.offsetLeft - (bar.clientWidth - tab.offsetWidth) / 2;
  bar.scrollTo({ left, behavior: smooth ? "smooth" : "auto" });
}

const warmed = new Set<string>();
function warm(src: string | null) {
  if (!src || warmed.has(src)) return;
  warmed.add(src);
  const img = new Image();
  img.decoding = "async";
  img.src = src;
  img.decode?.().catch(() => {});
}

// Duas camadas: a miniatura (já em cache pela capa ou pelo pré-carregamento)
// aparece na hora e a mídia em qualidade total entra por cima quando está pronta.
// Assim a troca de prato nunca passa por tela preta.
// Só o story da categoria atual (parado na tela) carrega e toca o vídeo; os vizinhos
// mostram a capa. Assim nunca há mais de um vídeo baixando e decodificando ao mesmo
// tempo, que era o que fazia o vídeo atual engasgar no celular.
function StoryMedia({ item, live, onEnded }: { item: MenuItem; live: boolean; onEnded: () => void }) {
  const m = item.media[0];
  const vidRef = useRef<HTMLVideoElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const [ready, setReady] = useState(false);
  const src = m ? (m.kind === "video" ? (live ? videoSrc(m) : null) : photoSrc(m, STORY_W)) : null;
  const hls = !!src && src.includes(".m3u8");
  useAutoplay(vidRef);
  useLayoutEffect(() => {
    if (vidRef.current) vidRef.current.muted = true;
    const img = imgRef.current;
    if (img?.complete && img.naturalWidth) setReady(true);
  }, []);
  useHls(vidRef, src);
  // Saiu de cena: volta a mostrar a capa (o vídeo é descarregado e ficaria preto).
  const isVid = m?.kind === "video";
  useEffect(() => {
    if (!live && isVid) setReady(false);
  }, [live, isVid]);
  if (!m) return null;
  // Miniatura (a mesma da lista, quase sempre já baixada) enquanto a grande chega.
  const low = posterSrc(m, THUMB_W) ?? (m.kind === "photo" ? photoSrc(m, THUMB_W) : null);
  const hi = `hi${ready ? " on" : ""}`;
  return (
    <>
      {low && <img className="lo" src={low} alt="" aria-hidden />}
      {m.kind === "video" ? (
        <video
          ref={vidRef}
          className={hi}
          src={hls ? undefined : (src ?? undefined)}
          poster={low ?? undefined}
          muted
          playsInline
          preload={live ? "auto" : "none"}
          onPlaying={() => setReady(true)}
          onEnded={onEnded}
        />
      ) : (
        <img
          ref={imgRef}
          className={hi}
          src={src ?? undefined}
          alt={item.name}
          decoding="async"
          onLoad={() => setReady(true)}
        />
      )}
    </>
  );
}

function ListIcon() {
  return (
    <svg className="icon" viewBox="0 0 24 24">
      <path d="M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01" />
    </svg>
  );
}

/**
 * Logo redonda. Mede a imagem num canvas pequeno: se for uma foto (quase toda opaca)
 * com sobras transparentes na borda, tira o fundo claro e amplia só o necessário para
 * as sobras ficarem fora do círculo. Logo com fundo transparente (texto) mantém o
 * fundo claro. Se não der para medir, mostra como antes.
 */
function Logo({ src, alt }: { src: string; alt: string }) {
  const [fit, setFit] = useState<{ state: "wait" | "photo" | "plain"; zoom: number }>({ state: "wait", zoom: 1 });
  useEffect(() => {
    let done = false;
    const finish = (state: "photo" | "plain", zoom = 1) => {
      if (done) return;
      done = true;
      setFit({ state, zoom });
    };
    // Se a medição demorar, mostra a logo do jeito simples e ajusta quando terminar.
    const timer = setTimeout(() => setFit((f) => (f.state === "wait" ? { state: "plain", zoom: 1 } : f)), 900);
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        finish(...measureLogo(img));
      } catch {
        finish("plain");
      }
    };
    img.onerror = () => finish("plain");
    img.src = src;
    return () => {
      done = true;
      clearTimeout(timer);
    };
  }, [src]);
  return (
    <div className="logo" data-state={fit.state} style={{ "--logo-zoom": fit.zoom } as CSSProperties}>
      <img src={src} alt={alt} />
    </div>
  );
}

function measureLogo(img: HTMLImageElement): ["photo" | "plain", number] {
  const N = 96;
  const R = N / 2;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = N;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx || !img.naturalWidth) return ["plain", 1];
  // Desenha igual ao object-fit: cover do círculo.
  const k = Math.max(N / img.naturalWidth, N / img.naturalHeight);
  const w = img.naturalWidth * k;
  const h = img.naturalHeight * k;
  ctx.drawImage(img, (N - w) / 2, (N - h) / 2, w, h);
  const data = ctx.getImageData(0, 0, N, N).data;
  const alpha = (x: number, y: number) => data[(Math.floor(y) * N + Math.floor(x)) * 4 + 3];

  let opaque = 0;
  let total = 0;
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      if ((x + 0.5 - R) ** 2 + (y + 0.5 - R) ** 2 > R * R) continue;
      total++;
      if (alpha(x, y) > 200) opaque++;
    }
  if (!total || opaque / total < 0.6) return ["plain", 1];

  // De fora para dentro, em cada direção, até achar a foto: o menor desses raios
  // diz quanto ampliar para a foto encostar na borda do círculo.
  let edge = R;
  for (let a = 0; a < 120; a++) {
    const t = (a / 120) * Math.PI * 2;
    let r = R - 0.5;
    while (r > 0 && alpha(R + Math.cos(t) * r, R + Math.sin(t) * r) <= 200) r -= 0.5;
    edge = Math.min(edge, r);
  }
  if (edge >= R - 1.5) return ["photo", 1];
  return ["photo", Math.min(1.45, (R / Math.max(edge, 1)) * 1.03)];
}
