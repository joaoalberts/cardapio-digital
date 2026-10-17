"use client";

import { useRouter } from "next/navigation";
import { startTransition, useRef, useState, useTransition } from "react";
import { extOf, IMAGE_TYPES, shrinkImage } from "@/lib/images/shrink";
import { uploadFile } from "@/lib/upload-client";
import { uuid } from "@/lib/uuid";
import { discardFiles } from "../files-actions";
import { addHousePost } from "./actions";
import { ICONS, Icon } from "./shared";

// Envio de foto de prato para o Mural: prato, "pode ir para o telão" e o botão. Sai do editor da
// Comunidade para a tela "Agora" usar o mesmo. Enviada a foto, pede os dados novos e chama
// onSent; sem onSent (fora do editor, que mostra o aviso dele), mostra o próprio aviso.

export type HousePhotoData = {
  restaurantId: string;
  categories: { name: string; items: { id: string; name: string; thumb: string | null }[] }[];
};

export function HousePhotoSend({ data, onSent }: { data: HousePhotoData; onSent?: () => void }) {
  const router = useRouter();
  const file = useRef<HTMLInputElement>(null);
  const [dish, setDish] = useState("");
  const [tv, setTv] = useState(false);
  const [busy, startSend] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const rid = data.restaurantId;

  // Foto até 1.600 px e miniatura até 480 px, reduzidas aqui no navegador; as duas vão para
  // a pasta comunidade do restaurante. Se gravar o post falhar, os arquivos são apagados.
  // O botão fica em "Enviando…" até a foto nova aparecer na lista.
  const send = (f: File) => {
    setErr(null);
    setDone(false);
    if (!IMAGE_TYPES.test(f.type)) return setErr("Use uma foto (PNG, JPG ou WebP).");
    startSend(async () => {
      const sent: string[] = [];
      try {
        const [full, small] = await Promise.all([shrinkImage(f, 1600, 0.85, "image/jpeg"), shrinkImage(f, 480, 0.8, "image/jpeg")]);
        const id = uuid();
        sent.push(await uploadFile(rid, `comunidade/${id}-full.${extOf(full)}`, full));
        sent.push(await uploadFile(rid, `comunidade/${id}-thumb.${extOf(small)}`, small));
        const res = await addHousePost(rid, { item_id: dish, photo_url: sent[0], thumb_url: sent[1], on_tv: tv });
        if (res.error) throw new Error(res.error);
        sent.length = 0;
        startTransition(() => {
          setTv(false);
          setDone(true);
          router.refresh();
          onSent?.();
        });
      } catch (e) {
        if (sent.length) await discardFiles(rid, sent).catch(() => undefined);
        setErr(e instanceof Error && e.message.length > 12 ? e.message : "Não foi possível enviar a foto. Tente de novo.");
      } finally {
        if (file.current) file.current.value = "";
      }
    });
  };

  return (
    <div className="cp-send">
      <label className="cp-fld">
        <span>Prato da foto</span>
        <span className="cp-in">
          <select value={dish} onChange={(e) => setDish(e.target.value)}>
            <option value="">Escolha um prato…</option>
            {data.categories.map((c) => (
              <optgroup key={c.name} label={c.name}>
                {c.items.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </span>
      </label>
      <label className="cp-check">
        <input type="checkbox" checked={tv} onChange={(e) => setTv(e.target.checked)} />
        <span>Pode ir para o telão: só o prato, sem pessoas</span>
      </label>
      <input
        ref={file}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) send(f);
        }}
      />
      <button className="btn primary cp-new" disabled={!dish || busy} onClick={() => file.current?.click()}>
        <Icon d={ICONS.camera} />
        {busy ? "Enviando…" : "Enviar foto"}
      </button>
      {!dish && <small className="cp-hint">Escolha o prato antes de enviar a foto.</small>}
      {err && (
        <p className="cp-err" role="alert">
          {err}
        </p>
      )}
      {done && !onSent && !err && (
        <p className="cp-pairok" role="status">
          ✓ Foto publicada no Mural.
        </p>
      )}
    </div>
  );
}
