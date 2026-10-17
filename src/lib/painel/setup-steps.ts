// Lista "Montar a casa": o que falta para o restaurante funcionar. Lógica pura; a tela só desenha.
export type SetupInput = {
  items: number;
  tables: number;
  communityOn: boolean;
  tvs: number;
  houseReady: number;
  aparecaAllowed: boolean;
  aparecaOn: boolean;
  isOwner: boolean;
};
export type SetupStepId = "cardapio" | "mesas" | "comunidade" | "tv" | "casa" | "apareca";
export type SetupStep = { id: SetupStepId; label: string; done: boolean; href: string; ownerOnly: boolean; blocked: boolean };

export function setupSteps(i: SetupInput): SetupStep[] {
  // "Peça ao dono": só quem é dono liga a Comunidade e o Apareça; o funcionário vê o passo travado.
  const step = (id: SetupStepId, label: string, done: boolean, href: string, ownerOnly = false): SetupStep => ({
    id,
    label,
    done,
    href,
    ownerOnly,
    blocked: ownerOnly && !i.isOwner && !done,
  });
  const steps = [
    step("cardapio", "Montar o cardápio", i.items > 0, "/painel/cardapio"),
    step("mesas", "Cadastrar as mesas e imprimir os QR", i.tables > 0, "/painel/mesas"),
    step("comunidade", "Ligar a Comunidade", i.communityOn, "/painel/comunidade", true),
    step("tv", "Ligar a primeira TV", i.tvs > 0, "/painel/tvs"),
  ];
  // Os passos do Apareça só existem para quem foi liberado.
  if (i.aparecaAllowed) {
    steps.push(
      step("casa", "Enviar um vídeo da casa", i.houseReady > 0, "/painel/apareca#casa"),
      step("apareca", "Ligar o Apareça na TV", i.aparecaOn, "/painel/apareca#ajustes", true),
    );
  }
  return steps;
}

export function setupDone(steps: SetupStep[]): boolean {
  return steps.every((s) => s.done);
}
