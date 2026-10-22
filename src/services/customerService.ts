import {
  collection,
  doc,
  getDoc,
  getDocs,
  addDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  query,
  orderBy,
  type Unsubscribe,
  type DocumentData,
} from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import { COLLECTIONS } from "@/lib/firebase/collections";
import { ServiceError, type ServiceResult, success, failure } from "@/lib/errors";
import { isPlaceholderName } from "@/lib/customers/identity";
import { mapCustomer } from "@/lib/mappers";
import { customerSchema, type CustomerInput } from "@/lib/validation/schemas";
import { nowTimestamp } from "@/types/firestore";
import type { Customer } from "@/types";
import type { FirestoreCustomer, FirestoreDoc } from "@/types/firestore";

function docToCustomer(id: string, data: DocumentData): FirestoreDoc<FirestoreCustomer> {
  return { id, ...(data as FirestoreCustomer) };
}

/** Shared guest profile used for storefront checkout (Firestore rules allow public access to this doc only). */
export const GUEST_CUSTOMER_ID = "guest-checkout";

const GUEST_CUSTOMER_INPUT: CustomerInput = {
  name: "Guest Customer",
  phone: "guest@mishkat.local",
  email: "guest@mishkat.local",
  address: "Walk-in",
  favoriteProducts: [],
  notes: "",
};

function filterCustomers(customers: Customer[], search?: string): Customer[] {
  let result = customers.filter((customer) => !isPlaceholderName(customer.name));
  if (search) {
    const q = search.toLowerCase();
    result = result.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.phone.includes(q) ||
        c.address.toLowerCase().includes(q)
    );
  }
  return result.sort(
    (a, b) => new Date(b.lastOrder).getTime() - new Date(a.lastOrder).getTime()
  );
}

export async function getCustomers(search?: string): Promise<Customer[]> {
  try {
    const db = getDb();
    const q = query(
      collection(db, COLLECTIONS.customers),
      orderBy("ordersCount", "desc")
    );
    const snapshot = await getDocs(q);
    const customers = snapshot.docs.map((d) =>
      mapCustomer(docToCustomer(d.id, d.data()))
    );
    return filterCustomers(customers, search);
  } catch (error) {
    throw new ServiceError(
      error instanceof Error ? error.message : "Failed to fetch customers",
      "CUSTOMERS_READ_FAILED"
    );
  }
}

export async function getCustomerById(id: string): Promise<Customer | undefined> {
  try {
    const db = getDb();
    const snap = await getDoc(doc(db, COLLECTIONS.customers, id));
    if (!snap.exists()) return undefined;
    return mapCustomer(docToCustomer(snap.id, snap.data()));
  } catch (error) {
    throw new ServiceError(
      error instanceof Error ? error.message : "Failed to fetch customer",
      "CUSTOMER_READ_FAILED"
    );
  }
}

export async function getTopCustomers(limit = 5): Promise<Customer[]> {
  const customers = await getCustomers();
  return customers.slice(0, limit);
}

export function subscribeToCustomers(
  search: string | undefined,
  onData: (customers: Customer[]) => void,
  onError: (error: string) => void
): Unsubscribe {
  try {
    const db = getDb();
    const q = query(
      collection(db, COLLECTIONS.customers),
      orderBy("ordersCount", "desc")
    );
    return onSnapshot(
      q,
      (snapshot) => {
        const customers = snapshot.docs.map((d) =>
          mapCustomer(docToCustomer(d.id, d.data()))
        );
        onData(filterCustomers(customers, search));
      },
      (error) => onError(error.message)
    );
  } catch (error) {
    onError(error instanceof Error ? error.message : "Failed to subscribe to customers");
    return () => {};
  }
}

export async function createCustomer(input: CustomerInput): Promise<ServiceResult<Customer>> {
  try {
    const parsed = customerSchema.parse(input);
    const db = getDb();
    const now = nowTimestamp();
    const data: FirestoreCustomer = {
      ...parsed,
      ordersCount: 0,
      lastOrder: null,
      createdAt: now,
    };
    const ref = await addDoc(collection(db, COLLECTIONS.customers), data);
    return success(mapCustomer(docToCustomer(ref.id, data)));
  } catch (error) {
    return failure(error, "Failed to create customer");
  }
}

export async function updateCustomer(
  id: string,
  input: Partial<CustomerInput>
): Promise<ServiceResult<Customer>> {
  try {
    const db = getDb();
    const ref = doc(db, COLLECTIONS.customers, id);
    await updateDoc(ref, input);
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      return failure(new ServiceError("Customer not found", "NOT_FOUND"));
    }
    return success(mapCustomer(docToCustomer(snap.id, snap.data())));
  } catch (error) {
    return failure(error, "Failed to update customer");
  }
}

export async function deleteCustomer(id: string): Promise<ServiceResult<void>> {
  try {
    const db = getDb();
    await deleteDoc(doc(db, COLLECTIONS.customers, id));
    return success(undefined);
  } catch (error) {
    return failure(error, "Failed to delete customer");
  }
}

export async function getOrCreateGuestCustomer(): Promise<ServiceResult<Customer>> {
  try {
    const parsed = customerSchema.parse(GUEST_CUSTOMER_INPUT);
    const now = nowTimestamp();
    const data: FirestoreCustomer = {
      ...parsed,
      ordersCount: 0,
      lastOrder: null,
      createdAt: now,
    };

    // Best-effort — must not block checkout if rules deny read/update
    try {
      const db = getDb();
      await setDoc(doc(db, COLLECTIONS.customers, GUEST_CUSTOMER_ID), data, { merge: true });
    } catch (seedError) {
      console.warn("[getOrCreateGuestCustomer] seed skipped:", seedError);
    }

    return success(mapCustomer(docToCustomer(GUEST_CUSTOMER_ID, data)));
  } catch (error) {
    console.error("[getOrCreateGuestCustomer] failed:", error);
    return failure(error, "Failed to get guest customer");
  }
}
