import { getFirebaseAuth } from "@/lib/firebase";
import { readJsonSafe } from "@/lib/http/read-json-safe";

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
  let response: Response;
  try {
    response = await fetch(path, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
  } catch {
    return { ok: false, status: 0, error: "NETWORK", code: "NETWORK" };
  }
  const json = await readJsonSafe(response);
  if (json.error === "invalid-json" || json.error === "empty-response") {
    return { ok: false, status: response.status, error: "INVALID_RESPONSE", code: "INVALID_RESPONSE" };
  }
  const payload = json as T & { error?: string; code?: string; message?: string };
  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      error: payload.error || payload.message || "REQUEST_FAILED",
      code: payload.code || (response.status === 403 || response.status === 401 ? "PERMISSION_DENIED" : undefined),
      data: payload,
    };
  }
  return { ok: true, status: response.status, data: payload };
}
