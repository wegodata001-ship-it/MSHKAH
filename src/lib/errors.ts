export class ServiceError extends Error {
  constructor(
    message: string,
    public readonly code?: string
  ) {
    super(message);
    this.name = "ServiceError";
  }
}

export type ServiceResult<T> =
  | { success: true; data: T }
  | { success: false; error: string; code?: string };

export function success<T>(data: T): ServiceResult<T> {
  return { success: true, data };
}

export function isPermissionDenied(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  const code = error instanceof ServiceError ? error.code : typeof error === "object" && error && "code" in error
    ? String((error as { code?: unknown }).code ?? "")
    : "";
  return /insufficient permissions|permission-denied|PERMISSION_DENIED|Missing or insufficient permissions/i.test(
    `${code} ${message}`
  );
}

export function failure<T>(error: unknown, fallback = "An unexpected error occurred"): ServiceResult<T> {
  if (isPermissionDenied(error)) {
    const code = error instanceof ServiceError ? error.code : "PERMISSION_DENIED";
    return { success: false, error: "PERMISSION_DENIED", code: code || "PERMISSION_DENIED" };
  }
  if (error instanceof ServiceError) {
    return { success: false, error: error.message, code: error.code };
  }
  if (error instanceof Error) {
    return { success: false, error: error.message };
  }
  return { success: false, error: fallback };
}

export async function wrapService<T>(
  operation: () => Promise<T>,
  fallbackMessage: string
): Promise<ServiceResult<T>> {
  try {
    const data = await operation();
    return success(data);
  } catch (error) {
    return failure<T>(error, fallbackMessage);
  }
}
