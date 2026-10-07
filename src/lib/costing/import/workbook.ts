import ExcelJS from "exceljs";
import type { Product } from "@/types";
import { getLocalizedDescription, getProductDisplayName } from "@/lib/i18n/localized-content";
import type { Locale } from "@/lib/i18n/types";

export async function buildCostingTemplate(
  kind: "blank" | "menu",
  products: Product[] = [],
  locale: Locale = "ar"
): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Mishkat Cafe";

  const ingredients = workbook.addWorksheet("Ingredients");
  ingredients.columns = [
    { header: "ingredient_name", key: "ingredient_name", width: 28 },
    { header: "category", key: "category", width: 16 },
    { header: "supplier", key: "supplier", width: 18 },
    { header: "purchase_price", key: "purchase_price", width: 16 },
    { header: "package_quantity", key: "package_quantity", width: 18 },
    { header: "purchase_unit", key: "purchase_unit", width: 16 },
  ];
  if (kind === "blank") {
    ingredients.addRow({
      ingredient_name: "دجاج كريسبي",
      category: "لحوم",
      supplier: "Supplier A",
      purchase_price: 60,
      package_quantity: 2,
      purchase_unit: "kg",
    });
  }

  const recipes = workbook.addWorksheet("Recipes");
  recipes.columns = [
    { header: "product_id", key: "product_id", width: 24 },
    { header: "product_name", key: "product_name", width: 28 },
    { header: "menu_description", key: "menu_description", width: 40 },
    { header: "ingredient_name", key: "ingredient_name", width: 24 },
    { header: "quantity", key: "quantity", width: 12 },
    { header: "unit", key: "unit", width: 10 },
  ];

  if (kind === "menu") {
    for (const product of products.filter((item) => item.active && !item.isTestProduct)) {
      recipes.addRow({
        product_id: product.id,
        product_name: getProductDisplayName(product, locale),
        menu_description: getLocalizedDescription(product, locale),
        ingredient_name: "",
        quantity: "",
        unit: "",
      });
    }
  } else {
    recipes.addRow({
      product_id: "",
      product_name: "برجر كريسبي",
      menu_description: "",
      ingredient_name: "دجاج كريسبي",
      quantity: 180,
      unit: "g",
    });
  }

  [ingredients, recipes].forEach((sheet) => {
    sheet.getRow(1).font = { bold: true };
    sheet.views = [{ state: "frozen", ySplit: 1 }];
  });

  const buffer = await workbook.xlsx.writeBuffer();
  return new Uint8Array(buffer as ArrayBuffer);
}

export function costingWorkbookFilename(kind: "blank" | "menu"): string {
  return kind === "menu" ? "mishkat-menu-recipes.xlsx" : "mishkat-costing-template.xlsx";
}
