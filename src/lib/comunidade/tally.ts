// Contagem da enquete. O device é forjável, então além de "um voto por device" há tetos
// por mesa e por restaurante, sempre por enquete. O voto (votes.ts) recusa o que passa do
// teto, e o agregado aplica os mesmos tetos pela ordem de gravação: uma corrida que grave
// além do teto não muda a porcentagem.
import type { OptionId, VoteRow } from "./types";

export const VOTE_CAP_PER_TABLE = 8;
export const VOTE_CAP_PER_RESTAURANT = 400;

// Na ordem recebida (a de gravação): o primeiro voto de cada device; depois, os tetos.
// Um voto repetido do mesmo device não gasta o teto da mesa.
export function effectiveVotes(
  votes: VoteRow[],
  caps: { perTable: number; perRestaurant: number } = { perTable: VOTE_CAP_PER_TABLE, perRestaurant: VOTE_CAP_PER_RESTAURANT },
): VoteRow[] {
  const devices = new Set<string>();
  const perTable = new Map<string, number>();
  const perPoll = new Map<string, number>();
  const out: VoteRow[] = [];
  for (const v of votes) {
    const dev = `${v.poll_id}|${v.device_id}`;
    if (devices.has(dev)) continue;
    devices.add(dev);
    const table = `${v.poll_id}|${v.table_id}`;
    const atTable = perTable.get(table) ?? 0;
    const atPoll = perPoll.get(v.poll_id) ?? 0;
    if (atTable >= caps.perTable || atPoll >= caps.perRestaurant) continue;
    perTable.set(table, atTable + 1);
    perPoll.set(v.poll_id, atPoll + 1);
    out.push(v);
  }
  return out;
}

// Porcentagens inteiras pelo maior resto: a soma dá 100 (ou tudo 0, sem votos). No empate
// de restos, ganha a opção que vem primeiro em ids. Voto em opção fora de ids é ignorado.
export function percentages(votes: VoteRow[], ids: OptionId[]): Record<OptionId, number> {
  const counts = ids.map((id) => votes.filter((v) => v.option_id === id).length);
  const total = counts.reduce((a, b) => a + b, 0);
  const pct = counts.map((c) => (total ? Math.floor((c * 100) / total) : 0));
  if (total) {
    const rest = counts.map((c, i) => ({ i, r: (c * 100) % total }));
    rest.sort((x, y) => y.r - x.r || x.i - y.i);
    let missing = 100 - pct.reduce((a, b) => a + b, 0);
    for (let k = 0; missing > 0; k = (k + 1) % rest.length, missing--) pct[rest[k].i]++;
  }
  return Object.fromEntries(ids.map((id, i) => [id, pct[i]])) as Record<OptionId, number>;
}
