import { toast } from "sonner";
import { restoreTransactionAction } from "@/app/transactions/actions";

/** Restores a soft-deleted transaction and reports the outcome as a toast. */
export async function restoreWithToast(id: string, title: string) {
  const result = await restoreTransactionAction(id);
  if (result.ok) toast.success(`Restored ${title}`);
  else toast.error(result.error);
}
