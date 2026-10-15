import { getTableLabel } from "@/lib/menu/data";
import { TableBridge } from "./order/table-bridge";

// Código do QR de mesa: 6 letras e números, sem os que se confundem (0/O, 1/I/L).
const CODE = /^[A-Z2-9]{6}$/;

// Mostra "Mesa 5" no topo do cardápio quando o cliente lê o QR de uma mesa. Sem o código
// válido, ou com mesa desconhecida, não mostra nada.
export async function MesaTag({ slug, search }: { slug: string; search: Promise<{ mesa?: string | string[] }> }) {
  const mesa = (await search).mesa;
  const code = typeof mesa === "string" ? mesa.trim().toUpperCase() : "";
  if (!CODE.test(code)) return null;
  const label = await getTableLabel(slug, code);
  if (!label) return null;
  return (
    <>
      <div className="table-tag">{label}</div>
      <TableBridge code={code} label={label} />
    </>
  );
}
