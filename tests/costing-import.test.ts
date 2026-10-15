import { describe, expect, it } from "vitest";
import { buildFileDraft, buildMenuDraft, isRecipeBulkReady, recipeDraftStatus } from "@/lib/costing/import/build-draft";
import { matchIngredient, matchProduct } from "@/lib/costing/import/match";
import { normalizeImportUnit } from "@/lib/costing/import/normalize-unit";
import { parseImportBuffer, validateImportFile } from "@/lib/costing/import/parse-workbook";
import { buildCostingTemplate } from "@/lib/costing/import/workbook";
import { suggestIngredientsFromMenuText } from "@/lib/costing/import/suggest";
import type { CostingIngredient, DishRecipe } from "@/lib/costing/types";
import type { Product } from "@/types";

const potato: CostingIngredient = {
  id: "ing-potato",
  name: "بطاطا",
  purchasePrice: 85,
  purchaseQuantity: 10,
  purchaseUnit: "kg",
  baseUnit: "g",
  costPerBaseUnit: 0.0085,
  active: true,
  createdAt: "",
  updatedAt: "",
};

const mozzarella: CostingIngredient = {
  id: "ing-moz",
  name: "موزاريلا",
  purchasePrice: 45,
  purchaseQuantity: 2,
  purchaseUnit: "kg",
  baseUnit: "g",
  costPerBaseUnit: 0.0225,
  active: true,
  createdAt: "",
  updatedAt: "",
};

const burger: Product = {
  id: "prod-burger",
  name_he: "ברגר קריספי",
  name_ar: "برجر كريسبي",
  name_en: "Crispy burger",
  description_he: "",
  description_ar: "برجر كريسبي مع خس، طماطم، مخلل وصوص",
  description_en: "Crispy burger with lettuce, tomato, pickles and sauce",
  categoryId: "cat",
  price: 42,
  cost: 0,
  profit: 0,
  businessType: "food",
  image: "",
  isPopular: false,
  isNew: false,
  available: true,
  active: true,
  sortOrder: 1,
  createdAt: "",
  updatedAt: "",
};

describe("import unit normalization", () => {
  it("maps common aliases without converting unit to weight", () => {
    expect(normalizeImportUnit("كغم")).toBe("kg");
    expect(normalizeImportUnit("غرام")).toBe("g");
    expect(normalizeImportUnit("لتر")).toBe("liter");
    expect(normalizeImportUnit("مل")).toBe("ml");
    expect(normalizeImportUnit("قطعة")).toBe("unit");
    expect(normalizeImportUnit("pcs")).toBe("unit");
    expect(normalizeImportUnit("banana")).toBeNull();
  });
});

describe("ingredient matching", () => {
  it("matches exact and suggested names without auto-creating", () => {
    expect(matchIngredient("بطاطا", [potato]).kind).toBe("exact");
    expect(matchIngredient("جبنة موزاريلا", [mozzarella]).kind).toBe("suggest");
    expect(matchIngredient("جبنة موزاريلا", [mozzarella]).item?.id).toBe("ing-moz");
    expect(matchIngredient("صوص ترافل", [potato, mozzarella]).kind).toBe("new");
  });
});

describe("menu suggestions", () => {
  it("proposes ingredients from description without inventing quantities", () => {
    const names = suggestIngredientsFromMenuText(burger.description_ar);
    expect(names.some((name) => /خس/.test(name))).toBe(true);
    expect(names.some((name) => /صوص/.test(name))).toBe(true);
    const draft = buildMenuDraft({
      products: [burger],
      ingredients: [potato],
      recipes: [],
      locale: "ar",
    });
    expect(draft.recipes[0].lines.every((line) => line.quantity == null)).toBe(true);
    expect(draft.recipes[0].lines.every((line) => line.suggested)).toBe(true);
    expect(["missing-qty", "unknown-ingredient"]).toContain(recipeDraftStatus(draft.recipes[0]));
    expect(isRecipeBulkReady(draft.recipes[0])).toBe(false);
  });

  it("does not treat every marketing word as an ingredient", () => {
    const names = suggestIngredientsFromMenuText("كرواسون مقرمش يقدم مع صوص ناعم والفواكه الموسمية");
    expect(names.some((name) => name.includes("كرواسون") || name.includes("صوص") || name.includes("فواكه"))).toBe(true);
    expect(names).not.toContain("مقرمش");
    expect(names).not.toContain("يقدم");
  });
});

describe("existing recipe protection", () => {
  it("marks an existing recipe as a conflict until admin chooses", () => {
    const existing: DishRecipe = {
      id: "rec-1",
      productId: "prod-burger",
      ingredients: [{ ingredientId: "ing-potato", quantity: 180, unit: "g" }],
      createdAt: "",
      updatedAt: "",
    };
    const draft = buildFileDraft({
      parsed: {
        fileName: "recipes.csv",
        ingredients: [],
        parseErrors: [],
        recipes: [
          {
            row: 2,
            productName: "برجر كريسبي",
            productId: "prod-burger",
            menuDescription: "",
            ingredientName: "بطاطا",
            quantity: 200,
            unitRaw: "g",
            unit: "g",
            errors: [],
          },
        ],
      },
      products: [burger],
      ingredients: [potato],
      recipes: [existing],
      locale: "ar",
    });
    expect(draft.recipes[0].existingRecipeId).toBe("rec-1");
    expect(draft.recipes[0].resolve).toBeNull();
    expect(recipeDraftStatus(draft.recipes[0])).toBe("conflict");
    expect(draft.recipes[0].lines.some((line) => line.change === "CHANGED")).toBe(true);
    expect(isRecipeBulkReady(draft.recipes[0])).toBe(false);
  });
});

