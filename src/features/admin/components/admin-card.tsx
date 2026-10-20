"use client";

import { motion } from "framer-motion";
import type { ReactNode } from "react";
import { adminCard } from "./admin-styles";
import { cn } from "@/lib/utils";

interface AdminCardProps {
  title?: string;
  icon?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  delay?: number;
}

export function AdminCard({ title, icon, action, children, className, delay = 0 }: AdminCardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay }}
      className={cn(adminCard, className)}
    >
      {(title || action) && (
        <div className="mb-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            {icon}
            {title && (
              <h2 className="text-[22px] font-semibold leading-snug text-dark-brown dark:text-warm-white">{title}</h2>
            )}
          </div>
          {action}
        </div>
      )}
      {children}
    </motion.div>
  );
}
