// Limitador em memória, por chave, com janela móvel: no máximo `max` batidas aceitas nos
// últimos `windowMs`. Vale por instância do servidor (melhor esforço): duas instâncias
// contam separado, e uma instância nova começa do zero. Batida recusada não conta.
// A memória é podada: a cada janela, some quem não bateu nela; e nunca passa de maxKeys
// chaves (sai a mais antiga). Quem reserva uma batida antes de saber se vai usá-la (o código
// do telão, que só conta quando cria um novo) devolve com undo.

export type Limiter = {
  hit(key: string): boolean; // true = aceita (e conta); false = passou do limite
  undo(key: string): void; // devolve a batida mais nova da chave (reservou e não usou)
  size(): number; // chaves guardadas (para os testes e para a poda)
};

export type LimiterOptions = { max: number; windowMs: number; now?: () => number; maxKeys?: number };

export const LIMITER_MAX_KEYS = 10_000;

export function createLimiter(o: LimiterOptions): Limiter {
  // Date.now lido a cada chamada (e não guardado): relógio falso nos testes vale também aqui.
  const now = o.now ?? (() => Date.now());
  const maxKeys = o.maxKeys ?? LIMITER_MAX_KEYS;
  // Batidas aceitas de cada chave, da mais velha para a mais nova.
  const hits = new Map<string, number[]>();
  let lastSweep = now();

  const trim = (list: number[], t: number) => {
    let k = 0;
    while (k < list.length && t - list[k] >= o.windowMs) k++;
    if (k) list.splice(0, k);
  };
  const sweep = (t: number) => {
    for (const [key, list] of hits) {
      trim(list, t);
      if (!list.length) hits.delete(key);
    }
    lastSweep = t;
  };

  return {
    hit(key) {
      const t = now();
      if (t - lastSweep >= o.windowMs) sweep(t);
      let list = hits.get(key);
      if (list) {
        trim(list, t);
        if (list.length >= o.max) return false;
      } else {
        if (hits.size >= maxKeys) sweep(t);
        // Ainda cheio: sai a chave mais antiga (o Map guarda a ordem de entrada).
        while (hits.size >= maxKeys) {
          const oldest = hits.keys().next();
          if (oldest.done) break;
          hits.delete(oldest.value);
        }
        list = [];
        hits.set(key, list);
      }
      list.push(t);
      return true;
    },
    undo(key) {
      const list = hits.get(key);
      if (!list) return;
      list.pop();
      if (!list.length) hits.delete(key);
    },
    size: () => hits.size,
  };
}

// Um limitador por nome e por processo, guardado no globalThis: as rotas que carregarem
// cópias diferentes deste módulo continuam contando no mesmo lugar. As opções valem na
// primeira chamada de cada nome.
export function sharedLimiter(name: string, o: Omit<LimiterOptions, "now">): Limiter {
  const key = Symbol.for(`cardapio-digital.comunidade.limite.${name}`);
  const g = globalThis as unknown as Record<symbol, Limiter | undefined>;
  return (g[key] ??= createLimiter(o));
}
