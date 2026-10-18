import { getFirebaseAuth } from "@/lib/firebase";

export type AdminFetchResult<T> = {
  ok: boolean;
  status: number;
  data?: T;
  error?: string;
  code?: string;
};

export async function clientAdminFetch<T>(path: string, body: unknown): Promise<AdminFetchResult<T>> {
  const user = getFirebaseAuth().currentUser;
  if (!user) {
    return { ok: false, status: 401, error: "PERMISSION_DENIED", code: "PERMISSION_DENIED" };
  }
  const token = await user.getIdToken();
  const response = await fetch(path, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const json = (await response.json().catch(() => ({}))) as T & { error?: string; code?: string; message?: string };
  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      error: json.error || json.message || "REQUEST_FAILED",
      code: json.code || (response.status === 403 || response.status === 401 ? "PERMISSION_DENIED" : undefined),
      data: json,
    };
  }
  return { ok: true, status: response.status, data: json };
}
