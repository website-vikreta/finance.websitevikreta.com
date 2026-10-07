// Demo dashboard with hard-coded data. Shows the DESIGN.md system in one place.
// Replace with the real F8 dashboard once data exists.
import {
  ArrowDownRight,
  ArrowUpRight,
  LayoutDashboard,
  ListOrdered,
  MessageSquare,
  Plus,
  ScrollText,
  Search,
  Settings,
} from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatMoney } from "@/lib/money";

const nav = [
  { label: "Dashboard", icon: LayoutDashboard, active: true },
  { label: "Transactions", icon: ListOrdered },
  { label: "Chat entry", icon: MessageSquare },
  { label: "Audit log", icon: ScrollText },
  { label: "Settings", icon: Settings },
];

// Amounts in paise.
const kpis = [
  { label: "Income this month", value: 1_245_000_00, delta: "+12.4%", up: true },
  { label: "Expenses this month", value: 486_250_00, delta: "+3.1%", up: false },
  { label: "Net", value: 758_750_00, delta: "+18.9%", up: true },
  { label: "Received in USD (INR)", value: 640_000_00, delta: "+8.2%", up: true },
];

const months = [
  { m: "May", income: 82, expense: 41 },
  { m: "Jun", income: 95, expense: 44 },
  { m: "Jul", income: 71, expense: 52 },
  { m: "Aug", income: 108, expense: 47 },
  { m: "Sep", income: 111, expense: 49 },
  { m: "Oct", income: 124, expense: 48 },
];
const maxMonth = Math.max(...months.map((d) => d.income));

const categories = [
  { name: "Salaries", value: 280_000_00 },
  { name: "Software", value: 92_400_00 },
  { name: "Rent", value: 65_000_00 },
  { name: "Ads", value: 31_850_00 },
  { name: "Other", value: 17_000_00 },
];
const maxCategory = categories[0].value;

const transactions = [
  { date: "07 Oct", desc: "Acme Corp, website retainer", cat: "Client payment", type: "income", amount: 8_500_00, usd: "USD 100 at ₹85.00", source: "manual" },
  { date: "06 Oct", desc: "Figma seats", cat: "Software", type: "expense", amount: 12_400_00, source: "chatbot" },
  { date: "05 Oct", desc: "Office rent, October", cat: "Rent", type: "expense", amount: 65_000_00, source: "manual" },
  { date: "03 Oct", desc: "Northwind, SEO project", cat: "Client payment", type: "income", amount: 2_10_000_00, usd: "USD 2,500 at ₹84.00", source: "manual", manualRate: true },
  { date: "01 Oct", desc: "Google Ads", cat: "Ads", type: "expense", amount: 31_850_00, source: "chatbot" },
];

