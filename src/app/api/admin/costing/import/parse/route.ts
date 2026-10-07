import { NextRequest } from "next/server";
import { requireAdminOnly } from "@/lib/auth/verify-admin";
import { parseImportBuffer, validateImportFile } from "@/lib/costing/import/parse-workbook";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const auth = await requireAdminOnly(request);
  if (auth instanceof Response) return auth;

  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return Response.json({ error: "file-required" }, { status: 400 });
  }
  const invalid = validateImportFile(file.name, file.size, file.type);
  if (invalid) {
    return Response.json({ error: invalid }, { status: 400 });
  }
  const buffer = Buffer.from(await file.arrayBuffer());
  const parsed = await parseImportBuffer(buffer, file.name);
  return Response.json(parsed);
}
