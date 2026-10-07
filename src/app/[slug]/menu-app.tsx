"use client";
/* eslint-disable @next/next/no-img-element -- fotos do cardápio ocupam a tela toda e já vêm em tamanho certo do Storage */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import { fetchPublicMenu } from "@/lib/menu/client";
import { DEFAULT_FONT_THEME, isFontTheme } from "@/lib/menu/font-themes";
import { statusLabel, type StatusLabel } from "@/lib/menu/hours";
import { tagLabel } from "@/lib/menu/tags";
import { KNOWN_LANGS, LANG_FLAG, LANG_NAME, pickLanguage, t as tr, type StringKey } from "@/lib/menu/i18n";
import { formatPrice, mediaUrl, posterSrc, thumbSrc, videoSrc } from "@/lib/menu/media";
import type { MenuCategory, MenuItem, PublicMenu } from "@/lib/menu/types";
import { Flag } from "./flag";

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

export function MenuApp({ initialMenu }: { initialMenu: PublicMenu }) {
  const slug = initialMenu.restaurant.slug;
  const [menu, setMenuState] = useState(initialMenu);
  const menuRef = useRef(initialMenu);
  const menus = useRef(new Map<string, PublicMenu>([[initialMenu.restaurant.language, initialMenu]]));
  const lang = menu.restaurant.language;
  const cats = menu.categories.filter((c) => c.items.length > 0);
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
  const [status, setStatus] = useState<StatusLabel | null>(null);

  const viewerRef = useRef<HTMLDivElement>(null);
  const panelEls = useRef<(HTMLDivElement | null)[]>([]);
  const vTabsRef = useRef<HTMLDivElement>(null);
  const heroVidRef = useRef<HTMLVideoElement>(null);
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

  const catsOf = () => menuRef.current.categories.filter((c) => c.items.length > 0);

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
      settled.current &&
      document.visibilityState === "visible"
    );
  }, []);

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
      if (i === v.cur && playing()) vid.play().catch(() => {});
      else vid.pause();
    });
    const hero = heroVidRef.current;
    if (hero) {
      if (v.open || document.visibilityState !== "visible") hero.pause();
      else hero.play().catch(() => {});
    }
  }, [playing]);

  const scrollTab = useCallback((c: number) => {
    const tab = vTabsRef.current?.children[c] as HTMLElement | undefined;
    tab?.scrollIntoView({ inline: "center", block: "nearest", behavior: reduce.current ? "auto" : "smooth" });
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
      // Fim: fica no último prato, parado.
      resetTimer();
      update({ userPaused: true });
      showToast(tr("end", menuRef.current.restaurant.language));
    }
  }, [goCat, resetTimer, setItem, showToast, update]);

  const prev = useCallback(() => {
    const { cur, idx } = viewRef.current;
    if (idx[cur] > 0) setItem(cur, idx[cur] - 1);
    else if (cur > 0) goCat(cur - 1);
    else setItem(cur, 0);
  }, [goCat, setItem]);

  // Barra de progresso: atualizada a cada quadro direto no DOM, sem re-render.
  const tick = useCallback(() => {
    const step = () => {
      raf.current = requestAnimationFrame(step);
      const v = viewRef.current;
      const cat = catsOf()[v.cur];
      const p = panelEls.current[v.cur];
      if (!cat || !p) return;
      const item = cat.items[v.idx[v.cur]];
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
      update({ open: true, cur: c, target: c, userPaused: false, held: false, listOpen: withList, listCat: c });
      resetTimer();
      cancelAnimationFrame(raf.current);
      raf.current = requestAnimationFrame(tick);
      if (!hintShown.current && !withList) {
        hintShown.current = true;
        setHint(true);
        setTimeout(() => setHint(false), 2600);
      }
    },
    [resetTimer, tick, update],
  );

  const closeViewer = useCallback(() => {
    cancelAnimationFrame(raf.current);
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
  }, [update]);

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

  // ---------- Gestos ----------
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button > 0 || gesture.current || (e.target as HTMLElement).closest("button")) return;
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
      if (e.clientX < w * 0.3) prev();
      else next();
    }
  };

  // ---------- Ações ----------
  const share = async (item: MenuItem) => {
    const url = location.href.split("#")[0];
    const text = `${item.name} · ${formatPrice(item.promo_price_cents ?? item.price_cents, lang)}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: menu.restaurant.name, text, url });
        return;
      }
      await navigator.clipboard.writeText(`${text}\n${url}`);
      showToast(t("copied"));
    } catch {}
  };

  const openListAt = (c: number) => update({ listCat: c });

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

  // ---------- Desenho ----------
  const { restaurant } = menu;
  const languages = restaurant.languages.length ? restaurant.languages : ["pt-BR"];
  const flagCode = LANG_FLAG[lang] ?? "xx";
  const coverVideo = mediaUrl(restaurant.cover_video_path);
  const coverImage = mediaUrl(restaurant.cover_image_path) ?? thumbSrc(cats[0]?.items[0]);
  const logo = mediaUrl(restaurant.logo_path);
  const near = (i: number) => view.open && (Math.abs(i - view.cur) <= 1 || Math.abs(i - view.target) <= 1);
  const style = { "--accent": restaurant.brand_color ?? undefined } as CSSProperties;

  return (
    <div className={`cm${relang ? " relang" : ""}`} data-font={isFontTheme(restaurant.font_theme) ? restaurant.font_theme : DEFAULT_FONT_THEME} style={style}>
      <main className="home" aria-hidden={view.open}>
        <section className="hero">
          {coverVideo ? (
            <video
              ref={heroVidRef}
              src={coverVideo}
              poster={coverImage ?? undefined}
              muted
              playsInline
              autoPlay
              loop
              preload="auto"
            />
          ) : (
            coverImage && <img src={coverImage} alt="" />
          )}
          <div className="hero-top">
            <button className="round" onClick={() => openViewer(0, true)} aria-label={t("viewList")} disabled={!cats.length}>
              <ListIcon />
            </button>
            {languages.length > 1 && (
              <button
                className="round"
                onClick={() => update({ langOpen: true })}
                aria-label={`${t("lang")}: ${LANG_NAME[lang] ?? lang}`}
              >
                <span className="flag">
                  <Flag code={flagCode} />
                </span>
              </button>
            )}
          </div>
          <div className="brand">
            {/* A logo é a imagem enviada pelo restaurante; não muda com a fonte do cardápio. */}
            <div className="logo">{logo ? <img src={logo} alt={restaurant.name} /> : <b>{restaurant.name}</b>}</div>
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
              <div className="tabs" role="tablist">
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
                  lang={lang}
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

      <div className={`viewer${view.held ? " held" : ""}`} ref={viewerRef} hidden={!view.open} aria-hidden={!view.open}>
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
                className="panel"
                ref={(el) => {
                  panelEls.current[i] = el;
                }}
              >
                <div className="media">
                  {near(i) && (
                    <StoryMedia
                      item={item}
                      onEnded={() => {
                        if (viewRef.current.cur === i && playing()) next();
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
                {isVideo(item) && <span className="kind">{t("video")}</span>}
                <div className="info">
                  <span className="cat">{c.name}</span>
                  <h3 className="fd">{item.name}</h3>
                  {item.description && <p>{item.description}</p>}
                  {!!item.tags?.length && (
                    <ul className="tags">
                      {item.tags.map((tg) => (
                        <li key={tg}>{tagLabel(tg, lang)}</li>
                      ))}
                    </ul>
                  )}
                  <div className="acts">
                    <button onClick={() => share(item)}>
                      <ShareIcon />
                      <span>{t("share")}</span>
                    </button>
                    <Price item={item} lang={lang} className="price" />
                  </div>
                </div>
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
          <button
            className="listbtn"
            onClick={() => update({ listOpen: true, listCat: viewRef.current.cur })}
            aria-label={t("viewList")}
          >
            <ListIcon />
          </button>
        </div>

        <button
          className="pause"
          onClick={() => update({ userPaused: !viewRef.current.userPaused })}
          aria-label={t(view.userPaused ? "resume" : "pause")}
        >
          <svg className="icon" viewBox="0 0 24 24">
            {view.userPaused ? <path d="M7 5l12 7-12 7z" /> : <path d="M8 5v14M16 5v14" />}
          </svg>
        </button>

        {hint && (
          <div className="hint">
            {t("hint1")}
            <br />
            {t("hint2")}
          </div>
        )}

        {view.listOpen && (
          <div className="list">
            <header>
              <h2 className="fd">{t("listTitle")}</h2>
              <button className="close" onClick={() => update({ listOpen: false })} aria-label={t("close")}>
                <svg className="icon" viewBox="0 0 24 24">
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            </header>
            <div className="tabs vtabs" role="tablist">
              {cats.map((c, i) => (
                <button key={c.id} role="tab" aria-selected={i === view.listCat} onClick={() => openListAt(i)}>
                  {c.name}
                </button>
              ))}
            </div>
            <div className="lbox">
              {cats[view.listCat] && (
                <>
                  <h4 className="fd">{cats[view.listCat].name}</h4>
                  {cats[view.listCat].items.map((it, i) => {
                    const th = thumbSrc(it);
                    return (
                      <button key={it.id} className="li" onClick={() => pickFromList(view.listCat, i)}>
                        {th ? <img src={th} alt="" loading="lazy" /> : <span className="noimg" />}
                        <div>
                          <b>{it.name}</b>
                          {it.description && <span>{it.description}</span>}
                          <Price item={it} lang={lang} as="em" />
                        </div>
                      </button>
                    );
                  })}
                </>
              )}
            </div>
          </div>
        )}
      </div>

      {view.langOpen && (
        <div
          className="lang"
          onClick={(e) => {
            if (e.target === e.currentTarget) update({ langOpen: false });
          }}
        >
          <div className="lsheet" role="dialog" aria-labelledby="cm-lang-title">
            <div className="grab" />
            <div className="lhead">
              <svg className="icon" viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="9" />
                <path d="M3 12h18M12 3c2.6 2.6 3.8 5.6 3.8 9s-1.2 6.4-3.8 9c-2.6-2.6-3.8-5.6-3.8-9S9.4 5.6 12 3z" />
              </svg>
              <h2 id="cm-lang-title" className="fd">
                {t("lang")}
              </h2>
            </div>
            <p className="lsub">
              {KNOWN_LANGS.filter((l) => languages.includes(l))
                .map((l) => tr("lang", l))
                .filter((v, i, a) => a.indexOf(v) === i)
                .join(" · ")}
            </p>
            <div className="lgrid" role="radiogroup">
              {languages.map((l) => (
                <button
                  key={l}
                  className="lopt"
                  role="radio"
                  aria-checked={l === lang}
                  lang={l}
                  onClick={() => {
                    void changeLang(l, l !== lang);
                    setTimeout(() => update({ langOpen: false }), 220);
                  }}
                >
                  <i className="fl">
                    <Flag code={LANG_FLAG[l] ?? "xx"} />
                  </i>
                  <span>{LANG_NAME[l] ?? l}</span>
                  {l === lang && (
                    <span className="check" aria-hidden="true">
                      <svg viewBox="0 0 16 16" width="16" height="16">
                        <path d="M4 8.5l2.6 2.5L12 5.5" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" />
                      </svg>
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </div>
  );
}

function CategoryCard({
  cat,
  index,
  lang,
  refCb,
  onOpen,
}: {
  cat: MenuCategory;
  index: number;
  lang: string;
  refCb: (el: HTMLButtonElement | null) => void;
  onOpen: () => void;
}) {
  const th = thumbSrc(cat.items[0]);
  return (
    <button className="card" ref={refCb} data-i={index} onClick={onOpen}>
      {th && <img src={th} alt="" loading={index < 2 ? "eager" : "lazy"} />}
      <div className="card-txt">
        <b className="fd">{cat.name}</b>
        <span>
          {cat.items.length} {tr("items", lang)}
        </span>
      </div>
    </button>
  );
}

// Com promoção: preço antigo riscado e o novo em destaque.
function Price({ item, lang, className, as: Tag = "span" }: { item: MenuItem; lang: string; className?: string; as?: "span" | "em" }) {
  const promo = item.promo_price_cents;
  if (promo == null) return <Tag className={className}>{formatPrice(item.price_cents, lang)}</Tag>;
  return (
    <Tag className={`${className ?? ""} has-promo`.trim()}>
      <s>{formatPrice(item.price_cents, lang)}</s> {formatPrice(promo, lang)}
    </Tag>
  );
}

function StoryMedia({ item, onEnded }: { item: MenuItem; onEnded: () => void }) {
  const m = item.media[0];
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.muted = true;
  }, [m?.id]);
  if (!m) return null;
  if (m.kind === "video") {
    return (
      <video
        key={m.id}
        ref={ref}
        src={videoSrc(m) ?? undefined}
        poster={posterSrc(m) ?? undefined}
        muted
        playsInline
        preload="auto"
        onEnded={onEnded}
      />
    );
  }
  return <img key={m.id} src={mediaUrl(m.storage_path) ?? undefined} alt={item.name} decoding="async" />;
}

function ListIcon() {
  return (
    <svg className="icon" viewBox="0 0 24 24">
      <path d="M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01" />
    </svg>
  );
}

function ShareIcon() {
  return (
    <svg className="icon" viewBox="0 0 24 24">
      <path d="M12 15V3M7 8l5-5 5 5M5 13v6a2 2 0 002 2h10a2 2 0 002-2v-6" />
    </svg>
  );
}
