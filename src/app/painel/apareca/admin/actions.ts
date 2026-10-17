"use server";

import { updateTag } from "next/cache";
import { currentUser } from "@/lib/auth";
import * as db from "@/lib/db/nocodb";
import { aiAllowedPatch, allowedPatch, isSuperAdminUser } from "@/lib/apareca/superadmin";
import { aparecaTags } from "@/lib/apareca/store";

// Super admin do Apareça: só quem está em SUPERADMIN_EMAILS E tem conta criada antes de
// SUPERADMIN_SINCE (obrigatória; variáveis do servidor) grava.
// Toda action confere de novo aqui, sem confiar na página: dono comum recebe erro e nada é gravado.
// Depois de gravar, limpa a cabeça do restaurante no cache do Next (por slug e por id).

type Result = { error?: string };
type Rest = { Id: number; id: string; slug: string; apareca_config?: unknown };

const DENIED = "Acesso negado.";
const FAIL = "Não foi possível salvar. Tente de novo.";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

async function target(rid: unknown): Promise<Rest | null> {
  const u = await currentUser().catch(() => null);
  if (!isSuperAdminUser(u)) return null;
  if (typeof rid !== "string" || !UUID.test(rid)) return null;
  const r = await db.first<Rest>("restaurants", { uid: rid }).catch(() => null);
  return r && r.id === rid ? r : null;
}

async function write(r: Rest, patch: Record<string, unknown>): Promise<Result> {
  try {
    await db.updateRows("restaurants", [{ Id: r.Id, ...patch }]);
  } catch {
    return { error: FAIL };
  }
  updateTag(aparecaTags.slug(String(r.slug).toLowerCase()));
  updateTag(aparecaTags.rid(r.id));
  return {};
}

// Liberar o Apareça na casa. Desligar também desliga o interruptor do dono (apareca_enabled).
export async function setAllowed(rid: string, on: boolean): Promise<Result> {
  const r = await target(rid);
  if (!r) return { error: DENIED };
  return write(r, allowedPatch(on === true));
}

// Liberar a moderação por IA na casa. Desligar volta o modo para manual.
export async function setAiAllowed(rid: string, on: boolean): Promise<Result> {
  const r = await target(rid);
  if (!r) return { error: DENIED };
  return write(r, aiAllowedPatch(on === true, r.apareca_config));
}
