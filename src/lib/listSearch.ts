/** Normaliza texto para busca: minúsculas, sem acentos, "_" e "-" viram espaço. */
export function normalizeSearch(value: unknown): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[_-]+/g, ' ')
    .toLowerCase()
    .trim();
}

/** Verdadeiro quando todas as palavras da busca aparecem no nome. */
export function matchesSearch(name: unknown, query: string): boolean {
  const q = normalizeSearch(query);
  if (!q) return true;
  const target = normalizeSearch(name);
  return q.split(/\s+/).every((word) => target.includes(word));
}

export type TemplateCategoryFilter = 'all' | 'UTILITY' | 'MARKETING';

export function matchesTemplateCategory(category: unknown, filter: TemplateCategoryFilter): boolean {
  if (filter === 'all') return true;
  return String(category ?? '').toUpperCase() === filter;
}
