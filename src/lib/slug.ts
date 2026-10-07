// "Pizzaria São João" -> "pizzaria-sao-joao". Mesmo formato que o banco aceita.
export function slugify(text: string) {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
}

export const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export function isValidSlug(slug: string) {
  return slug.length >= 3 && slug.length <= 40 && SLUG_PATTERN.test(slug);
}
