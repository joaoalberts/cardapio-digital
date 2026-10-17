"use client";

import { useEffect, useState } from "react";

// Diagnóstico de vídeo no celular: abra o cardápio com ?debug=video e um quadro mostra,
// a cada meio segundo, o estado de cada vídeo (carregando, tocando, travado). Serve para
// ver no aparelho de verdade o que o simulador não mostra. Sem o parâmetro, não aparece.
const STATE = ["vazio", "metadados", "1º quadro", "pode tocar", "liso"];

type Row = { who: string; kind: string; state: string; play: string; t: string; buf: string; net: string; err: string };

function read(): Row[] {
  return [...document.querySelectorAll("video")]
    .filter((v) => v.currentSrc || v.dataset.want === "1")
    .map((v) => {
      const who = v.closest(".hero") ? "banner" : v.closest(".viewer") ? "story" : "card";
      const src = v.currentSrc;
      const end = v.buffered.length ? v.buffered.end(v.buffered.length - 1) : 0;
      return {
        who,
        kind: !src ? "-" : src.startsWith("blob:") ? "hls.js" : src.includes(".m3u8") ? "hls" : "mp4",
        state: STATE[v.readyState] ?? String(v.readyState),
        play: v.paused ? (v.dataset.want === "1" ? "QUER TOCAR" : "pausado") : "tocando",
        t: v.currentTime.toFixed(1),
        buf: end.toFixed(1),
        net: ["vazio", "parado", "baixando", "sem fonte"][v.networkState] ?? "",
        err: v.error ? `erro ${v.error.code}` : "",
      };
    });
}

export function VideoDebug() {
  const [snap, setSnap] = useState<{ rows: Row[]; secs: string; ua: string } | null>(null);
  useEffect(() => {
    if (new URLSearchParams(location.search).get("debug") !== "video") return;
    const ua = navigator.userAgent.match(/iPhone OS [\d_]+|Android [\d.]+/)?.[0] ?? "";
    const id = setInterval(() => setSnap({ rows: read(), secs: (performance.now() / 1000).toFixed(1), ua }), 500);
    return () => clearInterval(id);
  }, []);
  if (!snap) return null;
  return (
    <div
      style={{
        position: "fixed",
        left: 6,
        right: 6,
        bottom: 6,
        zIndex: 9999,
        background: "rgba(0,0,0,.82)",
        color: "#9f9",
        font: "11px/1.35 ui-monospace, Menlo, monospace",
        padding: 6,
        borderRadius: 8,
        pointerEvents: "none",
        maxHeight: "40vh",
        overflow: "hidden",
      }}
    >
      <div>
        {snap.secs} s desde a abertura · {snap.ua}
      </div>
      {snap.rows.map((r, i) => (
        <div key={i} style={{ color: r.err ? "#f88" : r.play === "QUER TOCAR" ? "#fd6" : undefined }}>
          {r.who} {r.kind} · {r.state} · {r.play} · {r.t}s/{r.buf}s · {r.net} {r.err}
        </div>
      ))}
    </div>
  );
}
