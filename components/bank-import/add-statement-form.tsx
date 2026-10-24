"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { BankAccountRow } from "@/lib/bank-import/queries";
import { STATEMENT_SAVE_ERROR } from "@/lib/bank-import/upload-errors";

interface UploadStatementFormProps {
  accounts: BankAccountRow[];
  limits: {
    maxFileMegabytes: number;
    maxPages: number;
    maxRows: number;
  };
}

type UploadResult = {
  ok: true;
  statementId: string;
  lineCount: number;
  pageCount: number;
  warnings?: string[];
};

type UploadError = {
  ok: false;
  error: string;
  code?: string;
};

export function UploadStatementForm({
  accounts,
  limits,
}: UploadStatementFormProps) {
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const [accountId, setAccountId] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  if (accounts.length === 0) {
    return (
      <p className="text-body-sm text-muted-foreground">
        Add a bank account below before uploading a statement.
      </p>
    );
  }

  function selectFile(event: React.ChangeEvent<HTMLInputElement>) {
    if (event.target.files?.length === 1) {
      setError(null);
    }
  }

  function clearPassword() {
    setPassword("");
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const file = fileInput.current?.files?.[0];
    if (!file || !accountId.trim()) {
      setError("Choose a bank account and a PDF file first.");
      return;
    }

    setPending(true);
    setError(null);

    const payload = new FormData();
    payload.append("accountId", accountId);
    payload.append("file", file);
    if (password.trim()) payload.append("password", password.trim());

    try {
      const response = await fetch("/api/bank-connections/upload", {
        method: "POST",
        body: payload,
      });
      const result: UploadResult | UploadError = await response.json();
      if (!response.ok || !result.ok) {
        setError("error" in result && result.error ? result.error : STATEMENT_SAVE_ERROR);
        return;
      }

      toast.success("Statement uploaded for review");
      form.reset();
      setAccountId("");
      clearPassword();
      router.push(`/bank-connections/${result.statementId}`);
    } catch {
      setError(STATEMENT_SAVE_ERROR);
    } finally {
      setPending(false);
    }
  }

  return (
    <form ref={formRef} onSubmit={submit} className="space-y-4">
      {error ? (
        <p
          role="alert"
          className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-caption text-destructive"
        >
          {error}
        </p>
      ) : null}

      <div className="space-y-1.5">
        <Label htmlFor="bank-account">Bank account</Label>
        <select
          id="bank-account"
          value={accountId}
          onChange={(event) => setAccountId(event.target.value)}
          className="h-10 w-full min-w-0 rounded-lg border border-input bg-card px-3.5 py-1 text-base transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm"
          required
        >
          <option value="">Choose a bank account</option>
          {accounts.map((account) => (
            <option key={account.id} value={account.id}>
              {account.displayName}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="statement">PDF statement</Label>
        <Input
          id="statement"
          name="file"
          ref={fileInput}
          type="file"
          accept="application/pdf,.pdf"
          onChange={selectFile}
          required
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="password">PDF password (optional)</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="off"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder="Leave blank for an unlocked PDF"
        />
      </div>

      <p className="text-caption text-muted-foreground">
        Max {limits.maxFileMegabytes} MB, {limits.maxPages} pages, or {limits.maxRows} rows. The PDF
        is parsed in memory and never stored on disk.
      </p>

      <Button type="submit" disabled={pending}>
        {pending ? "Uploading..." : "Upload and parse"}
        <Upload data-icon="inline-end" />
      </Button>

      <p className="text-caption text-muted-foreground">
        {password.trim() ? "The PDF password stays in memory only." : null}
      </p>
    </form>
  );
}
