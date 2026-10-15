import Link from "next/link";
import { AppShell } from "@/components/layout/app-shell";
import { buttonVariants } from "@/components/ui/button";

export default function NotFound() {
  return (
    <AppShell>
      <section className="rounded-xl border border-border bg-card p-6 md:p-8">
        <h1 className="text-title-lg">Page not found</h1>
        <Link href="/dashboard" className={buttonVariants({ variant: "outline", className: "mt-6" })}>
          Back to dashboard
        </Link>
      </section>
    </AppShell>
  );
}
