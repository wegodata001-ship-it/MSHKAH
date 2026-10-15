"use client";

import { useMemo, useState } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useT } from "@/components/providers/locale-provider";
import { formatIls } from "@/lib/costing/money";
import { getProductDisplayName } from "@/lib/i18n/localized-content";
import type { Locale } from "@/lib/i18n/types";
import type { PosSaleLine } from "@/lib/inventory/types";
import type { Product } from "@/types";
import { savePosProductMap } from "@/services/inventoryService";

const PAGE = 25;

export function PosExcelPreviewTable({
  lines,
  products,
  locale,
  excludedKeys,
  onExclude,
  onRestore,
  onLines,
  onUpdatePrice,
}: {
  lines: PosSaleLine[];
  products: Product[];
  locale: Locale;
  excludedKeys?: string[];
  onExclude?: (keys: string[]) => void;
  onRestore?: (keys: string[]) => void;
  onLines?: (lines: PosSaleLine[]) => void;
  onUpdatePrice?: (line: PosSaleLine) => void;
}) {
  const t = useT();
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<string[]>([]);
  const excluded = useMemo(() => new Set(excludedKeys ?? []), [excludedKeys]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return lines;
    return lines.filter((line) =>
      [line.posName, line.posCode, line.sourceRow].some((value) => String(value ?? "").toLowerCase().includes(q))
    );
  }, [lines, query]);
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE));
  const current = Math.min(page, pages - 1);
  const slice = filtered.slice(current * PAGE, current * PAGE + PAGE);
  const selectedOnPage = slice.filter((line) => selected.includes(line.key) && !excluded.has(line.key));

  function toggleSelected(key: string, on: boolean) {
    setSelected((prev) => (on ? [...new Set([...prev, key])] : prev.filter((item) => item !== key)));
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setPage(0);
          }}
          placeholder={t("admin.pos.searchRows")}
          className="max-w-sm"
        />
        <p className="text-sm text-coffee/60">
          {filtered.length} / {lines.length}
          {excluded.size ? ` · ${t("admin.pos.removedFromImport")}: ${excluded.size}` : ""}
        </p>
        {selectedOnPage.length > 0 && (
          <Button
            type="button"
            variant="outline"
            className="text-red-700"
            onClick={() => {
              onExclude?.(selected.filter((key) => !excluded.has(key)));
              setSelected([]);
            }}
          >
            {t("admin.pos.removeSelected")} ({selected.filter((key) => !excluded.has(key)).length})
          </Button>
        )}
      </div>
      <div className="overflow-x-auto rounded-2xl border border-beige-dark/20">
        <table className="min-w-[60rem] w-full text-sm">
          <thead className="bg-beige/40 text-start">
            <tr>
              <th className="p-2 font-medium">
                <input
                  type="checkbox"
                  checked={slice.some((line) => !excluded.has(line.key)) && slice.filter((line) => !excluded.has(line.key)).every((line) => selected.includes(line.key))}
                  onChange={(e) => {
                    const keys = slice.filter((line) => !excluded.has(line.key)).map((line) => line.key);
                    setSelected((prev) => (e.target.checked ? [...new Set([...prev, ...keys])] : prev.filter((key) => !keys.includes(key))));
                  }}
                  aria-label={t("admin.pos.selectRows")}
                />
              </th>
              <th className="p-2 font-medium">{t("admin.pos.sourceRow")}</th>
              <th className="p-2 font-medium">{t("admin.pos.productName")}</th>
              <th className="p-2 font-medium">{t("admin.pos.barcode")}</th>
              <th className="p-2 font-medium">{t("admin.pos.soldQty")}</th>
              <th className="p-2 font-medium">{t("admin.pos.avgPrice")}</th>
              <th className="p-2 font-medium">{t("admin.pos.reportedRevenue")}</th>
              <th className="p-2 font-medium">{t("admin.pos.posCost")}</th>
              <th className="p-2 font-medium">{t("admin.pos.posProfit")}</th>
              <th className="p-2 font-medium">{t("admin.pos.mappedProduct")}</th>
              <th className="p-2 font-medium">{t("admin.pos.rowAction")}</th>
            </tr>
          </thead>
          <tbody>
            {slice.map((line) => {
              const removed = excluded.has(line.key);
              return (
                <tr key={line.key} className={`border-t border-beige-dark/15 align-top ${removed ? "bg-red-50/60 text-coffee/45" : ""}`}>
                  <td className="p-2">
                    <input
                      type="checkbox"
                      disabled={removed}
                      checked={!removed && selected.includes(line.key)}
                      onChange={(e) => toggleSelected(line.key, e.target.checked)}
                      aria-label={line.posName}
                    />
                  </td>
                  <td className="p-2 text-coffee/60">{line.sourceRow ?? "—"}</td>
                  <td className="max-w-[16rem] whitespace-pre-wrap break-words p-2 font-medium">
                    {line.posName || "—"}
                    {line.reviewReason === "missing-source-name" && (
                      <p className="text-xs font-normal text-red-700">
                        {t("admin.pos.missingSourceName")} {line.sourceRow ?? "—"}
                      </p>
                    )}
                    {removed && <p className="text-xs font-normal text-red-700">{t("admin.pos.removedFromImport")}</p>}
                  </td>
                  <td className="p-2" dir="ltr">{line.posCode || t("admin.pos.noBarcode")}</td>
                  <td className="p-2">{line.quantity}</td>
                  <td className="p-2">
                    {line.computedUnitPrice != null ? formatIls(line.computedUnitPrice) : line.unitPrice == null ? "—" : formatIls(line.unitPrice)}
                    {line.priceGap ? <p className="text-xs text-amber-800">{t("admin.pos.priceGap")}</p> : null}
                  </td>
                  <td className="p-2">{line.reportedRevenue == null && line.netTotal == null ? "—" : formatIls(line.reportedRevenue ?? line.netTotal ?? 0)}</td>
                  <td className="p-2">{line.posCost == null ? "—" : formatIls(line.posCost)}</td>
                  <td className="p-2">{line.posProfit == null ? "—" : formatIls(line.posProfit)}</td>
                  <td className="p-2">
                    <select
                      className="h-9 w-full min-w-[9rem] rounded-lg border px-2"
                      value={line.menuProductId ?? ""}
                      disabled={removed}
                      onChange={(e) => {
                        const menuProductId = e.target.value;
                        if (menuProductId) void savePosProductMap({ posCode: line.posCode, posName: line.posName, menuProductId });
                        onLines?.(
                          lines.map((item) =>
                            item.key === line.key ? { ...item, menuProductId: menuProductId || undefined, matchKind: menuProductId ? "exact" : "none" } : item
                          )
                        );
                      }}
                    >
                      <option value="">{t("admin.pos.unmatched")}</option>
                      {products.map((product) => (
                        <option key={product.id} value={product.id}>
                          {getProductDisplayName(product, locale)}
                        </option>
                      ))}
                    </select>
                    <p className="mt-1 text-[11px] text-coffee/55">{t("admin.materialGroup.posSaleOnly")}</p>
                    {line.menuProductId && line.unitPrice != null && onUpdatePrice && !removed && (
                      <Button type="button" variant="outline" className="mt-1" onClick={() => onUpdatePrice(line)}>
                        {t("admin.pos.updatePrice")}
                      </Button>
                    )}
                  </td>
                  <td className="p-2">
                    {removed ? (
                      <Button type="button" variant="outline" onClick={() => onRestore?.([line.key])}>
                        {t("admin.pos.undoRemove")}
                      </Button>
                    ) : (
                      <Button
                        type="button"
                        variant="outline"
                        className="text-red-700"
                        title={t("admin.pos.removeFromImport")}
                        onClick={() => {
                          onExclude?.([line.key]);
                          toggleSelected(line.key, false);
                        }}
                      >
                        <Trash2 className="h-4 w-4 text-red-600" />
                        <span className="ms-1">{t("admin.pos.removeFromImport")}</span>
                      </Button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {pages > 1 && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Button type="button" variant="outline" disabled={current <= 0} onClick={() => setPage(current - 1)}>
            {t("admin.pos.prevPage")}
          </Button>
          <span>
            {current + 1} / {pages}
          </span>
          <Button type="button" variant="outline" disabled={current >= pages - 1} onClick={() => setPage(current + 1)}>
            {t("admin.pos.nextPage")}
          </Button>
        </div>
      )}
    </div>
  );
}
