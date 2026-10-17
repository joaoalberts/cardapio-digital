import type { AgoraResult } from "./agora";

// Memo de 5 s por restaurante da leitura da tela "Agora" (mesmo padrão do ctxMemo do Apareça): duas telas
// abertas na mesma instância dividem a leitura. Fica fora do actions.ts ("use server" só exporta ações) para
// as ações que mudam a fila ou a enquete esquecerem o retrato desta instância (forgetAgora); as outras
// instâncias veem em até 5 s.
export const AGORA_MS = 5_000;
const memo = new Map<string, { at: number; p: Promise<AgoraResult> }>();

export function memoAgora(rid: string, read: () => Promise<AgoraResult>, now = Date.now()): Promise<AgoraResult> {
  const m = memo.get(rid);
  if (m && now - m.at < AGORA_MS && now >= m.at) return m.p;
  const fresh = { at: now, p: read() };
  // Leitura que falhou não fica guardada: a próxima tenta de novo.
  fresh.p.catch(() => {
    if (memo.get(rid) === fresh) memo.delete(rid);
  });
  memo.set(rid, fresh);
  return fresh.p;
}

export function forgetAgora(rid: string): void {
  memo.delete(rid);
}
