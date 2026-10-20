"use client";

import { useState, useMemo, useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import {
  Plus,
  Pencil,
  Trash2,
  LayoutGrid,
  List,
  Copy,
  Search,
  CheckSquare,
  Square,
  GripVertical,
  FileSpreadsheet,
  Loader2,
} from "lucide-react";
import { useProducts, useAllCategories } from "@/hooks/useProducts";
import { createProduct, updateProduct, deleteProduct, reorderProducts } from "@/services";
import { exportAllProductsExcel } from "@/services/productExcelExportService";
import { type ProductInput } from "@/lib/validation/schemas";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ProductImage } from "@/components/catalog/product-image";
import { deleteImageByUrl } from "@/services/storageService";
import { formatPrice, cn } from "@/lib/utils";
import { useT, useLocale } from "@/components/providers/locale-provider";
import { AdminPageHeader } from "./components/admin-page-header";
import { SortableList } from "@/components/admin/sortable-list";
import { ProductFormDialog } from "./product-form/product-form-dialog";
import { AdminToastStack, createToast, type AdminToast } from "./components/admin-toast";
import { useSettings } from "@/hooks/useSettings";
import type { Product } from "@/types";

type ViewMode = "grid" | "table" | "reorder";

function AddProductCard({
  onClick,
  title,
  description,
}: {
  onClick: () => void;
  title: string;
  description: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={title}
      className="group flex aspect-[3/4] min-h-[220px] w-full flex-col items-center justify-center rounded-2xl border-2 border-dashed border-turquoise/45 bg-turquoise/[0.04] px-4 text-center transition-colors duration-200 hover:border-turquoise hover:bg-turquoise/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-turquoise focus-visible:ring-offset-2 dark:bg-turquoise/[0.06]"
    >
      <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-turquoise/10 text-turquoise transition-colors duration-200 group-hover:bg-turquoise group-hover:text-warm-white">
        <Plus className="h-7 w-7" strokeWidth={2} aria-hidden />
      </span>
      <span className="mt-4 text-base font-semibold text-dark-brown dark:text-warm-white">
        {title}
      </span>
      <span className="mt-1 text-sm text-coffee/55 dark:text-warm-white/55">
        {description}
      </span>
    </button>
  );
}

