"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { ReportsAdmin } from "@/features/admin/reports/reports-admin";
import type { ReportType } from "@/lib/reports/types";

const TYPES: ReportType[] = [
  "inventory",
  "exceptions",
  "blank-count",
  "count-consumption",
  "purchases",
  "supplier-compare",
  "breakeven",
];

function ReportsPageInner() {
  const params = useSearchParams();
  const raw = params.get("type");
  const initialType = TYPES.includes(raw as ReportType) ? (raw as ReportType) : undefined;
  return <ReportsAdmin initialType={initialType} />;
}

export default function AdminReportsPage() {
  return (
    <Suspense>
      <ReportsPageInner />
    </Suspense>
  );
}
