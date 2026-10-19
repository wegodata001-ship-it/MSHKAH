"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Calculator,
  Copy,
  Download,
  Loader2,
  Pencil,
  Plus,
  Search,
  Shield,
  Trash2,
  Upload,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/components/providers/auth-provider";
import { useAuthFetch } from "@/lib/auth/auth-fetch";
import { useLocale, useT } from "@/components/providers/locale-provider";
import { AdminPageHeader } from "@/features/admin/components/admin-page-header";
import { AdminKpiCard } from "@/features/admin/components/admin-kpi-card";
import { AdminEmptyState } from "@/features/admin/components/admin-empty-state";
import { AdminCard } from "@/features/admin/components/admin-card";
import { AdminToastStack, createToast, type AdminToast } from "@/features/admin/components/admin-toast";
import { adminCard } from "@/features/admin/components/admin-styles";
import { useProducts, useAllCategories } from "@/hooks/useProducts";
import { canViewCosting } from "@/lib/auth/roles";
import { formatIls } from "@/lib/costing/money";
import { lineRecipeCost, liveCostPreview } from "@/lib/costing/units";
import {
  attentionRows,
  buildDishRows,
  categoryName,
  dashboardStats,
  extraRows,
  fullCostForRow,
  type DishCostRow,
} from "@/lib/costing/model";
import type {
  CostingIngredient,
  CostingSettings,
  CostingSnapshot,
  DishRecipe,
  IngredientPriceHistory,
  PriceRoundMode,
} from "@/lib/costing/types";
import { DEFAULT_COSTING_SETTINGS } from "@/lib/costing/types";
import {
  createIngredient,
  deactivateIngredient,
  deleteIngredient,
  saveCostingSettings,
  saveDishRecipe,
  subscribeToCostingSettings,
  subscribeToCostingSnapshots,
  subscribeToDishRecipes,
  subscribeToIngredientPriceHistory,
  subscribeToIngredients,
  updateIngredient,
  writeIngredientImpactSnapshots,
} from "@/services/costingService";
import {
  getProductModifierGroups,
  subscribeToAllProductModifierGroups,
  subscribeToModifierOptions,
} from "@/services/modifierService";
import { getLocalizedDescription, getLocalizedName, getProductDisplayName } from "@/lib/i18n/localized-content";
import type { Product } from "@/types";
import { formatPrice } from "@/lib/utils";
import { cn } from "@/lib/utils";
import type { ModifierOption, ProductModifierGroup } from "@/types/modifiers";
import { StatusDot, perUnitKey, unitLabelKey } from "./costing-shared";
import {
  IngredientFormModal,
  emptyIngredientForm,
  formFromIngredient,
  type IngredientFormValue,
} from "./ingredient-form";
import { RecipeEditorModal } from "./recipe-editor";
import { CostingImportWizard, downloadCostingWorkbook } from "./import-wizard";
import { InventorySection, PosSection, PurchaseSection } from "@/features/admin/inventory/inventory-hub";
import { BreakEvenPanel } from "@/features/admin/breakeven/breakeven-panel";
import { CashFlowPanel } from "@/features/admin/cashflow/cashflow-panel";
import { productContribution } from "@/lib/breakeven/compute";
import {
  subscribeToInventoryMovements,
  subscribeToPosFinanceEntries,
  subscribeToPosImports,
  subscribeToPosProductMaps,
  subscribeToPosZReports,
  subscribeToPurchaseInvoices,
  subscribeToPurchasePriceRecords,
  subscribeToSupplierItemMaps,
  subscribeToSupplierOffers,
  subscribeToSuppliers,
  latestUnitCost,
} from "@/services/inventoryService";
import type {
  InventoryMovement,
  PosFinanceEntry,
  PosImport,
  PosProductMap,
  PosZReport,
  PurchaseInvoice,
  PurchasePriceRecord,
  Supplier,
  SupplierItemMap,
  SupplierOffer,
} from "@/lib/inventory/types";
import { IssueIngredientForm } from "@/features/admin/inventory/issue-ingredient-form";
import { currentStockBase } from "@/lib/inventory/stock";
import { stockInDisplayUnit } from "@/lib/inventory/issue";

type Hub = "finance" | "inventory" | "suppliers" | "compare" | "costing" | "pos";
type Tab = "dashboard" | "recipes" | "ingredients" | "history" | "products" | "ledger" | "alerts" | "invoices" | "breakeven" | "cashflow" | "suppliers" | "compare" | "pos-excel" | "pos-z" | "pos-history";
type DishFilter = "all" | "good" | "watch" | "low" | "none";

