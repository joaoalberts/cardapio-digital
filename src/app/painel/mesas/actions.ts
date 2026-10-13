"use server";

import { randomInt } from "node:crypto";
import { revalidatePath } from "next/cache";
import { isMember } from "@/lib/auth";
import * as db from "@/lib/db/nocodb";

type Result = { error?: string; id?: string; code?: string };

const MAX_TABLES = 200;
const FAIL = "Não foi possível salvar. Tente de novo.";

// Código curto e fixo de cada mesa, sem letras que se confundem (0/O, 1/I/L).
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const newCode = () => Array.from({ length: 6 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");

// Mesas: cada uma tem um código curto e fixo, que vai no QR Code impresso.
export async function addTable(restaurantId: string, label: string): Promise<Result> {
  const name = String(label ?? "").trim().slice(0, 40);
  if (!name) return { error: "Dê um nome para a mesa." };
  if (!(await isMember(restaurantId))) return { error: "Entre de novo no painel." };
  try {
    const all = await db.list<{ label: string }>("dining_tables", { restaurant_id: restaurantId });
    if (all.length >= MAX_TABLES) return { error: `Limite de ${MAX_TABLES} mesas.` };
    if (all.some((r) => r.label.toLowerCase() === name.toLowerCase())) {
      return { error: "Já existe uma mesa com esse nome." };
    }
    // O código é único no sistema todo (o QR leva só ele e o endereço do restaurante).
    let code = newCode();
    for (let k = 0; k < 5 && (await db.first("dining_tables", { code })); k++) code = newCode();
    const row = await db.insertOne("dining_tables", { restaurant_id: restaurantId, label: name, code, active: true });
    revalidatePath("/painel/mesas");
    return { id: row.id, code };
  } catch {
    return { error: FAIL };
  }
}

export async function removeTable(restaurantId: string, id: string): Promise<Result> {
  if (!/^[0-9a-f-]{36}$/.test(String(id)) || !(await isMember(restaurantId))) return { error: FAIL };
  try {
    await db.remove("dining_tables", { uid: id, restaurant_id: restaurantId });
  } catch {
    return { error: FAIL };
  }
  revalidatePath("/painel/mesas");
  return {};
}
