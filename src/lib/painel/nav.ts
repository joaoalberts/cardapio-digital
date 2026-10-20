// Menu do painel: um só lugar para a barra lateral (computador) e para a barra de baixo + "Mais" (celular).
export type NavItem = { href: string; label: string; icon: string };

const PEDIDOS: NavItem = { href: "/painel/pedidos", label: "Pedidos", icon: "M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6" };
const AGORA: NavItem = { href: "/painel/agora", label: "Agora", icon: "M13 2L4 14h7l-1 8 9-12h-7z" };
const CARDAPIO: NavItem = { href: "/painel/cardapio", label: "Cardápio", icon: "M12 5v14M5 12h14" };
const ESPECIAIS: NavItem = { href: "/painel/especiais", label: "Produtos especiais", icon: "M12 2l2.9 6.3 6.9.8-5.1 4.7 1.4 6.8L12 17.3 5.9 20.6l1.4-6.8L2.2 9.1l6.9-.8z" };
const APARENCIA: NavItem = { href: "/painel/aparencia", label: "Aparência", icon: "M12 3a9 9 0 100 18c1 0 1.5-.7 1.5-1.5 0-1.2-1-1.6-1-2.6 0-.8.7-1.4 1.5-1.4H16a5 5 0 005-5c0-4-4-7.5-9-7.5zM7.5 12a1 1 0 100-2 1 1 0 000 2zM10.5 8a1 1 0 100-2 1 1 0 000 2zM15 8a1 1 0 100-2 1 1 0 000 2z" };
const MESAS: NavItem = { href: "/painel/mesas", label: "Mesas e QR", icon: "M3 4h18v4H3zM4 8v12M20 8v12M4 14h16" };
const TVS: NavItem = { href: "/painel/tvs", label: "TVs", icon: "M3 4h18v12H3zM9 20h6M12 16v4M7 9h10" };
const APARECA: NavItem = { href: "/painel/apareca", label: "Apareça na TV", icon: "M3 5h18v12H3zM8 21h8M12 17v4" };
const PERFIL: NavItem = { href: "/painel/perfil", label: "Perfil", icon: "M10 12a4 4 0 100-8 4 4 0 000 8zM3 21c0-4 3.1-7 7-7 1.3 0 2.5.3 3.5.9M17.5 14.5l3 3-4.5 4.5h-3v-3z" };
const SUPORTE: NavItem = { href: "/painel/suporte", label: "Suporte", icon: "M4 6h16v12H4zM4 7l8 6 8-6" };
const MAIS: NavItem = { href: "/painel/mais", label: "Mais", icon: "M4 7h16M4 12h16M4 17h16" };

export const NAV_GROUPS: { title: string; items: NavItem[] }[] = [
  { title: "Durante o serviço", items: [PEDIDOS, AGORA] },
  { title: "Cardápio", items: [CARDAPIO, ESPECIAIS, APARENCIA] },
  { title: "Salão", items: [MESAS, TVS, APARECA] },
  { title: "Conta", items: [PERFIL, SUPORTE] },
];

export const BOTTOM_NAV: NavItem[] = [PEDIDOS, AGORA, CARDAPIO, MAIS];

// "Abrir cardápio" e "Sair" entram na página, porque dependem do menuHref e de um form.
export const MAIS_GROUPS: { title: string; items: NavItem[] }[] = [
  { title: "Cardápio", items: [ESPECIAIS, APARENCIA] },
  { title: "Salão", items: [MESAS, TVS, APARECA] },
  { title: "Conta", items: [PERFIL, SUPORTE] },
];