export function CostingAdmin() {
  const t = useT();
  const { locale } = useLocale();
  const { user, loading: authLoading } = useAuth();
  const { products, loading: productsLoading } = useProducts(undefined, { admin: true });
  const { categories } = useAllCategories();

  const [hub, setHub] = useState<Hub>("finance");
  const [tab, setTab] = useState<Tab>("invoices");
  const [focusInvoiceId, setFocusInvoiceId] = useState<string | null>(null);
  const [focusInvoiceLineId, setFocusInvoiceLineId] = useState<string | null>(null);
  const [startInvoiceIntake, setStartInvoiceIntake] = useState(false);
  const [ingredients, setIngredients] = useState<CostingIngredient[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [offers, setOffers] = useState<SupplierOffer[]>([]);
  const [movements, setMovements] = useState<InventoryMovement[]>([]);
  const [priceRecords, setPriceRecords] = useState<PurchasePriceRecord[]>([]);
  const [invoices, setInvoices] = useState<PurchaseInvoice[]>([]);
  const [posImports, setPosImports] = useState<PosImport[]>([]);
  const [posZReports, setPosZReports] = useState<PosZReport[]>([]);
  const [posFinanceEntries, setPosFinanceEntries] = useState<PosFinanceEntry[]>([]);
  const [posMaps, setPosMaps] = useState<PosProductMap[]>([]);
  const [itemMaps, setItemMaps] = useState<SupplierItemMap[]>([]);
  const [recipes, setRecipes] = useState<DishRecipe[]>([]);
  const [history, setHistory] = useState<IngredientPriceHistory[]>([]);
  const [snapshots, setSnapshots] = useState<CostingSnapshot[]>([]);
  const [settings, setSettings] = useState<CostingSettings>(DEFAULT_COSTING_SETTINGS);
  const [options, setOptions] = useState<ModifierOption[]>([]);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState<DishFilter>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [toasts, setToasts] = useState<AdminToast[]>([]);
  const [ingredientForm, setIngredientForm] = useState<CostingIngredient | "new" | null>(null);
  const [ingredientError, setIngredientError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<CostingIngredient | null>(null);
  const [inUseCount, setInUseCount] = useState(0);
  const [recipeProductId, setRecipeProductId] = useState<string | null>(null);
  const [linkedOptions, setLinkedOptions] = useState<ModifierOption[]>([]);
  const [settingsDraft, setSettingsDraft] = useState(settings);
  const [importOpen, setImportOpen] = useState(false);
  const [productGroups, setProductGroups] = useState<ProductModifierGroup[]>([]);
  const authFetch = useAuthFetch();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const hubParam = params.get("hub");
    const tabParam = params.get("tab");
    if (hubParam === "finance") {
      setHub("finance");
      setTab(tabParam === "breakeven" ? "breakeven" : "invoices");
    }
  }, []);

  const toast = (message: string, variant: AdminToast["variant"] = "success") =>
    setToasts((current) => [...current, createToast(message, variant)]);

  useEffect(() => {
    const unsubs = [
      subscribeToIngredients(setIngredients),
      subscribeToDishRecipes(setRecipes),
      subscribeToIngredientPriceHistory(setHistory),
      subscribeToCostingSettings((value) => {
        setSettings(value);
        setSettingsDraft(value);
      }),
      subscribeToCostingSnapshots(setSnapshots),
      subscribeToModifierOptions(undefined, setOptions, () => undefined),
      subscribeToAllProductModifierGroups(setProductGroups, () => undefined),
      subscribeToSuppliers(setSuppliers),
      subscribeToSupplierOffers(setOffers),
      subscribeToInventoryMovements(setMovements),
      subscribeToPurchasePriceRecords(setPriceRecords),
      subscribeToPurchaseInvoices(setInvoices),
      subscribeToPosImports(setPosImports),
      subscribeToPosZReports(setPosZReports),
      subscribeToPosFinanceEntries(setPosFinanceEntries),
      subscribeToPosProductMaps(setPosMaps),
      subscribeToSupplierItemMaps(setItemMaps),
    ];
    return () => unsubs.forEach((fn) => fn());
  }, []);

  const costingIngredients = useMemo(
    () =>
      ingredients.map((item) => {
        const costs = latestUnitCost(item, priceRecords, settings.costBasis ?? "latest");
        const unit = settings.foodCostVatMode === "including" ? costs.including : costs.before;
        return { ...item, costPerBaseUnit: unit || item.costPerBaseUnit };
      }),
    [ingredients, priceRecords, settings.costBasis, settings.foodCostVatMode]
  );

  const rows = useMemo(
    () => buildDishRows(products, recipes, costingIngredients, settings),
    [products, recipes, costingIngredients, settings]
  );

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((row) => {
      const name = getProductDisplayName(row.product, locale).toLowerCase();
      if (q && !name.includes(q)) return false;
      if (categoryFilter !== "all" && row.product.categoryId !== categoryFilter) return false;
      if (statusFilter !== "all" && row.status !== statusFilter) return false;
      return true;
    });
  }, [rows, search, categoryFilter, statusFilter, locale]);

  const selected = filteredRows.find((row) => row.product.id === selectedId) ?? filteredRows[0];
  const stats = dashboardStats(rows);
  const attention = attentionRows(rows);
  const extrasByProduct = useMemo(() => {
    const map = new Map<string, { name: string; priceDelta: number }[]>();
    const paid = options.filter((option) => option.active && option.priceDelta !== 0);
    for (const link of productGroups) {
      if (!link.active) continue;
      const extras = paid
        .filter((option) => option.groupId === link.groupId)
        .map((option) => ({ name: getLocalizedName(option, locale), priceDelta: option.priceDelta }));
      if (!extras.length) continue;
      map.set(link.productId, [...(map.get(link.productId) ?? []), ...extras]);
    }
    return map;
  }, [options, productGroups, locale]);

  const downloadWorkbook = async (kind: "blank" | "menu") => {
    try {
      await downloadCostingWorkbook(authFetch, kind, locale);
    } catch {
      toast(t("admin.costing.import.error.saveFailed"), "error");
    }
  };

  useEffect(() => {
    if (selected && selected.product.id !== selectedId) setSelectedId(selected.product.id);
  }, [selected, selectedId]);

  useEffect(() => {
    const productId = recipeProductId ?? selectedId;
    if (!productId) {
      setLinkedOptions([]);
      return;
    }
    let cancelled = false;
    void getProductModifierGroups(productId).then((links) => {
      const groupIds = new Set(links.map((link) => link.groupId));
      if (!cancelled) {
        setLinkedOptions(options.filter((option) => groupIds.has(option.groupId) && option.active));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [recipeProductId, selectedId, options]);

  const saveIngredient = async (value: IngredientFormValue): Promise<boolean> => {
    if (saving) return false;
    setSaving(true);
    setIngredientError(null);
    const payload = {
      name: value.name,
      category: value.category,
      purchasePrice: Number(value.purchasePrice) || 0,
      purchaseQuantity: Number(value.purchaseQuantity) || 1,
      purchaseUnit: value.purchaseUnit,
      notes: value.notes,
      minStock: value.minStock ? Number(value.minStock) : undefined,
      barcode: value.barcode,
    };
    try {
      if (ingredientForm && ingredientForm !== "new") {
        const result = await updateIngredient(ingredientForm.id, payload, user?.email);
        if (!result.success) {
          const message =
            result.code === "PERMISSION_DENIED"
              ? t("admin.costing.permissionError")
              : t("admin.costing.saveFailed");
          console.error("[costing] update ingredient failed", result.error, result.code);
          setIngredientError(message);
          toast(message, "error");
          return false;
        }
        await writeIngredientImpactSnapshots({
          ingredientId: ingredientForm.id,
          recipes,
          ingredients: costingIngredients.map((item) =>
            item.id === ingredientForm.id ? { ...item, ...payload, costPerBaseUnit: result.data.ingredient.costPerBaseUnit } : item
          ),
          sellingPriceByProduct: new Map(products.map((product) => [product.id, product.price])),
        });
        toast(t("admin.costing.updatedPurchase"));
        if (result.data.affectedRecipeCount > 0) {
          toast(t("admin.costing.recalculated"));
        }
        return true;
      }
      const result = await createIngredient({ ...payload, originKind: "manual" });
      if (!result.success) {
        const message =
          result.code === "PERMISSION_DENIED"
            ? t("admin.costing.permissionError")
            : t("admin.costing.saveFailed");
        console.error("[costing] create ingredient failed", result.error, result.code);
        setIngredientError(message);
        toast(message, "error");
        return false;
      }
      toast(t("admin.costing.addedSuccess"));
      setIngredientForm(result.data);
      return true;
    } finally {
      setSaving(false);
    }
  };

  const tryDeleteIngredient = async (item: CostingIngredient) => {
    const result = await deleteIngredient(item.id);
    if (!result.success && result.code === "IN_USE") {
      const count = Number(result.error.replace("IN_USE:", "")) || 0;
      setDeleteTarget(item);
      setInUseCount(count);
      return;
    }
    if (!result.success) {
      toast(result.error, "error");
      return;
    }
    toast(t("admin.costing.deactivated").replace("הושבת", "נמחק"));
  };

  const saveRecipe = async (input: {
    variantId?: string;
    ingredients: DishRecipe["ingredients"];
    overheadSettings: NonNullable<DishRecipe["overheadSettings"]>;
    targetFoodCostPercent?: number;
  }) => {
    if (!recipeProductId || saving) return;
    setSaving(true);
    const existing = recipes.find(
      (recipe) =>
        recipe.productId === recipeProductId &&
        (recipe.variantId ?? "") === (input.variantId ?? "")
    );
    const product = products.find((item) => item.id === recipeProductId);
    const result = await saveDishRecipe(
      {
        id: existing?.id,
        productId: recipeProductId,
        ...input,
      },
      { sellingPrice: product?.price, ingredients }
    );
    setSaving(false);
    if (!result.success) {
      toast(result.error, "error");
      return;
    }
    toast(t("admin.costing.savedRecipe"));
    setRecipeProductId(null);
  };

  const persistSettings = async () => {
    const result = await saveCostingSettings(settingsDraft);
    if (result.success) toast(t("admin.costing.settingsSaved"));
    else toast(result.error, "error");
  };

  if (authLoading) {
    return (
      <div className="grid min-h-64 place-items-center">
        <Loader2 className="h-7 w-7 animate-spin text-turquoise" />
      </div>
    );
  }

  if (!user || !canViewCosting(user.role)) {
    return (
      <div className="py-12 text-center">
        <Shield className="mx-auto h-12 w-12 text-coffee/30" />
        <p className="mt-4 text-coffee/60">{t("admin.costing.noAccess")}</p>
      </div>
    );
  }

  const hubs: { id: Hub; label: string; tabs: { id: Tab; label: string }[] }[] = [
    {
      id: "finance",
      label: t("admin.finance.hub"),
      tabs: [
        { id: "invoices", label: t("admin.finance.purchases") },
        { id: "breakeven", label: t("admin.breakeven.tab") },
        { id: "cashflow", label: t("admin.cashflow.tab") },
      ],
    },
    {
      id: "inventory",
      label: t("admin.inventory.hub"),
      tabs: [
        { id: "products", label: t("admin.inventory.tab.products") },
        { id: "ledger", label: t("admin.inventory.tab.ledger") },
        { id: "alerts", label: t("admin.inventory.tab.alerts") },
      ],
    },
    {
      id: "suppliers",
      label: t("admin.inventory.tab.suppliers"),
      tabs: [{ id: "suppliers", label: t("admin.inventory.tab.suppliers") }],
    },
    {
      id: "compare",
      label: t("admin.inventory.tab.compare"),
      tabs: [{ id: "compare", label: t("admin.inventory.tab.compare") }],
    },
    {
      id: "costing",
      label: t("admin.costing.dishes"),
      tabs: [
        { id: "dashboard", label: t("admin.costing.tab.dashboard") },
        { id: "recipes", label: t("admin.costing.tab.recipes") },
        { id: "ingredients", label: t("admin.costing.tab.ingredients") },
        { id: "history", label: t("admin.costing.tab.history") },
      ],
    },
    {
      id: "pos",
      label: t("admin.inventory.posHub"),
      tabs: [
        { id: "pos-excel", label: t("admin.pos.excelTab") },
        { id: "pos-z", label: t("admin.pos.zTab") },
        { id: "pos-history", label: t("admin.pos.historyTab") },
      ],
    },
  ];

  const activeHub = hubs.find((item) => item.id === hub) ?? hubs[0];

  const hubProps = {
    ingredients,
    suppliers,
    offers,
    movements,
    records: priceRecords,
    invoices,
    posImports,
    zReports: posZReports,
    financeEntries: posFinanceEntries,
    maps: posMaps,
    recipes,
    products,
    itemMaps,
    locale,
    settingsVatRate: settings.vatRate ?? 0.18,
    onToast: toast,
    onOpenInvoice: (invoiceId: string, lineId?: string) => {
      setFocusInvoiceId(invoiceId);
      setFocusInvoiceLineId(lineId ?? null);
      setHub("finance");
      setTab("invoices");
    },
    onShowLedger: () => {
      setHub("inventory");
      setTab("ledger");
    },
    onAddProduct: () => {
      setIngredientError(null);
      setIngredientForm("new");
    },
    onEditProduct: (item: CostingIngredient) => {
      setIngredientError(null);
      setIngredientForm(item);
    },
    onAddDocument: () => {
      setStartInvoiceIntake(true);
      setHub("finance");
      setTab("invoices");
    },
    startInvoiceIntake,
    onInvoiceIntakeHandled: () => setStartInvoiceIntake(false),
  };

  return (
    <div className="space-y-6">
      <AdminPageHeader title={t("admin.inventory.title")} subtitle={t("admin.inventory.subtitle")} />

      <div className="flex flex-wrap gap-2">
        {hubs.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => {
              setHub(item.id);
              setTab(item.tabs[0]!.id);
            }}
            className={cn(
              "rounded-full px-4 py-2 text-sm font-medium transition-colors",
              hub === item.id ? "bg-coffee text-warm-white" : "bg-beige/50 text-coffee/70 hover:bg-beige"
            )}
          >
            {item.label}
          </button>
        ))}
      </div>
      {activeHub.tabs.length > 1 && (
        <div className="flex flex-wrap gap-2">
          {activeHub.tabs.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setTab(item.id)}
              className={cn(
                "rounded-full px-3 py-1.5 text-sm font-medium transition-colors",
                tab === item.id ? "bg-turquoise text-white" : "bg-beige/40 text-coffee/70 hover:bg-beige"
              )}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}

      {(tab === "products" || tab === "ledger" || tab === "alerts") && (
        <InventorySection {...hubProps} pane={tab === "products" ? "products" : tab === "ledger" ? "ledger" : "alerts"} />
      )}

      {(tab === "invoices" || tab === "suppliers" || tab === "compare") && (
        <PurchaseSection
          {...hubProps}
          pane={tab === "invoices" ? "invoices" : tab === "suppliers" ? "suppliers" : "compare"}
          focusInvoiceId={focusInvoiceId}
          focusInvoiceLineId={focusInvoiceLineId}
          onFocusInvoiceHandled={() => {
            setFocusInvoiceId(null);
            setFocusInvoiceLineId(null);
          }}
          onViewInventory={() => {
            setHub("inventory");
            setTab("products");
          }}
        />
      )}

      {tab === "breakeven" && (
        <BreakEvenPanel
          recipes={recipes}
          ingredients={costingIngredients}
          products={products}
          vatRate={settings.vatRate ?? 0.18}
          costingVatMode={settings.foodCostVatMode ?? "before"}
          zReports={posZReports}
          financeEntries={posFinanceEntries}
          posImports={posImports}
        />
      )}

      {tab === "cashflow" && (
        <CashFlowPanel
          invoices={invoices}
          zReports={posZReports}
          vatRate={settings.vatRate ?? 0.18}
          onToast={toast}
        />
      )}

      {(tab === "pos-excel" || tab === "pos-z" || tab === "pos-history") && (
        <PosSection {...hubProps} pane={tab === "pos-excel" ? "excel" : tab === "pos-z" ? "z" : "history"} />
      )}

      {tab === "dashboard" && (
        <DashboardTab
          rows={filteredRows}
          stats={stats}
          attention={attention}
          selected={selected}
          search={search}
          categoryFilter={categoryFilter}
          statusFilter={statusFilter}
          categories={categories}
          locale={locale}
          settingsDraft={settingsDraft}
          loading={productsLoading}
          onSearch={setSearch}
          onCategory={setCategoryFilter}
          onStatus={setStatusFilter}
          onSelect={setSelectedId}
          onSettings={setSettingsDraft}
          onSaveSettings={persistSettings}
          ingredients={costingIngredients}
          extras={selected ? extraRows(linkedOptions.filter((option) => option.priceDelta !== 0)) : []}
          onBuildRecipe={(productId) => setRecipeProductId(productId)}
        />
      )}

      {tab === "recipes" && (
        <RecipesTab
          rows={filteredRows}
          search={search}
          locale={locale}
          categories={categories}
          loading={productsLoading}
          onSearch={setSearch}
          onOpen={(productId) => setRecipeProductId(productId)}
        />
      )}

      {tab === "ingredients" && (
        <IngredientsTab
          ingredients={ingredients}
          movements={movements}
          recipes={recipes}
          products={products}
          onToast={toast}
          onAdd={() => {
            setIngredientError(null);
            setIngredientForm("new");
          }}
          onImport={() => {
            setImportOpen(true);
          }}
          onDownloadTemplate={() => void downloadWorkbook("blank")}
          onDownloadMenu={() => void downloadWorkbook("menu")}
          onEdit={(item) => {
            setIngredientError(null);
            setIngredientForm(item);
          }}
          onDelete={(item) => void tryDeleteIngredient(item)}
        />
      )}

      {tab === "history" && (
        <HistoryTab history={history} ingredients={ingredients} snapshots={snapshots} products={products} locale={locale} />
      )}

      {ingredientForm && (
        <IngredientFormModal
          key={ingredientForm === "new" ? "new" : ingredientForm.id}
          open
          mode={ingredientForm === "new" ? "create" : "edit"}
          title={ingredientForm === "new" ? t("admin.costing.addIngredient") : t("admin.costing.editIngredient")}
          initial={ingredientForm === "new" ? emptyIngredientForm() : formFromIngredient(ingredientForm)}
          saving={saving}
          formError={ingredientError}
          product={ingredientForm === "new" ? null : ingredientForm}
          suppliers={suppliers}
          offers={offers}
          records={priceRecords}
          categories={[...new Set(ingredients.map((item) => item.category?.trim()).filter(Boolean) as string[])]}
          onToast={toast}
          onClose={() => {
            setIngredientForm(null);
            setIngredientError(null);
          }}
          onSave={saveIngredient}
        />
      )}

      {importOpen && (
        <CostingImportWizard
          open
          products={products}
          ingredients={ingredients}
          recipes={recipes}
          extrasByProduct={extrasByProduct}
          onClose={() => setImportOpen(false)}
          onToast={toast}
        />
      )}

      {recipeProductId && (
        <RecipeEditorModal
          key={recipeProductId}
          open
          productName={
            products.find((p) => p.id === recipeProductId)
              ? getProductDisplayName(products.find((p) => p.id === recipeProductId)!, locale)
              : ""
          }
          productDescription={
            products.find((p) => p.id === recipeProductId)
              ? [
                  getLocalizedDescription(products.find((p) => p.id === recipeProductId)!, "ar"),
                  getLocalizedDescription(products.find((p) => p.id === recipeProductId)!, "he"),
                  getLocalizedDescription(products.find((p) => p.id === recipeProductId)!, "en"),
                ]
                  .filter(Boolean)
                  .filter((value, index, all) => all.indexOf(value) === index)
                  .join("\n")
              : ""
          }
          recipe={recipes.find((recipe) => recipe.productId === recipeProductId && !recipe.variantId)}
          ingredients={costingIngredients}
          variants={linkedOptions}
          locale={locale}
          saving={saving}
          priceRecords={priceRecords}
          purchaseInvoices={invoices}
          suppliers={suppliers}
          vatBasis={settings.foodCostVatMode ?? "before"}
          onToast={toast}
          onClose={() => setRecipeProductId(null)}
          onSave={(input) => void saveRecipe(input)}
        />
      )}

      {deleteTarget && (
        <div className="fixed inset-0 z-[1000] grid place-items-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-2xl bg-warm-white p-6 shadow-elevated">
            <p className="font-semibold">{t("admin.costing.cannotDelete")}</p>
            <p className="mt-2 text-sm text-coffee/65">
              {t("admin.costing.inUse").replace("{count}", String(inUseCount))}
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="outline" onClick={() => setDeleteTarget(null)}>
                {t("common.close")}
              </Button>
              <Button
                variant="turquoise"
                onClick={async () => {
                  await deactivateIngredient(deleteTarget.id);
                  toast(t("admin.costing.deactivated"));
                  setDeleteTarget(null);
                }}
              >
                {t("admin.costing.deactivate")}
              </Button>
            </div>
          </div>
        </div>
      )}

      <AdminToastStack toasts={toasts} onDismiss={(id) => setToasts((current) => current.filter((item) => item.id !== id))} />
    </div>
  );
}

function DashboardTab({
  rows,
  stats,
  attention,
  selected,
  search,
  categoryFilter,
  statusFilter,
  categories,
  locale,
  settingsDraft,
  loading,
  onSearch,
  onCategory,
  onStatus,
  onSelect,
  onSettings,
  onSaveSettings,
  ingredients,
  extras,
  onBuildRecipe,
}: {
  rows: DishCostRow[];
  stats: ReturnType<typeof dashboardStats>;
  attention: DishCostRow[];
  selected?: DishCostRow;
  search: string;
  categoryFilter: string;
  statusFilter: DishFilter;
  categories: { id: string; name_he: string; name_ar: string; name_en: string }[];
  locale: "he" | "ar" | "en";
  settingsDraft: CostingSettings;
  loading: boolean;
  onSearch: (value: string) => void;
  onCategory: (value: string) => void;
  onStatus: (value: DishFilter) => void;
  onSelect: (id: string) => void;
  onSettings: (value: CostingSettings) => void;
  onSaveSettings: () => void;
  ingredients: CostingIngredient[];
  extras: ReturnType<typeof extraRows>;
  onBuildRecipe: (productId: string) => void;
}) {
  const t = useT();

  const full = selected ? fullCostForRow(selected) : null;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <AdminKpiCard label={t("admin.costing.kpiPriced")} value={stats.priced} icon={Calculator} index={0} />
        <AdminKpiCard
          label={t("admin.costing.kpiAvg")}
          value={stats.averageFoodCost == null ? "—" : `${stats.averageFoodCost}%`}
          icon={Calculator}
          index={1}
        />
        <AdminKpiCard label={t("admin.costing.kpiOver")} value={stats.overTarget} icon={Calculator} colorClass="text-amber-600" index={2} />
        <AdminKpiCard label={t("admin.costing.kpiMissing")} value={stats.missing} icon={Calculator} colorClass="text-coffee/60" index={3} />
      </div>

      <div className="flex flex-col gap-3 lg:flex-row">
        <div className="relative flex-1">
          <Search className="absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-coffee/40" />
          <Input className="ps-9" value={search} onChange={(e) => onSearch(e.target.value)} placeholder={t("admin.costing.searchDish")} />
        </div>
        <select
          className="h-10 rounded-xl border border-beige-dark/40 bg-warm-white px-3 text-sm"
          value={categoryFilter}
          onChange={(e) => onCategory(e.target.value)}
        >
          <option value="all">{t("admin.costing.category")}</option>
          {categories.map((category) => (
            <option key={category.id} value={category.id}>
              {categoryName(categories as never, category.id, locale)}
            </option>
          ))}
        </select>
        <select
          className="h-10 rounded-xl border border-beige-dark/40 bg-warm-white px-3 text-sm"
          value={statusFilter}
          onChange={(e) => onStatus(e.target.value as DishFilter)}
        >
          <option value="all">{t("admin.costing.filterAll")}</option>
          <option value="good">{t("admin.costing.filterGood")}</option>
          <option value="watch">{t("admin.costing.filterWatch")}</option>
          <option value="low">{t("admin.costing.filterLow")}</option>
          <option value="none">{t("admin.costing.filterNone")}</option>
        </select>
      </div>

      <div className="grid gap-5 xl:grid-cols-[20rem_1fr]">
        <div className="space-y-2">
          {loading && <Loader2 className="mx-auto h-6 w-6 animate-spin text-turquoise" />}
          {rows.map((row) => (
            <button
              key={row.product.id}
              type="button"
              onClick={() => onSelect(row.product.id)}
              className={cn(
                "flex w-full items-center gap-3 rounded-2xl border p-3 text-start transition-all",
                selected?.product.id === row.product.id
                  ? "border-turquoise bg-turquoise/5"
                  : "border-beige-dark/15 bg-warm-white hover:border-turquoise/30"
              )}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={row.product.image || "/logo-transparent.png"}
                alt=""
                className="h-14 w-14 rounded-xl object-cover"
              />
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{getProductDisplayName(row.product, locale)}</p>
                <p className="text-sm text-coffee/55">{formatPrice(row.sellingPrice)}</p>
              </div>
              <div className="text-end">
                <p className="text-sm font-semibold">
                  {row.foodCost == null ? "—" : `${row.foodCost.toFixed(1)}%`}
                </p>
                <StatusDot status={row.status} />
              </div>
            </button>
          ))}
        </div>

        {selected ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
              <Kpi label={t("admin.costing.sellingPrice")} value={formatIls(selected.sellingPrice)} />
              <Kpi label={t("admin.costing.ingredientCost")} value={selected.recipe ? formatIls(selected.ingredientCost) : "—"} />
              <Kpi label={t("admin.costing.grossProfit")} value={selected.grossProfit == null ? "—" : formatIls(selected.grossProfit)} />
              <Kpi label={t("admin.costing.foodCost")} value={selected.foodCost == null ? "—" : `${selected.foodCost.toFixed(1)}%`} />
              <Kpi label={t("admin.costing.grossMargin")} value={selected.grossMargin == null ? "—" : `${selected.grossMargin.toFixed(1)}%`} />
            </div>
            {selected.recipe && (() => {
              const cm = productContribution(
                selected.product.id,
                selected.product.name_he,
                selected.sellingPrice,
                [selected.recipe],
                ingredients
              );
              if (cm.costMissing) return null;
              return (
                <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                  <Kpi label={t("admin.breakeven.foodCost")} value={cm.foodCost == null ? "—" : formatIls(cm.foodCost)} />
                  <Kpi label={t("admin.breakeven.extraVariable")} value={cm.extraVariable == null ? "—" : formatIls(cm.extraVariable)} />
                  <Kpi label={t("admin.breakeven.contribution")} value={cm.contribution == null ? "—" : formatIls(cm.contribution)} />
                  <Kpi label={t("admin.breakeven.cmRatio")} value={cm.contributionRatio == null ? "—" : `${(cm.contributionRatio * 100).toFixed(1)}%`} />
                </div>
              );
            })()}

            {!selected.recipe ? (
              <AdminEmptyState
                icon={Calculator}
                title={t("admin.costing.emptyRecipe")}
                action={
                  <Button variant="turquoise" onClick={() => onBuildRecipe(selected.product.id)}>
                    {t("admin.costing.buildRecipe")}
                  </Button>
                }
              />
            ) : (
              <>
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" onClick={() => onBuildRecipe(selected.product.id)}>
                    <Pencil className="h-4 w-4" /> {t("admin.costing.editRecipe")}
                  </Button>
                  <Button variant="outline" onClick={() => onBuildRecipe(selected.product.id)}>
                    <Copy className="h-4 w-4" /> {t("admin.costing.duplicateRecipe")}
                  </Button>
                </div>
                <RecipeLines row={selected} ingredients={ingredients} />
                {extras.length > 0 && (
                  <AdminCard title={t("admin.costing.extras")}>
                    <div className="space-y-2 text-sm">
                      {extras.map((item) => (
                        <div key={item.option.id} className="flex flex-wrap justify-between gap-2 rounded-xl bg-beige/30 px-3 py-2">
                          <span>{getLocalizedName(item.option, locale)}</span>
                          <span>
                            {t("admin.costing.extraPrice")} {formatIls(item.price)} · {t("admin.costing.extraCost")} {formatIls(item.cost)} · {t("admin.costing.extraProfit")} {formatIls(item.profit)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </AdminCard>
                )}
                {full && (
                  <AdminCard title={t("admin.costing.fullCost")}>
                    <div className="space-y-1 text-sm">
                      <Line label={t("admin.costing.ingredientCost")} value={formatIls(full.ingredientCost)} />
                      {full.extras.map((extra) => (
                        <Line key={extra.name} label={extraLabel(t, extra.name)} value={formatIls(extra.amount)} />
                      ))}
                      <Line label={t("admin.costing.fullCost")} value={formatIls(full.total)} strong />
                    </div>
                  </AdminCard>
                )}
                <div className="grid gap-4 md:grid-cols-2">
                  <AdminCard title={t("admin.costing.recommended")}>
                    <p className="font-display text-3xl font-bold text-turquoise">
                      {selected.recommended == null ? "—" : formatIls(selected.recommended)}
                    </p>
                    <p className="mt-2 text-sm text-coffee/55">
                      {t("admin.costing.recommendedHint").replace(
                        "{target}",
                        String(selected.recipe.targetFoodCostPercent ?? settingsDraft.targetFoodCostPercent)
                      )}
                    </p>
                    <div className="mt-4 rounded-xl bg-beige/40 p-3 text-sm">
                      <p>
                        {t("admin.costing.currentPrice")}: {formatIls(selected.sellingPrice)}
                      </p>
                      <p className="mt-1 text-coffee/55">{t("admin.costing.noAutoPrice")}</p>
                    </div>
                  </AdminCard>
                  <AdminCard title={t("admin.costing.targetFoodCost")}>
                    <div className="grid gap-3">
                      <Input
                        type="number"
                        min="1"
                        max="90"
                        value={settingsDraft.targetFoodCostPercent}
                        onChange={(e) =>
                          onSettings({
                            ...settingsDraft,
                            targetFoodCostPercent: Number(e.target.value) || 30,
                          })
                        }
                      />
                      <label className="text-xs text-coffee/60">{t("admin.inventory.vatRate")}</label>
                      <Input
                        type="number"
                        min="0"
                        max="100"
                        step="0.1"
                        value={((settingsDraft.vatRate ?? 0.18) * 100).toString()}
                        onChange={(e) =>
                          onSettings({
                            ...settingsDraft,
                            vatRate: Number(e.target.value) / 100,
                          })
                        }
                      />
                      <label className="text-xs text-coffee/60">{t("admin.inventory.foodCostVat")}</label>
                      <select
                        className="h-10 rounded-xl border border-beige-dark/40 px-3 text-sm"
                        value={settingsDraft.foodCostVatMode ?? "before"}
                        onChange={(e) =>
                          onSettings({
                            ...settingsDraft,
                            foodCostVatMode: e.target.value as "before" | "including",
                          })
                        }
                      >
                        <option value="before">{t("admin.inventory.costBeforeVat")}</option>
                        <option value="including">{t("admin.inventory.costIncludingVat")}</option>
                      </select>
                      <label className="text-xs text-coffee/60">{t("admin.inventory.costBasis")}</label>
                      <select
                        className="h-10 rounded-xl border border-beige-dark/40 px-3 text-sm"
                        value={settingsDraft.costBasis ?? "latest"}
                        onChange={(e) =>
                          onSettings({
                            ...settingsDraft,
                            costBasis: e.target.value as "latest" | "weighted",
                          })
                        }
                      >
                        <option value="latest">{t("admin.inventory.latestCost")}</option>
                        <option value="weighted">{t("admin.inventory.weightedCost")}</option>
                      </select>
                      <select
                        className="h-10 rounded-xl border border-beige-dark/40 px-3 text-sm"
                        value={settingsDraft.priceRoundMode}
                        onChange={(e) =>
                          onSettings({
                            ...settingsDraft,
                            priceRoundMode: e.target.value as PriceRoundMode,
                          })
                        }
                      >
                        {(["none", "shekel", "half", "ninety", "five"] as const).map((mode) => (
                          <option key={mode} value={mode}>
                            {t(`admin.costing.round.${mode}`)}
                          </option>
                        ))}
                      </select>
                      <Button variant="outline" onClick={onSaveSettings}>
                        {t("common.save")}
                      </Button>
                    </div>
                  </AdminCard>
                </div>
              </>
            )}
          </div>
        ) : (
          <AdminEmptyState icon={Calculator} title={t("admin.costing.emptyRecipe")} />
        )}
      </div>

      {attention.length > 0 && (
        <AdminCard title={t("admin.costing.attention")}>
          <div className="space-y-2">
            {attention.map((row) => (
              <button
                key={row.product.id}
                type="button"
                onClick={() => onSelect(row.product.id)}
                className="flex w-full items-center justify-between rounded-xl px-2 py-2 text-start hover:bg-beige/40"
              >
                <span>{getProductDisplayName(row.product, locale)}</span>
                <span className="flex items-center gap-2 text-sm">
                  {row.foodCost == null ? t("admin.costing.noRecipe") : `${row.foodCost.toFixed(1)}%`}
                  <StatusDot status={row.status} />
                </span>
              </button>
            ))}
          </div>
        </AdminCard>
      )}
    </div>
  );
}

function RecipeLines({
  row,
  ingredients,
}: {
  row: DishCostRow;
  ingredients: CostingIngredient[];
}) {
  const t = useT();
  if (!row.recipe) return null;
  const lookup = new Map(ingredients.map((item) => [item.id, item]));
  return (
    <AdminCard title={t("admin.costing.recipeLines")}>
      <div className="hidden md:block">
        <table className="w-full text-sm">
          <tbody>
            {row.recipe.ingredients.map((line) => {
              const ingredient = lookup.get(line.ingredientId);
              const cost = ingredient ? lineRecipeCost(line.quantity, line.unit, ingredient.costPerBaseUnit) : 0;
              return (
                <tr key={`${line.ingredientId}-${line.quantity}`} className="border-b border-beige-dark/10">
                  <td className="py-2">{ingredient?.name ?? line.ingredientId}</td>
                  <td className="py-2 text-coffee/60">
                    {line.quantity} {t(unitLabelKey(line.unit))}
                  </td>
                  <td className="py-2 text-end font-medium">{formatIls(cost)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="space-y-2 md:hidden">
        {row.recipe.ingredients.map((line) => {
          const ingredient = lookup.get(line.ingredientId);
          const cost = ingredient ? lineRecipeCost(line.quantity, line.unit, ingredient.costPerBaseUnit) : 0;
          return (
            <div key={`${line.ingredientId}-${line.quantity}`} className="rounded-xl bg-beige/30 p-3 text-sm">
              <p className="font-medium">{ingredient?.name ?? line.ingredientId}</p>
              <p className="text-coffee/55">
                {line.quantity} {t(unitLabelKey(line.unit))}
              </p>
              {ingredient && (
                <p className="text-xs text-coffee/45">
                  {formatIls(ingredient.costPerBaseUnit, 4)} {t(perUnitKey(ingredient.baseUnit))}
                </p>
              )}
              <p className="mt-1 font-semibold">{formatIls(cost)}</p>
            </div>
          );
        })}
      </div>
    </AdminCard>
  );
}

function RecipesTab({
  rows,
  search,
  locale,
  categories,
  loading,
  onSearch,
  onOpen,
}: {
  rows: DishCostRow[];
  search: string;
  locale: "he" | "ar" | "en";
  categories: { id: string; name_he: string; name_ar: string; name_en: string }[];
  loading: boolean;
  onSearch: (value: string) => void;
  onOpen: (productId: string) => void;
}) {
  const t = useT();
  return (
    <div className="space-y-4">
      <Input value={search} onChange={(e) => onSearch(e.target.value)} placeholder={t("admin.costing.searchDish")} />
      {loading && <Loader2 className="mx-auto h-6 w-6 animate-spin text-turquoise" />}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {rows.map((row) => (
          <button
            key={row.product.id}
            type="button"
            onClick={() => onOpen(row.product.id)}
            className={cn(adminCard, "text-start")}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={row.product.image || "/logo-transparent.png"} alt="" className="mb-3 h-32 w-full rounded-xl object-cover" />
            <p className="font-semibold">{getProductDisplayName(row.product, locale)}</p>
            <p className="text-xs text-coffee/50">{categoryName(categories as never, row.product.categoryId, locale)}</p>
            <p className="mt-1 text-sm">{formatPrice(row.sellingPrice)}</p>
            <p className="mt-2 text-sm text-coffee/65">
              {row.recipe
                ? `${t("admin.costing.ingredientsCount").replace("{count}", String(row.lineCount))} · ${formatIls(row.ingredientCost)}`
                : t("admin.costing.noRecipe")}
            </p>
          </button>
        ))}
      </div>
    </div>
  );
}

function IngredientsTab({
  ingredients,
  movements,
  recipes,
  products,
  onToast,
  onAdd,
  onImport,
  onDownloadTemplate,
  onDownloadMenu,
  onEdit,
  onDelete,
}: {
  ingredients: CostingIngredient[];
  movements: InventoryMovement[];
  recipes: DishRecipe[];
  products: Product[];
  onToast: (message: string, variant?: "success" | "error") => void;
  onAdd: () => void;
  onImport: () => void;
  onDownloadTemplate: () => void;
  onDownloadMenu: () => void;
  onEdit: (item: CostingIngredient) => void;
  onDelete: (item: CostingIngredient) => void;
}) {
  const t = useT();
  const [issueId, setIssueId] = useState<string | null | "all">(null);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="outline" onClick={() => setIssueId("all")}>
          {t("admin.inventory.issue")}
        </Button>
        <Button variant="turquoise" onClick={onAdd}>
          <Plus className="h-4 w-4" /> {t("admin.costing.addIngredient")}
        </Button>
        <Button variant="outline" onClick={onImport}>
          <Upload className="h-4 w-4" /> {t("admin.costing.import.action")}
        </Button>
        <Button variant="outline" onClick={onDownloadTemplate}>
          <Download className="h-4 w-4" /> {t("admin.costing.import.downloadTemplate")}
        </Button>
        <Button variant="outline" onClick={onDownloadMenu}>
          <Download className="h-4 w-4" /> {t("admin.costing.import.downloadMenu")}
        </Button>
      </div>
      {ingredients.length === 0 ? (
        <AdminEmptyState
          icon={Calculator}
          title={t("admin.costing.emptyIngredients")}
          hint={t("admin.costing.emptyIngredientsHint")}
          action={
            <Button variant="turquoise" onClick={onAdd}>
              <Plus className="h-4 w-4" /> {t("admin.costing.addIngredient")}
            </Button>
          }
        />
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {ingredients.map((item) => (
            <div key={item.id} className={adminCard}>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-semibold">{item.name}</p>
                  {!item.active && <p className="text-xs text-coffee/50">{t("admin.costing.inactive")}</p>}
                </div>
                <StatusDot status={item.active ? "good" : "none"} />
              </div>
              <p className="mt-2 text-sm text-coffee/65">
                {t("admin.inventory.current")}: {stockInDisplayUnit(currentStockBase(movements, item.id), item).toFixed(2)} {t(unitLabelKey(item.purchaseUnit))}
              </p>
              <dl className="mt-3 space-y-1 text-sm">
                <div className="flex justify-between gap-3">
                  <dt className="text-coffee/55">{t("admin.costing.paidPrice")}</dt>
                  <dd>{formatIls(item.purchasePrice)}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-coffee/55">{t("admin.costing.howMuchBought")}</dt>
                  <dd>
                    {item.purchaseQuantity} {t(unitLabelKey(item.purchaseUnit))}
                  </dd>
                </div>
              </dl>
              {(() => {
                const preview = liveCostPreview(item.purchasePrice, item.purchaseQuantity, item.purchaseUnit);
                if (!preview) return null;
                return (
                  <div className="mt-3 rounded-xl bg-turquoise/8 px-3 py-2 text-sm font-medium text-turquoise">
                    <p>
                      {formatIls(preview.purchaseUnitCost)} / {t(unitLabelKey(preview.purchaseUnit))}
                    </p>
                    {preview.showBase && (
                      <p>
                        {formatIls(preview.baseUnitCost, 4)} / {t(unitLabelKey(preview.baseUnit))}
                      </p>
                    )}
                  </div>
                );
              })()}
              <div className="mt-3 flex flex-wrap gap-2">
                <Button variant="turquoise" size="sm" onClick={() => setIssueId(item.id)}>
                  {t("admin.inventory.issue")}
                </Button>
                <Button variant="outline" size="sm" onClick={() => onEdit(item)}>
                  <Pencil className="h-3.5 w-3.5" /> {t("admin.costing.editLine")}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => onDelete(item)}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
      {issueId != null && (
        <IssueIngredientForm
          open
          ingredients={ingredients}
          movements={movements}
          recipes={recipes}
          products={products}
          initialProductId={issueId === "all" ? undefined : issueId}
          onClose={() => setIssueId(null)}
          onToast={onToast}
        />
      )}
    </div>
  );
}

function HistoryTab({
  history,
  ingredients,
  snapshots,
  products,
  locale,
}: {
  history: IngredientPriceHistory[];
  ingredients: CostingIngredient[];
  snapshots: CostingSnapshot[];
  products: { id: string; name_he: string; name_ar: string; name_en: string }[];
  locale: "he" | "ar" | "en";
}) {
  const t = useT();
  const names = new Map(ingredients.map((item) => [item.id, item.name]));
  const productNames = new Map(
    products.map((item) => [item.id, getLocalizedName(item, locale)])
  );
  const sorted = [...history].sort((a, b) => +new Date(b.changedAt) - +new Date(a.changedAt));
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <AdminCard title={t("admin.costing.tab.history")}>
        <div className="space-y-3">
          {sorted.length === 0 && <p className="text-sm text-coffee/50">—</p>}
          {sorted.map((item) => (
            <div key={item.id} className="rounded-xl bg-beige/30 p-3 text-sm">
              <p className="font-medium">{names.get(item.ingredientId) ?? item.ingredientId}</p>
              <p className="text-coffee/60">
                {new Date(item.changedAt).toLocaleDateString()} · {formatIls(item.previousPrice)} → {formatIls(item.newPrice)}
              </p>
            </div>
          ))}
        </div>
      </AdminCard>
      <AdminCard title={t("admin.costing.foodCost")}>
        <div className="space-y-3">
          {[...snapshots]
            .sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt))
            .slice(0, 20)
            .map((item) => (
              <div key={item.id} className="rounded-xl bg-beige/30 p-3 text-sm">
                <p className="font-medium">{productNames.get(item.productId) ?? item.productId}</p>
                <p className="text-coffee/60">
                  {new Date(item.createdAt).toLocaleDateString()} ·{" "}
                  {item.foodCostPercent == null ? "—" : `${item.foodCostPercent.toFixed(1)}%`}
                </p>
              </div>
            ))}
        </div>
      </AdminCard>
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className={adminCard}>
      <p className="font-display text-xl font-bold text-dark-brown md:text-2xl">{value}</p>
      <p className="mt-1 text-xs text-coffee/55">{label}</p>
    </div>
  );
}

function Line({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={cn("flex justify-between", strong && "border-t border-beige-dark/15 pt-2 font-semibold")}>
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}

function extraLabel(t: (key: string) => string, name: string) {
  if (name === "packaging") return t("admin.costing.packaging");
  if (name === "labor" || name === "laborPercent") return t("admin.costing.labor");
  if (name === "creditCard") return t("admin.costing.cardFee");
  if (name === "platform") return t("admin.costing.platformFee");
  if (name === "overhead") return t("admin.costing.overhead");
  return name;
}

