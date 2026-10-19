"use client";

import { useEffect, useMemo, useState } from "react";
import { getDb } from "@/lib/firebase";
import {
  collection,
  onSnapshot,
  orderBy,
  query,
  type Unsubscribe,
} from "firebase/firestore";
import { COLLECTIONS } from "@/lib/firebase/collections";
import type { LoyaltyMember } from "@/lib/loyalty/types";

/**
 * Live admin-only view of club members. We rely on the Firestore rule
 * `allow read: if isAdmin()` to gate the subscription.
 */
export function useClubMembers() {
  const [members, setMembers] = useState<LoyaltyMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    const unsubscribe: Unsubscribe = onSnapshot(
      query(collection(getDb(), COLLECTIONS.loyaltyMembers), orderBy("createdAt", "desc")),
      (snapshot) => {
        const next: LoyaltyMember[] = [];
        snapshot.forEach((docSnap) => {
          const data = docSnap.data() as Omit<LoyaltyMember, "id">;
          next.push({ id: docSnap.id, ...data });
        });
        setMembers(next);
        setLoading(false);
      },
      (err) => {
        setError(err.message);
        setLoading(false);
      }
    );
    return () => unsubscribe();
  }, []);

  /** Map of lower-cased email → active member for O(1) lookup from the customers UI. */
  const byEmail = useMemo(() => {
    const map = new Map<string, LoyaltyMember>();
    for (const member of members) {
      if (!member.email) continue;
      map.set(member.email.trim().toLowerCase(), member);
    }
    return map;
  }, [members]);

  return { members, loading, error, byEmail };
}
