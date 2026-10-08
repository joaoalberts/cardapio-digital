"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { saveMenuSettings } from "../perfil/actions";
import { FootButtons, Modal } from "./modals";
import type { EditorRestaurant } from "./menu-editor";

export function menuLink(slug: string) {
  return `${location.origin}/${slug}`;
}

export function useQr(text: string | null, size = 480) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    if (!text) return;
    let live = true;
    QRCode.toDataURL(text, { width: size, margin: 1, errorCorrectionLevel: "M" }).then((u) => live && setSrc(u));
    return () => {
      live = false;
    };
  }, [text, size]);
  return src;
}

// "Acesse seu cardápio": link para copiar e o QR Code para baixar ou imprimir.
export function LinkModal({ slug, onClose }: { slug: string; onClose: () => void }) {
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [showQr, setShowQr] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => setLink(menuLink(slug)), 0);
    return () => clearTimeout(id);
  }, [slug]);
  const qr = useQr(link, 720);

  const copy = async () => {
    if (!link) return;
    await navigator.clipboard?.writeText(link).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  return (
    <Modal title="Acesse seu cardápio" onClose={onClose}>
      <div className="lk">
        <div className="lk-row">
          <input readOnly value={link ?? ""} aria-label="Link do cardápio" onFocus={(e) => e.currentTarget.select()} />
          <button className="lk-copy" onClick={copy} aria-label="Copiar link" title="Copiar link">
            <svg className="icon" viewBox="0 0 24 24" aria-hidden>
              <path d="M9 9h11v11H9zM5 15H4V4h11v1" />
            </svg>
          </button>
          <button className="btn primary" onClick={() => setShowQr((v) => !v)}>
            QrCode
          </button>
        </div>
        {copied && <p className="md-note center">Link copiado.</p>}
        {showQr && qr && (
          <div className="lk-qr">
            {/* eslint-disable-next-line @next/next/no-img-element -- QR gerado no navegador */}
            <img src={qr} alt="QR Code do cardápio" />
            <div className="lk-qr-btns">
              <a className="btn outline" href={qr} download={`qrcode-${slug}.png`}>
                Baixar QR Code
              </a>
              <a className="btn outline" href="/painel/imprimir?tipo=mesa" target="_blank" rel="noreferrer">
                Display de mesa
              </a>
            </div>
          </div>
        )}
        <a className="md-link center" href={`/${slug}`} target="_blank" rel="noreferrer">
          Abrir o cardápio numa nova aba
        </a>
      </div>
    </Modal>
  );
}

// Configurações do cardápio (as partes do DGuests que valem para este sistema).
export function SettingsModal({
  restaurant,
  onClose,
  onOrder,
}: {
  restaurant: EditorRestaurant;
  onClose: (msg?: string) => void;
  onOrder: () => void;
}) {
  const [color, setColor] = useState(restaurant.brandColor ?? "#b8862f");
  const [wifiName, setWifiName] = useState(restaurant.wifiName ?? "");
  const [wifiPassword, setWifiPassword] = useState(restaurant.wifiPassword ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const save = async () => {
    setBusy(true);
    setErr(null);
    const res = await saveMenuSettings(restaurant.id, { brandColor: color, wifiName, wifiPassword });
    setBusy(false);
    if (res.error) return setErr(res.error);
    onClose("Configurações salvas.");
  };

  return (
    <Modal
      title="Configurações"
      onClose={() => onClose()}
      footer={
        <>
          {err && (
            <p className="md-err" role="alert">
              {err}
            </p>
          )}
          <FootButtons onClose={() => onClose()} onSave={save} busy={busy} disabled={!restaurant.isOwner} />
        </>
      }
    >
      <div className="st-links">
        <button className="st-link" onClick={onOrder}>
          Mudar ordem das categorias/produtos
        </button>
        <a className="st-link" href="/painel/imprimir?tipo=mesa" target="_blank" rel="noreferrer">
          Display de mesa com QR Code
        </a>
      </div>

      <h3 className="md-sep">
        <span>Cardápio</span>
      </h3>
      <label className="md-inline">
        Trocar cor
        <input type="color" value={color} onChange={(e) => setColor(e.target.value)} aria-label="Cor do cardápio" />
      </label>

      <h3 className="md-sep">
        <span>Informações</span>
      </h3>
      <label className="md-field">
        <span>Rede Wi-fi</span>
        <input value={wifiName} onChange={(e) => setWifiName(e.target.value)} maxLength={60} />
      </label>
      <label className="md-field">
        <span>Senha Wi-fi</span>
        <input value={wifiPassword} onChange={(e) => setWifiPassword(e.target.value)} maxLength={60} />
      </label>

      <h3 className="md-sep">
        <span>Download</span>
      </h3>
      <div className="st-links">
        <a className="st-link" href="/painel/cardapio/exportar" download>
          Baixar cardápio csv
        </a>
        <a className="st-link" href="/painel/imprimir?tipo=cardapio" target="_blank" rel="noreferrer">
          Baixar cardápio pdf
        </a>
      </div>
      {!restaurant.isOwner && <p className="md-note">Só o dono do restaurante pode salvar as configurações.</p>}
    </Modal>
  );
}
