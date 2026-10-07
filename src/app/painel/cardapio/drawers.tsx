"use client";
/* eslint-disable @next/next/no-img-element -- foto do prato enviada pelo restaurante */

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { extOf, IMAGE_TYPES, shrinkImage } from "@/lib/images/shrink";
import { capturePoster, VIDEO_TYPES } from "@/lib/images/poster";
import { LANG_FLAG, LANG_NAME } from "@/lib/menu/i18n";
import { mediaUrl } from "@/lib/menu/media";
import { TAG_IDS, tagLabel } from "@/lib/menu/tags";
import { Flag } from "@/app/[slug]/flag";
import {
  deleteCategory,
  deleteItem,
  discardVideo,
  duplicateItem,
  saveItem,
  startVideoUpload,
  saveTranslations,
  suggestTranslations,
  updateCategory,
  type MediaInput,
  type TranslationRow,
} from "./actions";
import { CAMERA, Icon, type EditorCategory, type EditorContext, type EditorItem, type EditorTranslation } from "./menu-editor";

// "62,00" ou "62" -> 6200. Vazio ou inválido -> null.
function parseMoney(s: string): number | null {
  const t = s.replace(/[^\d,.]/g, "").replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", ".");
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}
const money = (cents: number | null) =>
  cents == null ? "" : (cents / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function useEscape(onClose: () => void) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    addEventListener("keydown", k);
    return () => removeEventListener("keydown", k);
  }, [onClose]);
}

function Shell({
  title,
  onClose,
  children,
  footer,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  footer: React.ReactNode;
}) {
  useEscape(onClose);
  return (
    <div className="dr-wrap" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dr" role="dialog" aria-modal="true" aria-label={title}>
        <header className="dr-head">
          <h2>{title}</h2>
          <button className="me-icon" aria-label="Fechar" onClick={onClose}>
            <Icon d="M6 6l12 12M18 6L6 18" />
          </button>
        </header>
        <div className="dr-body">{children}</div>
        <footer className="dr-foot">{footer}</footer>
      </div>
    </div>
  );
}

function ConfirmDelete({ label, onConfirm, busy }: { label: string; onConfirm: () => void; busy: boolean }) {
  const [ask, setAsk] = useState(false);
  if (!ask)
    return (
      <button className="btn danger-ghost" onClick={() => setAsk(true)} disabled={busy}>
        {label}
      </button>
    );
  return (
    <span className="dr-confirm">
      <button className="btn danger" onClick={onConfirm} disabled={busy}>
        Confirmar exclusão
      </button>
      <button className="btn ghost" onClick={() => setAsk(false)}>
        Não
      </button>
    </span>
  );
}

// ---------- Traduções ----------

