import { NextRequest } from "next/server";
import { requireAdminOnly } from "@/lib/auth/verify-admin";
import { isGeminiConfigured } from "@/lib/ai/gemini-config";
import { buildRecipeSuggestions, suggestRecipeIngredientsFromGemini } from "@/lib/ai/gemini-recipe";
import { getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firebase/collections";
import type { CostingIngredient } from "@/lib/costing/types";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const auth = await requireAdminOnly(request);
  if (auth instanceof Response) return auth;
  if (!isGeminiConfigured()) return Response.json({ configured: false, error: "ai-not-configured" }, { status: 503 });
  const body = (await request.json().catch(() => ({}))) as { name?: string; description?: string };
  const name = body.name?.trim() || "";
  if (!name) return Response.json({ error: "name-required" }, { status: 400 });
  try {
    const db = getAdminDb();
    const ingredientsSnap = await db.collection(COLLECTIONS.ingredients).limit(800).get();
    const ingredients = ingredientsSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }) as CostingIngredient);
    const { suggestions, model, httpStatus } = await suggestRecipeIngredientsFromGemini({
      dishName: name,
      description: body.description?.trim() || "",
      inventoryNames: ingredients.filter((item) => item.active !== false).map((item) => item.name),
    });
    return Response.json({
      configured: true,
      provider: "gemini",
      model,
      httpStatus,
      suggestions: buildRecipeSuggestions(suggestions, ingredients),
    });
  } catch (error) {
    const code = error instanceof Error && error.message.startsWith("ai-") ? error.message : "ai-unavailable";
    return Response.json({ configured: true, error: code }, { status: 502 });
  }
}
