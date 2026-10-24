/**
 * POST /api/bank-connections/upload
 *
 * Node.js runtime because pdf-parse is a Node package and PostgreSQL writes run
 * in the Next.js server process. The handler parses and stages only: it never
 * inserts, updates, restores, or deletes a financial transaction.
 */

import { createHash } from "crypto";
import { type NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/server-auth";
import { canManageBankImports } from "@/lib/bank-import/policy";
import { bankImportLimits } from "@/lib/bank-import/limits";
import { parseUploadForm } from "@/lib/bank-import/upload";
import { parseBankStatementPdf } from "@/lib/bank-import/pdf";
import { BankImportError } from "@/lib/bank-import/types";
import { persistStatement } from "@/lib/bank-import/persistence";
import { STATEMENT_SAVE_ERROR } from "@/lib/bank-import/upload-errors";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type StatusCode = 400 | 401 | 403 | 409 | 413 | 415 | 422 | 500;

function errorBody(message: string, code?: string) {
  return code ? { ok: false, error: message, code } : { ok: false, error: message };
}

function errorResponse(message: string, status: StatusCode, code?: string) {
  return NextResponse.json(errorBody(message, code), { status });
}

/** Managers and admins can upload. Removed members and other roles cannot. */
async function isBankImportUser(userId: string): Promise<boolean> {
  return canManageBankImports(userId);
}

function normalizeError(error: unknown): { status: StatusCode; message: string; code?: string } {
  if (error instanceof BankImportError) {
    const status =
      error.code === "FILE_TOO_LARGE" ? 413
      : error.code === "NOT_A_PDF" ? 415
      : error.code === "INVALID_PDF" || error.code === "NO_TEXT_LAYER" ? 422
      : error.code === "PASSWORD_REQUIRED" || error.code === "WRONG_PASSWORD" ? 400
      : 400;
    return { status, message: error.message, code: error.code };
  }
  if (error instanceof Error) {
    // Never echo parser internals, file bytes, narrative text, or file name.
    return { status: 500, message: STATEMENT_SAVE_ERROR };
  }
  return { status: 500, message: STATEMENT_SAVE_ERROR };
}

/**
 * POST a single PDF. The password is kept in the in-memory options object only;
 * it is never persisted or logged.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const auth = await requireAuth(req);
    if (!auth.ok) return auth.response;

    const approved = await isBankImportUser(auth.session.userId);
    if (!approved) return errorResponse("You don't have access to bank imports.", 403);

    const contentType = req.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().includes("multipart/form-data")) {
      return errorResponse("Send the statement PDF as multipart/form-data.", 415);
    }

    const limits = bankImportLimits();
    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      return errorResponse("Send the statement PDF as multipart/form-data.", 400);
    }

    const input = await parseUploadForm(form, limits.maxBytes);
    if (!input.ok) return errorResponse(input.error, input.error.includes("larger") ? 413 : 400);

    const accountId = form.get("accountId")?.toString().trim() ?? "";
    if (!UUID.test(accountId)) return errorResponse("Choose a bank account.", 400);

    if (!input.bytes.length) return errorResponse("The uploaded file is empty.", 400);

    const fileSha256 = createHash("sha256").update(input.bytes).digest("hex");

    const parsed = await parseBankStatementPdf(input.bytes, {
      maxBytes: limits.maxBytes,
      maxPages: limits.maxPages,
      maxRows: limits.maxRows,
      ...(input.password ? { password: input.password } : {}),
    });

    const persisted = await persistStatement({
      accountId,
      userId: auth.session.userId,
      fileName: input.fileName,
      fileSha256,
      fileSizeBytes: input.bytes.length,
      parsed,
    });
    if (!persisted.ok) {
      const status = persisted.error.toLowerCase().includes("already has a live statement")
        ? 409
        : persisted.error.toLowerCase().includes("bank account") ? 400
        : persisted.error.toLowerCase().includes("v1 accepts") ? 400
        : 500;
      return errorResponse(persisted.error, status);
    }

    return NextResponse.json({
      ok: true,
      statementId: persisted.value.statementId,
      lineCount: persisted.value.lineCount,
      pageCount: parsed.pages,
      ...(parsed.warnings.length ? { warnings: parsed.warnings } : {}),
    });
  } catch (error) {
    const safeError = normalizeError(error);
    return errorResponse(safeError.message, safeError.status, safeError.code);
  }
}
