// Tags do cache da TV, num módulo sem "server-only" para a rota do cron e os testes.
// tv:<slug> = cabeça (getTvHead); tv:<restaurant_id> = TVs do restaurante (getTvRows).
export const tvTags = { slug: (s: string) => `tv:${s.toLowerCase()}`, rid: (id: string) => `tv:${id}` };