describe("file validation and csv parse", () => {
  it("rejects macros and oversized files", () => {
    expect(validateImportFile("book.xlsm", 100)).toBe("macros-not-allowed");
    expect(validateImportFile("book.xlsx", 3 * 1024 * 1024)).toBe("file-too-large");
    expect(validateImportFile("book.xlsx", 100)).toBeNull();
  });

  it("parses a CSV ingredient sheet", async () => {
    const csv = "ingredient_name,category,supplier,purchase_price,package_quantity,purchase_unit\nبطاطا,مجمدات,B,92,10,kg\n";
    const parsed = await parseImportBuffer(Buffer.from(csv), "ingredients.csv");
    expect(parsed.ingredients).toHaveLength(1);
    expect(parsed.ingredients[0].name).toBe("بطاطا");
    expect(parsed.ingredients[0].purchasePrice).toBe(92);
    expect(parsed.ingredients[0].purchaseUnit).toBe("kg");
  });
});

describe("product matching", () => {
  it("prefers product id and flags ambiguous names", () => {
    expect(matchProduct("prod-burger", "", [burger]).item?.id).toBe("prod-burger");
    const clone = { ...burger, id: "prod-2", name_en: "Crispy burger" };
    expect(matchProduct("", "Crispy burger", [burger, clone]).alternatives).toHaveLength(2);
  });

  it("skips missing catalog names and does not treat two empty names as a match", () => {
    const broken = {
      ...burger,
      id: "broken",
      name_he: undefined as unknown as string,
      name_ar: undefined as unknown as string,
      name_en: "",
    };
    expect(matchProduct("", "ברגר", [broken]).kind).toBe("none");
    expect(matchProduct("", undefined, [broken, burger]).kind).toBe("none");
    expect(matchProduct("", "", [burger]).item).toBeUndefined();
    expect(matchProduct("", "Crispy burger", [broken, burger]).item?.id).toBe("prod-burger");
    expect(
      matchProduct("", "חומוס", [{ id: "camel", nameHe: "חומוס", nameAr: "حمص", nameEn: "Hummus" } as unknown as typeof burger]).item?.id
    ).toBe("camel");
    expect(
      matchProduct("", "כינוי", [
        { ...burger, id: "aliased", aliases: [undefined, "", "כינוי"] } as unknown as typeof burger,
      ]).item?.id
    ).toBe("aliased");
    expect(matchProduct("", "", [{ ...burger, aliases: ["", undefined] } as unknown as typeof burger]).kind).toBe("none");
  });
});

describe("workbook and price protection", () => {
  it("builds a two-sheet template that parses back", async () => {
    const bytes = await buildCostingTemplate("blank");
    const parsed = await parseImportBuffer(Buffer.from(bytes), "mishkat-costing-template.xlsx");
    expect(parsed.ingredients.length).toBeGreaterThan(0);
    expect(parsed.recipes.length).toBeGreaterThan(0);
    expect(parsed.ingredients[0].name).toBe("دجاج كريسبي");
  });

  it("exports current products without inventing recipe quantities", async () => {
    const bytes = await buildCostingTemplate("menu", [burger], "ar");
    const parsed = await parseImportBuffer(Buffer.from(bytes), "mishkat-menu-recipes.xlsx");
    expect(parsed.recipes[0].productId).toBe("prod-burger");
    expect(parsed.recipes[0].ingredientName).toBe("");
    expect(parsed.recipes[0].quantity).toBeNull();
  });

  it("flags price changes without auto-approving them", () => {
    const draft = buildFileDraft({
      parsed: {
        fileName: "prices.xlsx",
        parseErrors: [],
        recipes: [],
        ingredients: [
          {
            row: 2,
            name: "بطاطا",
            category: "مجمدات",
            supplier: "B",
            purchasePrice: 92,
            packageQuantity: 10,
            purchaseUnitRaw: "kg",
            purchaseUnit: "kg",
            errors: [],
          },
        ],
      },
      products: [burger],
      ingredients: [potato],
      recipes: [],
      locale: "ar",
    });
    expect(draft.ingredients[0].priceChanged).toBe(true);
    expect(draft.ingredients[0].priceApproved).toBe(false);
    expect(draft.summary.priceUpdates).toBe(1);
  });

  it("keeps paid extras out of the base recipe draft", () => {
    const extras = new Map([["prod-burger", [{ name: "جبنة إضافية", priceDelta: 3 }]]]);
    const draft = buildMenuDraft({
      products: [burger],
      ingredients: [potato],
      recipes: [],
      extrasByProduct: extras,
      locale: "ar",
    });
    expect(draft.recipes[0].extras).toEqual([{ name: "جبنة إضافية", priceDelta: 3 }]);
    expect(draft.recipes[0].lines.some((line) => line.ingredientName.includes("جبنة إضافية"))).toBe(false);
  });
});