export default function DemoDashboard() {
  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-60 shrink-0 flex-col border-r bg-background md:flex">
        <div className="flex h-16 items-center gap-2 border-b px-6">
          <span className="size-6 rounded-md bg-primary" aria-hidden />
          <span className="text-title-sm text-foreground">Finance</span>
        </div>
        <nav className="flex flex-col gap-1 p-3">
          {nav.map(({ label, icon: Icon, active }) => (
            <a
              key={label}
              href="#"
              aria-current={active ? "page" : undefined}
              className={
                active
                  ? "flex items-center gap-3 rounded-md bg-card px-3 py-2 text-sm font-medium text-primary"
                  : "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
              }
            >
              <Icon className="size-4" />
              {label}
            </a>
          ))}
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 items-center gap-4 border-b bg-background px-4 md:px-8">
          <div className="relative w-full max-w-sm">
            <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input placeholder="Search transactions" className="pl-9" aria-label="Search transactions" />
          </div>
          <div className="ml-auto flex items-center gap-3">
            <Badge variant="outline">Admin</Badge>
            <Avatar>
              <AvatarFallback>VG</AvatarFallback>
            </Avatar>
          </div>
        </header>

        <main className="mx-auto flex w-full max-w-[1280px] flex-col gap-8 px-4 py-8 md:px-8">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-eyebrow text-muted-foreground uppercase">October 2026</p>
              <h1 className="text-display-sm md:text-display-md">Dashboard</h1>
            </div>
            <div className="flex items-center gap-3">
              <Tabs defaultValue="month">
                <TabsList>
                  <TabsTrigger value="month">Month</TabsTrigger>
                  <TabsTrigger value="quarter">Quarter</TabsTrigger>
                  <TabsTrigger value="year">Year</TabsTrigger>
                </TabsList>
              </Tabs>
              <Button>
                <Plus /> Add entry
              </Button>
            </div>
          </div>

          <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {kpis.map((k) => (
              <Card key={k.label} className="[--card-spacing:--spacing(6)]">
                <CardContent className="flex flex-col gap-3">
                  <p className="text-eyebrow text-muted-foreground uppercase">{k.label}</p>
                  <p className="text-display-sm text-primary tabular-nums">{formatMoney(k.value).replace(/\.00$/, "")}</p>
                  <p className={`flex items-center gap-1 text-caption ${k.up ? "text-income" : "text-expense"}`}>
                    {k.up ? <ArrowUpRight className="size-4" /> : <ArrowDownRight className="size-4" />}
                    {k.delta} <span className="text-muted-foreground">vs last month</span>
                  </p>
                </CardContent>
              </Card>
            ))}
          </section>

          <section className="grid gap-4 lg:grid-cols-3">
            <Card className="[--card-spacing:--spacing(6)] lg:col-span-2">
              <CardHeader>
                <CardTitle className="text-title-md">Income vs expenses</CardTitle>
                <CardDescription>Last 6 months, in ₹ lakh</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex h-56 items-end gap-4 border-b pb-px">
                  {months.map((d) => (
                    <div key={d.m} className="flex h-full flex-1 items-end justify-center gap-1">
                      <div
                        className="w-full max-w-6 rounded-t-sm bg-income"
                        style={{ height: `${(d.income / maxMonth) * 100}%` }}
                        title={`${d.m} income ₹${d.income}L`}
                      />
                      <div
                        className="w-full max-w-6 rounded-t-sm bg-expense"
                        style={{ height: `${(d.expense / maxMonth) * 100}%` }}
                        title={`${d.m} expenses ₹${d.expense}L`}
                      />
                    </div>
                  ))}
                </div>
                <div className="mt-2 flex gap-4">
                  {months.map((d) => (
                    <span key={d.m} className="flex-1 text-center text-caption text-muted-foreground">
                      {d.m}
                    </span>
                  ))}
                </div>
                <div className="mt-4 flex gap-6 text-caption">
                  <span className="flex items-center gap-2"><span className="size-2.5 rounded-sm bg-income" />Income</span>
                  <span className="flex items-center gap-2"><span className="size-2.5 rounded-sm bg-expense" />Expenses</span>
                </div>
              </CardContent>
            </Card>

            <Card className="[--card-spacing:--spacing(6)]">
              <CardHeader>
                <CardTitle className="text-title-md">Spend by category</CardTitle>
                <CardDescription>October</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                {categories.map((c, i) => (
                  <div key={c.name} className="flex flex-col gap-1.5">
                    <div className="flex justify-between text-body-sm">
                      <span>{c.name}</span>
                      <span className="text-body-strong tabular-nums">{formatMoney(c.value)}</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-surface-elevated">
                      <div
                        className={`h-full rounded-full ${i === 0 ? "bg-chart-1" : "bg-chart-3"}`}
                        style={{ width: `${(c.value / maxCategory) * 100}%` }}
                      />
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          </section>

          <Card className="[--card-spacing:--spacing(6)]">
            <CardHeader>
              <CardTitle className="text-title-md">Recent transactions</CardTitle>
              <CardDescription>Amounts in INR. USD entries show the rate saved with them.</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>Source</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {transactions.map((t) => (
                    <TableRow key={t.desc}>
                      <TableCell className="text-muted-foreground">{t.date}</TableCell>
                      <TableCell className="text-body-strong">{t.desc}</TableCell>
                      <TableCell>
                        <Badge variant="secondary">{t.cat}</Badge>
                      </TableCell>
                      <TableCell>
                        {t.source === "chatbot" ? <Badge variant="outline">chatbot</Badge> : <span className="text-muted-foreground">manual</span>}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className={`tabular-nums font-medium ${t.type === "income" ? "text-income" : "text-expense"}`}>
                          {t.type === "income" ? "+" : "−"}
                          {formatMoney(t.amount)}
                        </div>
                        {t.usd && (
                          <div className={`font-mono text-caption ${t.manualRate ? "text-warning" : "text-muted-foreground"}`}>
                            {t.usd}{t.manualRate && " · manual rate"}
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <section className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            <Card className="[--card-spacing:--spacing(6)]">
              <CardHeader>
                <CardTitle className="text-title-md">Quick entry</CardTitle>
                <CardDescription>Form controls</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="amount">Amount</Label>
                  <Input id="amount" placeholder="8,500" inputMode="decimal" />
                </div>
                <div className="flex flex-col gap-2">
                  <Label>Currency</Label>
                  <Select defaultValue="INR" items={[{ value: "INR", label: "INR" }, { value: "USD", label: "USD" }]}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="INR">INR</SelectItem>
                      <SelectItem value="USD">USD</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center justify-between">
                  <Label htmlFor="recurring">Recurring monthly</Label>
                  <Switch id="recurring" />
                </div>
                <div className="flex gap-3">
                  <Button variant="secondary" className="flex-1">Cancel</Button>
                  <Button variant="outline" className="flex-1">Save draft</Button>
                </div>
              </CardContent>
            </Card>

            <Card className="[--card-spacing:--spacing(6)]">
              <CardHeader>
                <CardTitle className="text-title-md">Audit entry</CardTitle>
                <CardDescription>Code window card</CardDescription>
              </CardHeader>
              <CardContent>
                <pre className="overflow-x-auto rounded-lg bg-surface-soft p-4 font-mono text-code text-body">
{`txn_8f3a21  edited by VG
  amount   ₹8,000.00 → ₹8,500.00
  rate     84.50 → 85.00
  at       07 Oct 2026, 14:32`}
                </pre>
              </CardContent>
            </Card>

            <Card className="[--card-spacing:--spacing(6)]">
              <CardHeader>
                <CardTitle className="text-title-md">States</CardTitle>
                <CardDescription>Badges, loading, empty</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <div className="flex flex-wrap gap-2">
                  <Badge className="text-eyebrow uppercase">New</Badge>
                  <Badge variant="secondary">Software</Badge>
                  <Badge variant="outline">chatbot</Badge>
                  <Badge variant="destructive">Deleted</Badge>
                </div>
                <Separator />
                <div className="flex flex-col gap-2">
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-4 w-1/2" />
                </div>
                <Separator />
                <p className="text-body-sm text-muted-foreground">No entries for this filter. Change the date range or add one.</p>
              </CardContent>
            </Card>
          </section>
        </main>
      </div>
    </div>
  );
}
