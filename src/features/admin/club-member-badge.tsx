"use client";

import { Sparkles } from "lucide-react";
import { useT } from "@/components/providers/locale-provider";

/**
 * Shared member badge. Combines colour **and** text ("חבר מועדון") so the
 * tag is visible to colour-blind viewers per the loyalty-club spec.
 */
export function ClubMemberBadge({ compact }: { compact?: boolean }) {
  const t = useT();
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border border-turquoise/30 bg-turquoise/10 font-medium text-turquoise ${
        compact ? "px-2 py-0.5 text-[11px]" : "px-2.5 py-1 text-xs"
      }`}
      aria-label={t("club.badge.label")}
    >
      <Sparkles className={compact ? "h-3 w-3" : "h-3.5 w-3.5"} />
      {t("club.badge.label")}
    </span>
  );
}
