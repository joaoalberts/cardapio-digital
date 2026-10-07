"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { signOut } from "./actions";

// Restaurante no topo da barra lateral: tocou, abre Editar Perfil, Suporte e Sair.
export function ShellMenu({ name, slug, avatar }: { name: string; slug: string; avatar: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`ap-rest${open ? " open" : ""}`}>
      <button className="ap-rest-btn" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        {avatar}
        <span>{name}</span>
        <svg className="caret" viewBox="0 0 24 24" aria-hidden>
          <path d="M6 9l6 6 6-6z" />
        </svg>
      </button>
      {open && (
        <div className="ap-rest-menu">
          <Link href="/painel/perfil">Editar Perfil</Link>
          <a href={`/${slug}`} target="_blank" rel="noreferrer">
            Ver cardápio
          </a>
          <Link href="/painel/suporte">Suporte</Link>
          <form action={signOut}>
            <button>Sair</button>
          </form>
        </div>
      )}
    </div>
  );
}

// Botão redondo laranja para voltar ao topo, só depois de rolar um pouco.
export function TopButton() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const on = () => setShow(scrollY > 500);
    addEventListener("scroll", on, { passive: true });
    return () => removeEventListener("scroll", on);
  }, []);
  if (!show) return null;
  return (
    <button className="ap-up" aria-label="Voltar ao topo" onClick={() => scrollTo({ top: 0, behavior: "smooth" })}>
      <svg viewBox="0 0 24 24" aria-hidden>
        <path d="M12 7l6 9H6z" />
      </svg>
    </button>
  );
}
