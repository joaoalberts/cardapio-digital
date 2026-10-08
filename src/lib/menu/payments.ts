// Meios de pagamento (mesma lista do banco), com o nome em cada idioma do cardápio.
export const PAYMENTS = {
  pix: ["Pix", "Pix", "Pix", "Pix", "Pix", "Pix"],
  credito: ["Cartão de crédito", "Credit card", "Tarjeta de crédito", "Carte de crédit", "Carta di credito", "Kreditkarte"],
  debito: ["Cartão de débito", "Debit card", "Tarjeta de débito", "Carte de débit", "Bancomat", "Debitkarte"],
  dinheiro: ["Dinheiro", "Cash", "Efectivo", "Espèces", "Contanti", "Bargeld"],
  vale_refeicao: ["Vale-refeição", "Meal voucher", "Vale de comida", "Titre-restaurant", "Buono pasto", "Essensgutschein"],
} as const;

export const PAYMENT_IDS = Object.keys(PAYMENTS) as (keyof typeof PAYMENTS)[];

const LANG_INDEX: Record<string, number> = { "pt-BR": 0, en: 1, es: 2, fr: 3, it: 4, de: 5 };

export function paymentLabel(id: string, lang = "pt-BR") {
  const row = PAYMENTS[id as keyof typeof PAYMENTS];
  return row ? row[LANG_INDEX[lang] ?? LANG_INDEX[lang.slice(0, 2)] ?? 0] : id;
}
