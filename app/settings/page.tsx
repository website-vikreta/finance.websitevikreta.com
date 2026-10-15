import { Suspense } from "react";
import { eq } from "drizzle-orm";
import { Download, LogOut } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { PageHeader } from "@/components/layout/page-header";
import { buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { db } from "@/lib/db";
import { appUsers } from "@/lib/db/schema";
import { requireAuthAction } from "@/lib/server-auth";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1 py-3 sm:flex-row sm:items-center sm:justify-between">
      <dt className="text-body-sm text-muted-foreground">{label}</dt>
      <dd className="text-body-sm text-foreground">{children}</dd>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-border bg-card p-6">
      <h2 className="text-title-md">{title}</h2>
      <dl className="mt-3 divide-y divide-border">{children}</dl>
    </section>
  );
}

async function Account() {
  const auth = await requireAuthAction();
  if (!auth.ok) return null; // proxy.ts already redirects signed-out visitors

  const { userId, exp } = auth.session;
  const [user] = await db.select().from(appUsers).where(eq(appUsers.id, userId)).limit(1);
  const expires = exp
    ? new Date(exp * 1000).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" })
    : null;

  return (
    <Card title="Account">
      <Row label="Email">{user?.email ?? "Not set"}</Row>
      <Row label="Role">
        <span className="capitalize">{user?.role ?? "manager"}</span>
      </Row>
      <Row label="Status">{user?.isActive === false ? "Inactive" : "Active"}</Row>
      {expires ? <Row label="Session expires">{expires} IST</Row> : null}
    </Card>
  );
}

export default function SettingsPage() {
  return (
    <AppShell>
      <PageHeader title="Settings" description="Your account and how the ledger is set up." />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Suspense fallback={<Skeleton className="h-64 rounded-xl" />}>
          <Account />
        </Suspense>

        <Card title="Ledger">
          <Row label="Base currency">INR</Row>
          <Row label="Accepted currencies">INR, USD (rate entered per transaction)</Row>
          <Row label="Financial year">1 April to 31 March</Row>
          <Row label="Entry">Finance AI, confirmed before saving</Row>
        </Card>
      </div>

      <section className="flex flex-col gap-4 rounded-xl border border-border bg-card p-6 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-title-md">Data and session</h2>
          <p className="mt-1 text-body-sm text-muted-foreground">Download every confirmed transaction, or sign out of this device.</p>
        </div>
        <div className="flex flex-wrap gap-3">
          <a href="/api/reports/export?period=all" className={buttonVariants({ variant: "outline" })}>
            <Download aria-hidden />
            Export all (CSV)
          </a>
          <a href="/api/auth/logout" className={buttonVariants({ variant: "outline" })}>
            <LogOut aria-hidden />
            Sign out
          </a>
        </div>
      </section>
    </AppShell>
  );
}
