export type IngredientCategoryRecord = {
  id: string;
  name: string;
  nameHe: string;
  nameAr: string;
  nameEn: string;
  description: string;
  archived: boolean;
};

export function mapCategoryRecord(id: string, data: Record<string, unknown>): IngredientCategoryRecord {
  const name = String(data.name ?? data.nameHe ?? "").trim();
  return {
    id,
    name,
    nameHe: String(data.nameHe ?? name).trim(),
    nameAr: String(data.nameAr ?? "").trim(),
    nameEn: String(data.nameEn ?? "").trim(),
    description: String(data.description ?? "").trim(),
    archived: data.archived === true,
  };
}
