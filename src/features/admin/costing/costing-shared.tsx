import { cn } from "@/lib/utils";
import type { ProfitStatus } from "@/lib/costing/types";

export const STATUS_DOT: Record<ProfitStatus, string> = {
  good: "bg-emerald-500",
  watch: "bg-amber-500",
  low: "bg-red-500",
  none: "bg-stone-300",
};

export const STATUS_TEXT: Record<ProfitStatus, string> = {
  good: "text-emerald-700",
  watch: "text-amber-700",
  low: "text-red-700",
  none: "text-coffee/45",
};

export function StatusDot({ status, className }: { status: ProfitStatus; className?: string }) {
  return (
    <span
      className={cn("inline-block h-2.5 w-2.5 rounded-full", STATUS_DOT[status], className)}
      aria-hidden
    />
  );
}

export function unitLabelKey(unit: string): string {
  if (unit === "g") return "admin.costing.unit.g";
  if (unit === "ml") return "admin.costing.unit.ml";
  if (unit === "kg") return "admin.costing.unit.kg";
  if (unit === "liter") return "admin.costing.unit.liter";
  if (unit === "bucket") return "admin.costing.unit.bucket";
  if (unit === "pack") return "admin.costing.unit.pack";
  if (unit === "carton") return "admin.costing.unit.carton";
  if (unit === "bottle") return "admin.costing.unit.bottle";
  if (unit === "bag") return "admin.costing.unit.bag";
  if (unit === "bundle") return "admin.costing.unit.bundle";
  if (unit === "tray") return "admin.costing.unit.tray";
  return "admin.costing.unit.unit";
}

export function perUnitKey(unit: string): string {
  if (unit === "g") return "admin.costing.perGram";
  if (unit === "ml") return "admin.costing.perMl";
  return "admin.costing.perUnit";
}
