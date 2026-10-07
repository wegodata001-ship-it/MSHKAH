import { geminiGenerateJson } from "@/lib/ai/gemini-client";
import { aliasOverlap } from "@/lib/costing/ingredient-aliases";
import { normalizeIngredientName } from "@/lib/costing/names";
import type { CostingIngredient } from "@/lib/costing/types";
import { needsReview } from "@/lib/inventory/invoice-extract";

export type RecipeSuggestionMatchKind = "exact" | "suggest" | "missing";

export type RecipeIngredientSuggestion = {
  name: string;
  confidence: number | null;
  needsReview: boolean;
  matchKind: RecipeSuggestionMatchKind;
  productId?: string;
  productName?: string;
  matchConfidence: number | null;
  costPerBaseUnit?: number | null;
  purchaseUnit?: string | null;
};

const SCHEMA = {
  type: "OBJECT",
  properties: {
    ingredients: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          name: { type: "STRING" },
          confidence: { type: "NUMBER", nullable: true },
          needsReview: { type: "BOOLEAN" },
        },
      },
    },
  },
};

function num(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function conf(value: unknown): number | null {
  const n = num(value);
  if (n == null) return null;
  return Math.max(0, Math.min(1, n > 1 ? n / 100 : n));
}

export function matchRecipeSuggestion(
  name: string,
  ingredients: CostingIngredient[]
): Pick<RecipeIngredientSuggestion, "matchKind" | "productId" | "productName" | "matchConfidence" | "costPerBaseUnit" | "purchaseUnit"> {
  const target = normalizeIngredientName(name);
  if (!target) return { matchKind: "missing", matchConfidence: null };
  const exact = ingredients.filter((item) => normalizeIngredientName(item.name) === target);
  if (exact.length === 1) {
    return {
      matchKind: "exact",
      productId: exact[0].id,
      productName: exact[0].name,
      matchConfidence: 1,
      costPerBaseUnit: exact[0].costPerBaseUnit,
      purchaseUnit: exact[0].purchaseUnit,
    };
  }
  const scored = ingredients
    .map((item) => ({ item, score: aliasOverlap(name, item.name) }))
    .filter((row) => row.score >= 0.8)
    .sort((a, b) => b.score - a.score);
  if (scored[0] && (scored.length === 1 || scored[0].score - (scored[1]?.score ?? 0) >= 0.04)) {
    return {
      matchKind: "suggest",
      productId: scored[0].item.id,
      productName: scored[0].item.name,
      matchConfidence: scored[0].score,
      costPerBaseUnit: scored[0].item.costPerBaseUnit,
      purchaseUnit: scored[0].item.purchaseUnit,
    };
  }
  return { matchKind: "missing", matchConfidence: null };
}

export function buildRecipeSuggestions(
  names: { name: string; confidence?: number | null; needsReview?: boolean }[],
  ingredients: CostingIngredient[]
): RecipeIngredientSuggestion[] {
  return names
    .map((row) => {
      const name = row.name.trim();
      const confidence = conf(row.confidence);
      const match = matchRecipeSuggestion(name, ingredients);
      return {
        name,
        confidence,
        needsReview: row.needsReview === true || needsReview(confidence) || match.matchKind !== "exact",
        ...match,
      };
    })
    .filter((row) => row.name)
    .slice(0, 16);
}

export async function suggestRecipeIngredientsFromGemini(input: {
  dishName: string;
  description?: string;
  inventoryNames: string[];
}): Promise<{ suggestions: { name: string; confidence: number | null; needsReview: boolean }[]; model: string; httpStatus: number }> {
  const inventory = input.inventoryNames.slice(0, 250).join(", ");
  const prompt = `Suggest raw ingredients that belong in this dish. Return JSON only.
Do not invent quantities, units, or prices.
If unsure, set needsReview=true.
Prefer names that can match this inventory list when the match is clear: ${inventory || "(empty)"}.
Do not suggest unrelated pantry items.
Dish: ${input.dishName}
Description: ${input.description || "(none)"}`;
  const { text, model, httpStatus } = await geminiGenerateJson({
    parts: [{ text: prompt }],
    temperature: 0.2,
    schema: SCHEMA,
  });
  try {
    const json = JSON.parse(text.replace(/^```json\s*|```$/g, "").trim()) as {
      ingredients?: { name?: unknown; confidence?: unknown; needsReview?: unknown }[];
    };
    const suggestions = (json.ingredients ?? [])
      .map((row) => ({
        name: typeof row.name === "string" ? row.name.trim() : "",
        confidence: conf(row.confidence),
        needsReview: row.needsReview === true,
      }))
      .filter((row) => row.name);
    return { suggestions, model, httpStatus };
  } catch {
    return { suggestions: [], model, httpStatus };
  }
}
