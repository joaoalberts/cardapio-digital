import { connection } from "next/server";
import { getTableLabel } from "@/lib/menu/data";
import { TableBridge } from "./order/table-bridge";

// Código do QR de mesa: 6 letras e números, sem os que se confundem (0/O, 1/I/L).
const CODE = /^[A-Z2-9]{6}$/;

// Liga o pedido à mesa quando o cliente lê o QR dela. Sem o código válido, ou com mesa
// desconhecida, não faz nada. A etiqueta "Mesa 5" saiu do topo a pedido do João (15/10);
// o estilo .table-tag continua no menu.css para quando ela voltar.
export async function MesaTag({ slug, search }: { slug: string; search: Promise<{ mesa?: string | string[] }> }) {
  const mesa = (await search).mesa;
  const code = typeof mesa === "string" ? mesa.trim().toUpperCase() : "";
  if (!CODE.test(code)) return null;
  // A busca passa pelo limite de pedidos do NocoDB, que usa o relógio (Date.now). Os
  // searchParams sozinhos ainda deixam o Next pré-renderizar este trecho; connection()
  // adia para a hora do pedido. Fica dentro do <Suspense>, então o cardápio não espera.
  await connection();
  const label = await getTableLabel(slug, code);
  if (!label) return null;
  return <TableBridge code={code} label={label} />;
}
