// Tags do cache da Comunidade, num módulo sem "server-only" para a rota do cron e os testes.
// comunidade:<slug> = cabeça (getCommunityHead); comunidade:<restaurant_id> = conteúdo
// (agenda, posts e telões) e mesas.
export const communityTags = { slug: (s: string) => `comunidade:${s.toLowerCase()}`, rid: (id: string) => `comunidade:${id}` };
