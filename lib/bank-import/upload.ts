/**
 * Upload input rules shared by `/api/bank-connections/upload`.
 *
 * Kept separate from the route handler so malformed/oversized files and the
 * multipart shape can be tested without a Next.js handler or a database.
 */

export const MAX_FILE_NAME_LENGTH = 255;

export type UploadInput =
  | { ok: true; fileName: string; bytes: Uint8Array; password?: string }
  | { ok: false; error: string };

/** Accepts at most one PDF file; additional files or non-PDF fields are rejected. */
export async function parseUploadForm(
  form: FormData,
  maxBytes: number,
): Promise<UploadInput> {
  const files = [...form.getAll("file")].filter((value): value is File => value instanceof File);
  if (files.length !== 1) return { ok: false, error: "Attach exactly one PDF file." };

  const file = files[0];
  const fileName = file.name.trim();
  if (!fileName) return { ok: false, error: "Choose a named PDF file." };
  if (fileName.length > MAX_FILE_NAME_LENGTH) return { ok: false, error: "The file name is too long." };

  if (file.type && !file.type.toLowerCase().endsWith("pdf")) {
    return { ok: false, error: "The uploaded file is not a PDF." };
  }
  if (file.size === 0) return { ok: false, error: "The uploaded file is empty." };
  if (file.size > maxBytes) {
    const megabytes = Math.round(maxBytes / (1024 * 1024));
    return { ok: false, error: `The file is larger than ${megabytes} MB.` };
  }

  // Some browsers report only the extension; the parser also rejects bytes
  // that don't start with %PDF-.
  if (!fileName.toLowerCase().endsWith(".pdf")) {
    return { ok: false, error: "The uploaded file is not a PDF." };
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.byteLength !== file.size) return { ok: false, error: "The file could not be read completely." };
  if (bytes.byteLength === 0) return { ok: false, error: "The uploaded file is empty." };
  if (bytes.byteLength > maxBytes) {
    const megabytes = Math.round(maxBytes / (1024 * 1024));
    return { ok: false, error: `The file is larger than ${megabytes} MB.` };
  }

  const password = form.get("password")?.toString().trim() || undefined;
  return { ok: true, fileName, bytes, ...(password ? { password } : {}) };
}