export function ProductsAdmin() {
  const t = useT();
  const { locale } = useLocale();
  const { settings } = useSettings();
  const router = useRouter();
  const pathname = usePathname();
  const { products, loading, error, isIndexError, retry } = useProducts(undefined, { admin: true });
  const { categories, error: categoriesError, retry: retryCategories } = useAllCategories();
  const [view, setView] = useState<ViewMode>("grid");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<Product | null>(null);
  const [open, setOpen] = useState(false);
  const [inlinePrices, setInlinePrices] = useState<Record<string, string>>({});
  const [ordered, setOrdered] = useState<Product[]>([]);
  const [exporting, setExporting] = useState(false);
  const [toasts, setToasts] = useState<AdminToast[]>([]);

  // Header "מוצר חדש" links to /admin/products?new=1
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("new") !== "1") return;
    setEditing(null);
    setOpen(true);
    router.replace(pathname, { scroll: false });
  }, [router, pathname]);

  const copySuffix = ` (${t("admin.action.copy")})`;

  const sortedProducts = useMemo(
    () => [...products].sort((a, b) => a.sortOrder - b.sortOrder),
    [products]
  );

  const filtered = useMemo(() => {
    if (!search) return products;
    const q = search.toLowerCase();
    return products.filter(
      (p) =>
        p.name_en.toLowerCase().includes(q) ||
        p.name_he.includes(search) ||
        p.name_ar.includes(search)
    );
  }, [products, search]);

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    if (selected.size === filtered.length) setSelected(new Set());
    else setSelected(new Set(filtered.map((p) => p.id)));
  };

  const bulkDelete = async () => {
    if (!confirm(t("admin.products.bulkDeleteConfirm").replace("{count}", String(selected.size)))) return;
    for (const id of selected) {
      const p = products.find((x) => x.id === id);
      if (p?.image) await deleteImageByUrl(p.image);
      await deleteProduct(id);
    }
    setSelected(new Set());
  };

  const bulkAvailability = async (available: boolean) => {
    for (const id of selected) await updateProduct(id, { available });
    setSelected(new Set());
  };

  const bulkCategory = async (categoryId: string) => {
    for (const id of selected) await updateProduct(id, { categoryId });
    setSelected(new Set());
  };

  const duplicateProduct = async (product: Product) => {
    const data: ProductInput = {
      nameHe: `${product.name_he}${copySuffix}`,
      nameAr: `${product.name_ar}${copySuffix}`,
      nameEn: `${product.name_en}${copySuffix}`,
      descriptionHe: product.description_he,
      descriptionAr: product.description_ar,
      descriptionEn: product.description_en,
      categoryId: product.categoryId,
      price: product.price,
      cost: product.cost,
      profit: product.profit,
      businessType: product.businessType,
      imageUrl: product.image,
      available: product.available,
      popular: false,
      newProduct: true,
      active: true,
      sortOrder: products.length + 1,
    };
    await createProduct(data);
  };

  const saveInlinePrice = async (product: Product) => {
    const val = parseFloat(inlinePrices[product.id] ?? String(product.price));
    if (!isNaN(val) && val > 0 && val !== product.price) {
      const cost = product.cost;
      await updateProduct(product.id, { price: val, profit: Math.round((val - cost) * 100) / 100 });
    }
  };

  const openCreate = () => {
    setEditing(null);
    setOpen(true);
  };

  const openEdit = (product: Product) => {
    setEditing(product);
    setOpen(true);
  };

  const handleDelete = async (product: Product) => {
    if (!confirm(t("admin.products.deleteConfirm"))) return;
    if (product.image) await deleteImageByUrl(product.image);
    await deleteProduct(product.id);
  };

  const handleReorder = async (items: Product[]) => {
    setOrdered(items);
    await reorderProducts(items.map((p) => p.id));
  };

  const handleExportExcel = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      await exportAllProductsExcel({
        locale,
        storeName: settings?.storeName,
      });
      setToasts((current) => [...current, createToast(t("admin.products.exportExcelSuccess"))]);
    } catch (err) {
      console.error("[Products] Excel export failed:", err);
      setToasts((current) => [
        ...current,
        createToast(t("admin.products.exportExcelError"), "error"),
      ]);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-6">
      {(error || categoriesError) && !loading && (
        <div
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 px-4 py-4 text-sm text-red-800 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-200"
        >
          <p className="font-medium">{t("admin.products.loadError")}</p>
          {isIndexError && (
            <p className="mt-1 text-xs opacity-80">{t("admin.products.indexErrorHint")}</p>
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-3 rounded-xl"
            onClick={() => {
              retry();
              retryCategories();
            }}
          >
            {t("admin.action.retry")}
          </Button>
        </div>
      )}

      <AdminPageHeader
        title={t("admin.products.title")}
        subtitle={t("admin.products.subtitle")}
        actions={
          <>
            <div className="relative">
              <Search className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-coffee/40" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t("admin.action.search")}
                className="h-10 w-44 pl-9 sm:w-56"
              />
            </div>
            <div className="flex rounded-xl border border-beige-dark/30 p-0.5 dark:border-white/10">
              <button
                onClick={() => setView("grid")}
                className={cn("rounded-lg p-2", view === "grid" && "bg-coffee text-warm-white")}
                title={t("admin.products.grid")}
              >
                <LayoutGrid className="h-4 w-4" />
              </button>
              <button
                onClick={() => setView("table")}
                className={cn("rounded-lg p-2", view === "table" && "bg-coffee text-warm-white")}
                title={t("admin.products.table")}
              >
                <List className="h-4 w-4" />
              </button>
              <button
                onClick={() => setView("reorder")}
                className={cn("rounded-lg p-2", view === "reorder" && "bg-coffee text-warm-white")}
                title={t("admin.action.reorder")}
              >
                <GripVertical className="h-4 w-4" />
              </button>
            </div>
            <Button
              type="button"
              variant="outline"
              onClick={() => void handleExportExcel()}
              disabled={exporting}
            >
              {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSpreadsheet className="h-4 w-4" />}
              {exporting ? t("admin.products.exportExcelPreparing") : t("admin.products.exportExcel")}
            </Button>
            <Button onClick={openCreate} variant="turquoise">
              <Plus className="h-4 w-4" /> {t("admin.products.new")}
            </Button>
          </>
        }
      />

      <AnimatePresence>
        {selected.size > 0 && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="flex flex-wrap items-center gap-2 rounded-xl bg-coffee/5 p-3 dark:bg-white/5"
          >
            <span className="text-sm font-medium">
              {t("admin.products.selected").replace("{count}", String(selected.size))}
            </span>
            <Button size="sm" variant="outline" onClick={() => bulkAvailability(true)}>
              {t("admin.action.makeAvailable")}
            </Button>
            <Button size="sm" variant="outline" onClick={() => bulkAvailability(false)}>
              {t("admin.action.makeUnavailable")}
            </Button>
            <Select onValueChange={bulkCategory}>
              <SelectTrigger className="h-8 w-40">
                <SelectValue placeholder={t("admin.action.changeCategory")} />
              </SelectTrigger>
              <SelectContent>
                {categories.map((c) => <SelectItem key={c.id} value={c.id}>{c.name_en}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button size="sm" variant="destructive" onClick={bulkDelete}>
              <Trash2 className="h-3.5 w-3.5" /> {t("admin.action.delete")}
            </Button>
          </motion.div>
        )}
      </AnimatePresence>

      {loading ? (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
          <AddProductCard
            onClick={openCreate}
            title={t("admin.products.addProductCard")}
            description={t("admin.products.addProductHint")}
          />
          {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="aspect-[3/4] rounded-2xl" />)}
        </div>
      ) : view === "reorder" ? (
        <SortableList
          className="space-y-2"
          items={ordered.length ? ordered : sortedProducts}
          onReorder={handleReorder}
          renderItem={(product, dragHandle) => (
            <div className="flex items-center gap-3 rounded-xl border border-beige-dark/20 bg-warm-white p-3 dark:border-white/10 dark:bg-white/5">
              {dragHandle}
              <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-lg">
                <ProductImage image={product.image} categoryId={product.categoryId} alt="" thumbnail />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium dark:text-warm-white" dir="rtl">{product.name_ar}</p>
                <p className="text-xs text-coffee/50">{formatPrice(product.price)}</p>
              </div>
            </div>
          )}
        />
      ) : view === "grid" ? (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
          <AddProductCard
            onClick={openCreate}
            title={t("admin.products.addProductCard")}
            description={t("admin.products.addProductHint")}
          />
          {filtered.map((product, i) => (
            <motion.div
              key={product.id}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.02 }}
              className={cn(
                "group overflow-hidden rounded-2xl border bg-warm-white shadow-soft transition-all hover:shadow-elevated dark:bg-[#1a1412]",
                selected.has(product.id) ? "border-turquoise ring-2 ring-turquoise/30" : "border-beige-dark/20 dark:border-white/10"
              )}
            >
              <div
                role="button"
                tabIndex={0}
                aria-label={`${t("admin.action.edit")} ${product.name_he || product.name_en}`}
                onClick={() => openEdit(product)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    openEdit(product);
                  }
                }}
                className="relative aspect-square cursor-pointer"
              >
                <ProductImage
                  image={product.image}
                  categoryId={product.categoryId}
                  alt={product.name_he || product.name_en || product.name_ar}
                  sizes="250px"
                />
                <button
                  onClick={(event) => {
                    event.stopPropagation();
                    toggleSelect(product.id);
                  }}
                  className="absolute top-2 left-2 rounded-lg bg-warm-white/90 p-1.5 shadow-sm"
                >
                  {selected.has(product.id) ? <CheckSquare className="h-4 w-4 text-turquoise" /> : <Square className="h-4 w-4 text-coffee/40" />}
                </button>
                <div className="absolute top-2 right-2 flex gap-1 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100">
                  <button
                    onClick={(event) => {
                      event.stopPropagation();
                      void duplicateProduct(product);
                    }}
                    className="rounded-lg bg-warm-white/90 p-1.5"
                    title={t("admin.action.duplicate")}
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={(event) => {
                      event.stopPropagation();
                      openEdit(product);
                    }}
                    className="rounded-lg bg-warm-white/90 p-1.5"
                    title={t("admin.action.edit")}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                </div>
                {!product.available && (
                  <span className="absolute bottom-2 left-2 rounded-full bg-red-500/90 px-2 py-0.5 text-[10px] text-white">
                    {t("admin.status.unavailable")}
                  </span>
                )}
              </div>
              <div className="p-3">
                <p className="truncate text-[18px] font-semibold dark:text-warm-white" dir="rtl">{product.name_ar}</p>
                <p className="truncate text-xs text-coffee/50">{product.name_en}</p>
                <Input
                  type="number"
                  defaultValue={product.price}
                  className="mt-2 h-11 text-xl font-bold tabular-nums"
                  onBlur={(e) => {
                    const val = parseFloat(e.target.value);
                    if (!isNaN(val) && val !== product.price) {
                      updateProduct(product.id, { price: val, profit: Math.round((val - product.cost) * 100) / 100 });
                    }
                  }}
                />
              </div>
            </motion.div>
          ))}
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-beige-dark/20 bg-warm-white shadow-soft dark:border-white/10 dark:bg-[#1a1412]">
          <table className="w-full">
            <thead>
              <tr className="border-b bg-beige/30 text-left text-xs uppercase text-coffee/60 dark:bg-white/5">
                <th className="px-4 py-3">
                  <button onClick={selectAll} title={t("admin.action.selectAll")}>
                    <Square className="h-4 w-4" />
                  </button>
                </th>
                <th className="px-4 py-3">{t("admin.products.title")}</th>
                <th className="hidden px-4 py-3 md:table-cell">{t("admin.products.category")}</th>
                <th className="px-4 py-3">{t("admin.products.price")}</th>
                <th className="hidden px-4 py-3 sm:table-cell">{t("admin.table.status")}</th>
                <th className="px-4 py-3 text-right">{t("admin.table.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((product) => (
                <tr key={product.id} className="border-b border-beige-dark/10 hover:bg-beige/20 dark:hover:bg-white/5">
                  <td className="px-4 py-3">
                    <button onClick={() => toggleSelect(product.id)}>
                      {selected.has(product.id) ? <CheckSquare className="h-4 w-4 text-turquoise" /> : <Square className="h-4 w-4" />}
                    </button>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-xl">
                        <ProductImage image={product.image} categoryId={product.categoryId} alt="" thumbnail />
                      </div>
                      <div>
                        <p className="text-[18px] font-semibold dark:text-warm-white" dir="rtl">{product.name_ar}</p>
                        <p className="text-xs text-coffee/50">{product.name_en}</p>
                      </div>
                    </div>
                  </td>
                  <td className="hidden px-4 py-3 text-sm md:table-cell">{categories.find((c) => c.id === product.categoryId)?.name_en}</td>
                  <td className="px-4 py-3">
                    <Input type="number" defaultValue={product.price} className="h-11 w-24 text-xl font-bold tabular-nums"
                      onBlur={(e) => {
                        const val = parseFloat(e.target.value);
                        if (!isNaN(val) && val !== product.price) updateProduct(product.id, { price: val });
                      }}
                    />
                  </td>
                  <td className="hidden px-4 py-3 sm:table-cell">
                    <span className={cn("text-xs font-medium", product.available ? "text-emerald-600" : "text-red-500")}>
                      {product.available ? t("admin.status.available") : t("admin.status.unavailable")}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" size="icon-sm" onClick={() => duplicateProduct(product)} title={t("admin.action.duplicate")}>
                        <Copy className="h-3.5 w-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon-sm" onClick={() => openEdit(product)} title={t("admin.action.edit")}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon-sm" onClick={() => handleDelete(product)} title={t("admin.action.delete")}>
                        <Trash2 className="h-3.5 w-3.5 text-red-500" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ProductFormDialog
        open={open}
        onOpenChange={setOpen}
        editing={editing}
        categories={categories}
        productsCount={products.length}
        onDuplicate={duplicateProduct}
      />
      <AdminToastStack toasts={toasts} onDismiss={(id) => setToasts((current) => current.filter((toast) => toast.id !== id))} />
    </div>
  );
}
