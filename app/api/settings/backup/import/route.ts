/**
 * POST /api/settings/backup/import
 *
 * Admin-only restore. multipart/form-data with one `file` field (.xlsx).
 * The importer runs one PostgreSQL transaction; failures roll back and return
 * a report instead of a partial restore.
 */

import { type NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/server-auth";
import { isAdmin } from "@/lib/credentials";
import { importBackup } from "@/lib/backup/import";
import { MAX_BACKUP_BYTES } from "@/lib/backup/types";

export const maxDuration = 60;

const NO_STORE = { "Cache-Control": "no-store" };

export async function POST(req: NextRequest): Promise<NextResponse> {
  const auth = await requireAuth(req);
  if (!auth.ok) return auth.response;
  if (!(await isAdmin(auth.session.userId))) {
    return NextResponse.json({ ok: false, error: "Only an admin can import a backup." }, { status: 403, headers: NO_STORE });
  }

  const contentType = req.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("multipart/form-data")) {
    return NextResponse.json(
      { ok: false, error: "Upload the backup as multipart/form-data.", rolledBack: false },
      { status: 415, headers: NO_STORE },
    );
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json(
      { ok: false, error: "The upload could not be read. Choose the .xlsx file again.", rolledBack: false },
      { status: 400, headers: NO_STORE },
    );
  }

  const file = form.get("file");
  if (!file || typeof file === "string") {
    return NextResponse.json(
      { ok: false, error: "Choose an Excel backup file.", rolledBack: false },
      { status: 400, headers: NO_STORE },
    );
  }
  if (!file.name.toLowerCase().endsWith(".xlsx")) {
    return NextResponse.json(
      { ok: false, error: "Choose the .xlsx file downloaded from Export backup.", rolledBack: false },
      { status: 415, headers: NO_STORE },
    );
  }
  if (file.size === 0) {
    return NextResponse.json(
      { ok: false, error: "That file is empty.", rolledBack: false },
      { status: 400, headers: NO_STORE },
    );
  }
  if (file.size > MAX_BACKUP_BYTES) {
    return NextResponse.json(
      { ok: false, error: "This file is larger than 25 MB.", rolledBack: false },
      { status: 413, headers: NO_STORE },
    );
  }

  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const report = await importBackup({
      bytes,
      fileName: file.name,
      userId: auth.session.userId,
      dryRun: req.nextUrl.searchParams.get("dryRun") === "1",
    });
    return NextResponse.json(report, {
      status: report.ok ? 200 : report.rolledBack ? 422 : 400,
      headers: NO_STORE,
    });
  } catch (error) {
    console.error("[backup] import route failed", error instanceof Error ? error.name : "unknown");
    return NextResponse.json(
      { ok: false, error: "The backup could not be imported. Nothing was changed.", rolledBack: true },
      { status: 500, headers: NO_STORE },
    );
  }
}
