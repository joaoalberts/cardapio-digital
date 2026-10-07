import Link from "next/link";

const NAV = [
  { href: "/painel", label: "Início", icon: "M7 3v8M5 3v5a2 2 0 004 0V3M7 11v10M17 3c-2 0-3 2-3 5s1 4 3 4v9" },
  { href: "/painel/aparencia", label: "Aparência", icon: "M4 20h4L19 9a2.8 2.8 0 00-4-4L4 16v4zM13.5 6.5l4 4" },
  { href: "/painel/perfil", label: "Perfil do restaurante", icon: "M12 12a4 4 0 100-8 4 4 0 000 8zM4 21c0-4 3.6-7 8-7s8 3 8 7" },
] as const;

export function PanelNav({
  name,
  slug,
  logo,
  active,
}: {
  name: string;
  slug: string;
  logo: string | null;
  active: (typeof NAV)[number]["href"];
}) {
  return (
    <aside>
      <div className="ap-brand">
        <b>●</b> CARDÁPIO
      </div>
      <div className="ap-rest">
        {/* eslint-disable-next-line @next/next/no-img-element -- logo enviada pelo restaurante */}
        <i>{logo ? <img src={logo} alt="" /> : initials(name)}</i>
        <span>{name}</span>
      </div>
      <nav>
        {NAV.map((n) => (
          <Link
            key={n.href}
            href={n.href}
            className={n.href === active ? "on" : undefined}
            aria-current={n.href === active ? "page" : undefined}
          >
            <svg className="icon" viewBox="0 0 24 24" aria-hidden>
              <path d={n.icon} />
            </svg>
            {n.label}
          </Link>
        ))}
        <a href={`/${slug}`} target="_blank" rel="noreferrer">
          <svg className="icon" viewBox="0 0 24 24" aria-hidden>
            <path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 01-1 1H5a1 1 0 01-1-1V7a1 1 0 011-1h5" />
          </svg>
          Abrir cardápio
        </a>
      </nav>
    </aside>
  );
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
}
