/**
 * GET /api/settings/backup/export
 *
 * Admin-only full-database Excel backup. Read-only and no-store.
 */

import { type NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/server-auth";
import { isAdmin } from "@/lib/credentials";
import { buildBackupExport } from "@/lib/backup/export";

export const maxDuration = 60;

export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await requireAuth(req);
  if (!auth.ok) return auth.response;
  if (!(await isAdmin(auth.session.userId))) {
    return NextResponse.json({ ok: false, error: "Only an admin can export a backup." }, { status: 403 });
  }

  try {
    const result = await buildBackupExport(auth.session.userId);
    const body = result.bytes.buffer.slice(
      result.bytes.byteOffset,
      result.bytes.byteOffset + result.bytes.byteLength,
    ) as ArrayBuffer;
    return new NextResponse(body, {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${result.fileName}"`,
        "Content-Length": String(result.bytes.byteLength),
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    console.error("[backup] export failed", error instanceof Error ? error.name : "unknown");
    return NextResponse.json(
      { ok: false, error: "The backup could not be created. Try again." },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