function Translations({
  ctx,
  base,
  initial,
  withDescription,
  rows,
  setRows,
}: {
  ctx: EditorContext;
  base: { name: string; description: string };
  initial: EditorTranslation[];
  withDescription: boolean;
  rows: Record<string, EditorTranslation>;
  setRows: (fn: (r: Record<string, EditorTranslation>) => Record<string, EditorTranslation>) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  if (!ctx.languages.length) {
    return (
      <p className="dr-note">
        O cardápio está só em português. Para mostrar outros idiomas, ligue-os em{" "}
        <Link href="/painel/perfil">Perfil do restaurante</Link>.
      </p>
    );
  }

  const suggest = async () => {
    setBusy(true);
    setMsg(null);
    const res = await suggestTranslations(base, ctx.languages);
    setBusy(false);
    if (res.error) return setMsg(res.error);
    setRows((r) => {
      const n = { ...r };
      for (const [lang, t] of Object.entries(res.suggestions ?? {})) n[lang] = { language: lang, ...t, auto: true };
      return n;
    });
  };

  return (
    <div className="tr">
      <div className="tr-head">
        <p className="dr-note">
          Sem tradução, o cliente vê o texto em português.
          {ctx.canTranslate && " As sugestões automáticas aparecem marcadas; revise e salve."}
        </p>
        {ctx.canTranslate && (
          <button className="btn small" onClick={suggest} disabled={busy || !base.name.trim()}>
            {busy ? "Traduzindo…" : "Sugerir traduções"}
          </button>
        )}
      </div>
      {msg && <p className="dr-err">{msg}</p>}
      {ctx.languages.map((lang) => {
        const r = rows[lang] ?? initial.find((t) => t.language === lang) ?? { language: lang, name: "", description: "", auto: false };
        const set = (patch: Partial<EditorTranslation>) => setRows((all) => ({ ...all, [lang]: { ...r, ...patch } }));
        return (
          <fieldset key={lang} className="tr-lang">
            <legend>
              <span className="tr-flag">
                <Flag code={LANG_FLAG[lang] ?? "xx"} />
              </span>
              {LANG_NAME[lang] ?? lang}
              {r.auto && r.name && <em className="me-badge gold">sugestão automática</em>}
            </legend>
            <input
              aria-label={`Nome em ${LANG_NAME[lang] ?? lang}`}
              placeholder={base.name}
              value={r.name}
              maxLength={80}
              onChange={(e) => set({ name: e.target.value, auto: false })}
            />
            {withDescription && (
              <textarea
                aria-label={`Descrição em ${LANG_NAME[lang] ?? lang}`}
                placeholder={base.description}
                rows={2}
                value={r.description}
                maxLength={500}
                onChange={(e) => set({ description: e.target.value, auto: false })}
              />
            )}
          </fieldset>
        );
      })}
    </div>
  );
}

// Ao abrir as traduções, o que aparece na tela conta como revisado quando o dono salva.
const seed = (initial: EditorTranslation[]) => Object.fromEntries(initial.map((t) => [t.language, t]));

const toRows = (rows: Record<string, EditorTranslation>): TranslationRow[] =>
  Object.values(rows).map(({ language, name, description }) => ({ language, name, description }));

// ---------- Prato ----------

type Media = (NonNullable<EditorItem["media"]> & { input?: MediaInput }) | null;

// Sem Mux, o vídeo vai inteiro para o Storage, que aceita até 50 MB por arquivo.
const STORAGE_VIDEO_MAX = 50 * 1024 * 1024;

export function ItemDrawer({
  ctx,
  item,
  categoryId: initialCat,
  onClose,
}: {
  ctx: EditorContext;
  item: EditorItem | null;
  categoryId: string;
  onClose: (msg?: string) => void;
}) {
  const [tab, setTab] = useState<"prato" | "traducoes">("prato");
  const [name, setName] = useState(item?.name ?? "");
  const [description, setDescription] = useState(item?.description ?? "");
  const [price, setPrice] = useState(money(item?.priceCents ?? null));
  const [hasPromo, setHasPromo] = useState(item?.promoCents != null);
  const [promo, setPromo] = useState(money(item?.promoCents ?? null));
  const [tags, setTags] = useState<string[]>(item?.tags ?? []);
  const [active, setActive] = useState(item?.active ?? true);
  const [categoryId, setCategoryId] = useState(initialCat);
  const [media, setMedia] = useState<Media>(item?.media ?? null);
  const [mediaChanged, setMediaChanged] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [rows, setRows] = useState<Record<string, EditorTranslation>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const uploaded = useRef<string[]>([]);
  const muxUploads = useRef<string[]>([]);

  // Arquivos enviados e não salvos não ficam esquecidos no Storage nem no Mux.
  const close = (msg?: string, keep = false) => {
    if (!keep && uploaded.current.length) void createClient().storage.from("media").remove(uploaded.current);
    if (!keep) muxUploads.current.forEach((id) => void discardVideo(id));
    onClose(msg);
  };

  const upload = (file: File) => {
    setErr(null);
    if (VIDEO_TYPES.test(file.type) || /\.(mov|mp4|m4v|webm)$/i.test(file.name)) return uploadVideo(file);
    if (!IMAGE_TYPES.test(file.type)) return setErr("Use uma foto (PNG, JPG ou WebP) ou um vídeo (MP4 ou MOV).");
    return uploadPhoto(file);
  };

  // Vídeo no arquivo original: o Mux converte em várias qualidades (até 4K) e cada
  // cliente recebe a que a internet dele aguenta. O envio vai em partes, com progresso.
  const uploadVideo = async (file: File) => {
    setUploading(true);
    setProgress(0);
    try {
      const start = await startVideoUpload(ctx.restaurantId);
      if (start.error) throw new Error(start.error);
      if (!start.mux && file.size > STORAGE_VIDEO_MAX) {
        throw new Error("Vídeo maior que 50 MB. Ligue o Mux para enviar vídeos sem limite de qualidade.");
      }
      const storage = createClient().storage.from("media");
      const id = crypto.randomUUID();
      const poster = await capturePoster(file).catch(() => null);
      if (!poster) throw new Error("Não foi possível ler este vídeo. Tente um MP4 ou MOV.");
      const posterPath = `${ctx.restaurantId}/items/${id}-p.${extOf(poster)}`;
      const p = await storage.upload(posterPath, poster, { contentType: poster.type, cacheControl: "31536000" });
      if (p.error) throw p.error;
      uploaded.current.push(posterPath);

      let input: MediaInput;
      if (start.mux) {
        const { UpChunk } = await import("@mux/upchunk");
        await new Promise<void>((resolve, reject) => {
          const up = UpChunk.createUpload({ endpoint: start.url!, file, chunkSize: 16384 });
          up.on("progress", (e) => setProgress(Math.round(e.detail)));
          up.on("success", () => resolve());
          up.on("error", () => reject(new Error("upload")));
        });
        muxUploads.current.push(start.uploadId!);
        input = { kind: "video", poster: posterPath, uploadId: start.uploadId };
      } else {
        const ext = (file.name.split(".").pop() ?? "mp4").toLowerCase();
        const path = `${ctx.restaurantId}/items/${id}.${ext}`;
        const v = await storage.upload(path, file, { contentType: file.type || "video/mp4", cacheControl: "31536000" });
        if (v.error) throw v.error;
        uploaded.current.push(path);
        input = { kind: "video", poster: posterPath, path };
      }
      setMedia({
        kind: "video",
        url: URL.createObjectURL(file),
        thumb: mediaUrl(posterPath)!,
        status: start.mux ? "processing" : "ready",
        input,
      });
      setMediaChanged(true);
    } catch (e) {
      const msg = e instanceof Error && e.message.length > 12 ? e.message : null;
      setErr(msg ?? "Não foi possível enviar o vídeo. Tente de novo.");
    } finally {
      setUploading(false);
      setProgress(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const uploadPhoto = async (file: File) => {
    setUploading(true);
    try {
      // Foto em qualidade máxima para a tela cheia do celular; miniatura leve para a capa e a lista.
      const [full, small] = await Promise.all([
        shrinkImage(file, 2560, 0.92, "image/jpeg"),
        shrinkImage(file, 480, 0.8, "image/jpeg"),
      ]);
      const id = crypto.randomUUID();
      const path = `${ctx.restaurantId}/items/${id}.${extOf(full)}`;
      const thumbPath = `${ctx.restaurantId}/items/${id}-t.${extOf(small)}`;
      const storage = createClient().storage.from("media");
      const opts = (b: Blob) => ({ contentType: b.type, cacheControl: "31536000" });
      const [a, b] = await Promise.all([storage.upload(path, full, opts(full)), storage.upload(thumbPath, small, opts(small))]);
      if (a.error || b.error) throw a.error ?? b.error;
      uploaded.current.push(path, thumbPath);
      setMedia({
        kind: "photo",
        url: mediaUrl(path)!,
        thumb: mediaUrl(thumbPath)!,
        status: "ready",
        input: { kind: "photo", path, thumb: thumbPath },
      });
      setMediaChanged(true);
    } catch {
      setErr("Não foi possível enviar a foto. Tente de novo.");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const save = async () => {
    setErr(null);
    const priceCents = parseMoney(price);
    const promoCents = hasPromo ? parseMoney(promo) : null;
    if (!name.trim()) return setErr("Dê um nome para o prato.");
    if (priceCents == null) return setErr("Informe o preço.");
    if (hasPromo && promoCents == null) return setErr("Informe o preço promocional ou desligue a promoção.");
    setBusy(true);
    const res = await saveItem(ctx.restaurantId, {
      id: item?.id,
      categoryId,
      name,
      description,
      priceCents,
      promoCents,
      tags,
      active,
      media: mediaChanged ? (media?.input ?? null) : undefined,
    });
    if (!res.error && res.id && Object.keys(rows).length) {
      const t = await saveTranslations(ctx.restaurantId, { itemId: res.id }, toRows(rows));
      if (t.error) res.error = t.error;
    }
    setBusy(false);
    if (res.error) return setErr(res.error);
    // A mídia antiga é apagada pelo servidor; a enviada agora passa a ser do prato.
    const inp = mediaChanged ? media?.input : undefined;
    const kept = inp ? (inp.kind === "photo" ? [inp.path, inp.thumb] : [inp.poster, inp.path, inp.uploadId]) : [];
    uploaded.current = uploaded.current.filter((p) => !kept.includes(p));
    muxUploads.current = muxUploads.current.filter((u) => !kept.includes(u));
    close(item ? "Prato salvo." : "Prato criado.");
  };

  const remove = async () => {
    if (!item) return;
    setBusy(true);
    const res = await deleteItem(ctx.restaurantId, item.id);
    setBusy(false);
    if (res.error) return setErr(res.error);
    close("Prato excluído.");
  };

  const duplicate = async () => {
    if (!item) return;
    setBusy(true);
    const res = await duplicateItem(ctx.restaurantId, item.id);
    setBusy(false);
    if (res.error) return setErr(res.error);
    close("Cópia criada, escondida do cardápio até você revisar.");
  };

  const toggleTag = (t: string) => setTags((s) => (s.includes(t) ? s.filter((x) => x !== t) : [...s, t]));

  return (
    <Shell
      title={item ? "Editar prato" : "Novo prato"}
      onClose={() => close()}
      footer={
        <>
          {err && <p className="dr-err" role="alert">{err}</p>}
          <div className="dr-actions">
            {item && <ConfirmDelete label="Excluir" onConfirm={remove} busy={busy} />}
            {item && (
              <button className="btn ghost" onClick={duplicate} disabled={busy}>
                Duplicar
              </button>
            )}
            <span className="dr-gap" />
            <button className="btn ghost" onClick={() => close()} disabled={busy}>
              Cancelar
            </button>
            <button className="btn primary" onClick={save} disabled={busy || uploading}>
              {busy ? "Salvando…" : "Salvar"}
            </button>
          </div>
        </>
      }
    >
      <div className="ap-seg dr-tabs" role="tablist">
        <button role="tab" aria-selected={tab === "prato"} onClick={() => setTab("prato")}>
          Prato
        </button>
        <button
          role="tab"
          aria-selected={tab === "traducoes"}
          onClick={() => {
            setTab("traducoes");
            if (item && !Object.keys(rows).length) setRows(() => seed(item.translations));
          }}
        >
          Traduções{item?.translations.some((t) => t.auto) ? " •" : ""}
        </button>
      </div>

      {tab === "prato" ? (
        <div className="dr-form">
          <div className="dr-photo">
            <button className="dr-photo-box" onClick={() => fileRef.current?.click()} disabled={uploading} aria-label={media ? "Trocar foto ou vídeo" : "Enviar foto ou vídeo"}>
              {media?.kind === "video" ? (
                <video src={media.url.startsWith("blob:") || media.status === "ready" ? media.url : undefined} poster={media.thumb} muted playsInline loop autoPlay />
              ) : media ? (
                <img src={media.url} alt="" />
              ) : (
                <Icon d={CAMERA} />
              )}
              {uploading && (
                <span className="dr-photo-busy">
                  Enviando…{progress != null && progress > 0 && <b>{progress}%</b>}
                  {progress != null && <i style={{ width: `${progress}%` }} />}
                </span>
              )}
            </button>
            <div className="dr-photo-txt">
              <b>Foto ou vídeo do prato</b>
              <span>
                Vertical fica melhor no story (9:16). Foto em PNG, JPG ou WebP; vídeo em MP4 ou MOV, na qualidade
                original.
              </span>
              {media?.kind === "video" && media.status === "processing" && (
                <span className="dr-note">O vídeo entra no cardápio assim que terminar de ser preparado, em poucos minutos.</span>
              )}
              {media?.kind === "video" && media.status === "failed" && (
                <span className="dr-note bad">Não foi possível preparar este vídeo. Envie de novo.</span>
              )}
              <div className="pf-btns">
                <button className="btn small" onClick={() => fileRef.current?.click()} disabled={uploading}>
                  {media ? "Trocar" : "Enviar foto ou vídeo"}
                </button>
                {media && (
                  <button
                    className="btn small ghost"
                    onClick={() => {
                      setMedia(null);
                      setMediaChanged(true);
                    }}
                    disabled={uploading}
                  >
                    Remover
                  </button>
                )}
              </div>
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,video/mp4,video/quicktime,video/webm,.mov,.mp4,.m4v"
              hidden
              onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])}
            />
          </div>

          <label className="dr-field">
            <span>Nome</span>
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="Ex.: Margherita da Casa" />
          </label>
          <label className="dr-field">
            <span>
              Descrição <small>{description.length}/500</small>
            </span>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} maxLength={500} rows={3} placeholder="Ingredientes e o que torna o prato especial." />
          </label>
          <div className="dr-row">
            <label className="dr-field">
              <span>Preço</span>
              <span className="dr-money">
                <i>R$</i>
                <input inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} onBlur={() => setPrice(money(parseMoney(price)))} placeholder="0,00" />
              </span>
            </label>
            <label className="dr-field">
              <span className="dr-check">
                <input type="checkbox" checked={hasPromo} onChange={(e) => setHasPromo(e.target.checked)} />
                Preço promocional
              </span>
              <span className="dr-money">
                <i>R$</i>
                <input inputMode="decimal" value={promo} disabled={!hasPromo} onChange={(e) => setPromo(e.target.value)} onBlur={() => setPromo(money(parseMoney(promo)))} placeholder="0,00" />
              </span>
            </label>
          </div>

          <div className="dr-field">
            <span>Selos</span>
            <div className="dr-tags">
              {TAG_IDS.map((t) => (
                <button key={t} className="dr-tag" aria-pressed={tags.includes(t)} onClick={() => toggleTag(t)}>
                  {tagLabel(t)}
                </button>
              ))}
            </div>
          </div>

          <div className="dr-row">
            <label className="dr-field">
              <span>Categoria</span>
              <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
                {ctx.categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="dr-switch">
              <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
              <span>Mostrar no cardápio</span>
            </label>
          </div>
        </div>
      ) : (
        <Translations
          ctx={ctx}
          base={{ name, description }}
          initial={item?.translations ?? []}
          withDescription
          rows={rows}
          setRows={setRows}
        />
      )}
    </Shell>
  );
}

// ---------- Categoria ----------

export function CategoryDrawer({
  ctx,
  category,
  onClose,
}: {
  ctx: EditorContext;
  category: EditorCategory;
  onClose: (msg?: string) => void;
}) {
  const [name, setName] = useState(category.name);
  const [active, setActive] = useState(category.active);
  const [rows, setRows] = useState<Record<string, EditorTranslation>>(() => seed(category.translations));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const save = async () => {
    setBusy(true);
    setErr(null);
    const res = await updateCategory(ctx.restaurantId, category.id, { name, active });
    if (!res.error && Object.keys(rows).length) {
      const t = await saveTranslations(ctx.restaurantId, { categoryId: category.id }, toRows(rows));
      if (t.error) res.error = t.error;
    }
    setBusy(false);
    if (res.error) return setErr(res.error);
    onClose("Categoria salva.");
  };

  const remove = async () => {
    setBusy(true);
    const res = await deleteCategory(ctx.restaurantId, category.id);
    setBusy(false);
    if (res.error) return setErr(res.error);
    onClose("Categoria excluída.");
  };

  const n = category.items.length;
  return (
    <Shell
      title="Editar categoria"
      onClose={() => onClose()}
      footer={
        <>
          {err && <p className="dr-err" role="alert">{err}</p>}
          <div className="dr-actions">
            <ConfirmDelete label={n ? `Excluir com ${n} ${n === 1 ? "prato" : "pratos"}` : "Excluir"} onConfirm={remove} busy={busy} />
            <span className="dr-gap" />
            <button className="btn ghost" onClick={() => onClose()} disabled={busy}>
              Cancelar
            </button>
            <button className="btn primary" onClick={save} disabled={busy || !name.trim()}>
              {busy ? "Salvando…" : "Salvar"}
            </button>
          </div>
        </>
      }
    >
      <div className="dr-form">
        <label className="dr-field">
          <span>Nome</span>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
        </label>
        <label className="dr-switch">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
          <span>Mostrar no cardápio</span>
        </label>
        <h3 className="dr-sub">Traduções</h3>
        <Translations
          ctx={ctx}
          base={{ name, description: "" }}
          initial={category.translations}
          withDescription={false}
          rows={rows}
          setRows={setRows}
        />
      </div>
    </Shell>
  );
}
