"use client";

import { useState } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { INVOICES, type Invoice } from "@/lib/mock-data";
import { formatINR, STATUS_CONFIG } from "@/lib/format";
import {
  Plus,
  Send,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

export default function InvoicesPage() {
  const [tab, setTab] = useState<"all" | "paid" | "due" | "overdue">("all");
  const [invoices, setInvoices] = useState<Invoice[]>(INVOICES);
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);

  // New Invoice Form State
  const [newClient, setNewClient] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [newAmount, setNewAmount] = useState("");
  const [newDueDate, setNewDueDate] = useState("2026-10-25");

  const filtered = invoices.filter((inv) => {
    if (tab === "all") return true;
    return inv.status === tab;
  });

  const handleCreateInvoice = (e: React.FormEvent) => {
    e.preventDefault();
    const subtotal = Number(newAmount) || 50000;
    const gstAmount = Math.round(subtotal * 0.18);
    const totalAmount = subtotal + gstAmount;

    const newInv: Invoice = {
      id: "inv-" + Date.now(),
      invoiceNumber: `INV-2026-${Math.floor(100 + Math.random() * 900)}`,
      clientName: newClient || "New Client",
      clientEmail: "billing@client.com",
      issueDate: "10 Oct 2026",
      dueDate: newDueDate,
      subtotal,
      gstRate: 18,
      gstAmount,
      totalAmount,
      status: "due",
      items: [
        {
          description: newDesc || "Agency Development Services",
          quantity: 1,
          rate: subtotal,
          amount: subtotal,
        },
      ],
    };

    setInvoices([newInv, ...invoices]);
    setIsCreateOpen(false);
    setNewClient("");
    setNewDesc("");
    setNewAmount("");
    toast.success("Invoice created successfully!", {
      description: `${newInv.invoiceNumber} for ${formatINR(totalAmount)} generated.`,
    });
  };

  const handleMarkPaid = (id: string) => {
    setInvoices((prev) =>
      prev.map((inv) => (inv.id === id ? { ...inv, status: "paid" } : inv))
    );
    if (selectedInvoice && selectedInvoice.id === id) {
      setSelectedInvoice((prev) => prev ? { ...prev, status: "paid" } : null);
    }
    toast.success("Invoice updated", {
      description: "Marked as Paid. Books reconciled.",
    });
  };

  return (
    <AppShell>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight text-foreground">
              Invoices
            </h1>
            <p className="text-xs text-muted-foreground mt-1">
              Client billing, GST tax breakdowns, and payment status tracking.
            </p>
          </div>

          <Button
            onClick={() => setIsCreateOpen(true)}
            className="rounded-full bg-black text-white hover:bg-neutral-800 gap-2 h-9 text-xs font-semibold px-4"
          >
            <Plus className="size-3.5 text-[#FFD600]" />
            <span>Create Invoice</span>
          </Button>
        </div>

        {/* Status Tabs */}
        <div className="flex items-center gap-1.5 p-1 rounded-xl bg-card border border-border w-fit shadow-xs">
          {(["all", "paid", "due", "overdue"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-3.5 py-1.5 text-xs font-semibold rounded-lg capitalize transition-all ${
                tab === t
                  ? "bg-black text-white shadow-2xs"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {t} ({invoices.filter((i) => t === "all" || i.status === t).length})
            </button>
          ))}
        </div>

        {/* Invoice List */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((inv) => {
            const statusConfig = STATUS_CONFIG[inv.status];
            return (
              <div
                key={inv.id}
                onClick={() => setSelectedInvoice(inv)}
                className="flex flex-col justify-between rounded-2xl border border-border bg-card p-5 shadow-xs hover:border-neutral-300 hover:shadow-sm transition-all cursor-pointer group"
              >
                <div>
                  <div className="flex items-center justify-between pb-3 border-b border-border/40">
                    <span className="font-mono text-xs font-bold text-foreground">
                      {inv.invoiceNumber}
                    </span>
                    <span
                      className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold border ${statusConfig.bgClass}`}
                    >
                      {statusConfig.label}
                    </span>
                  </div>

                  <div className="mt-3">
                    <h3 className="font-bold text-sm text-foreground group-hover:text-black">
                      {inv.clientName}
                    </h3>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Due {inv.dueDate}
                    </p>
                  </div>
                </div>

                <div className="mt-6 flex items-baseline justify-between pt-3 border-t border-border/40">
                  <span className="text-[10px] font-bold text-muted-foreground uppercase">
                    Total (inc. GST)
                  </span>
                  <span className="text-base font-extrabold text-foreground font-mono">
                    {formatINR(inv.totalAmount)}
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        {/* Detail Modal / Drawer */}
        {selectedInvoice && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4">
            <div className="w-full max-w-lg rounded-2xl border border-border bg-card p-6 shadow-2xl relative space-y-5 animate-in fade-in zoom-in-95">
              <div className="flex items-start justify-between border-b border-border/60 pb-3">
                <div>
                  <span className="text-[10px] font-bold text-muted-foreground uppercase">
                    Invoice Details
                  </span>
                  <h2 className="text-lg font-bold text-foreground">
                    {selectedInvoice.invoiceNumber}
                  </h2>
                </div>
                <button
                  onClick={() => setSelectedInvoice(null)}
                  className="rounded-lg p-1.5 text-muted-foreground hover:bg-secondary"
                >
                  <X className="size-4" />
                </button>
              </div>

              <div className="grid grid-cols-2 gap-4 text-xs">
                <div>
                  <span className="text-muted-foreground">Billed To:</span>
                  <p className="font-bold text-foreground mt-0.5">
                    {selectedInvoice.clientName}
                  </p>
                  <p className="text-muted-foreground">
                    {selectedInvoice.clientEmail}
                  </p>
                  {selectedInvoice.clientGst && (
                    <p className="text-neutral-500 text-[11px] mt-0.5">
                      GSTIN: {selectedInvoice.clientGst}
                    </p>
                  )}
                </div>
                <div className="text-right">
                  <span className="text-muted-foreground">Dates:</span>
                  <p className="text-foreground mt-0.5">
                    Issued: {selectedInvoice.issueDate}
                  </p>
                  <p className="font-semibold text-foreground">
                    Due: {selectedInvoice.dueDate}
                  </p>
                </div>
              </div>

              {/* Items */}
              <div className="rounded-xl border border-border bg-secondary/30 p-3 space-y-2">
                <span className="text-[10px] font-bold uppercase text-muted-foreground">
                  Line Items
                </span>
                {selectedInvoice.items.map((item, idx) => (
                  <div
                    key={idx}
                    className="flex justify-between text-xs py-1 border-b border-border/40 last:border-0"
                  >
                    <span>{item.description}</span>
                    <span className="font-mono font-semibold">
                      {formatINR(item.amount)}
                    </span>
                  </div>
                ))}
              </div>

              {/* Summary */}
              <div className="space-y-1 text-xs text-right pt-2 border-t border-border">
                <div className="flex justify-between text-muted-foreground">
                  <span>Subtotal</span>
                  <span>{formatINR(selectedInvoice.subtotal)}</span>
                </div>
                <div className="flex justify-between text-muted-foreground">
                  <span>GST ({selectedInvoice.gstRate}%)</span>
                  <span>{formatINR(selectedInvoice.gstAmount)}</span>
                </div>
                <div className="flex justify-between text-sm font-extrabold text-foreground pt-1 border-t border-border/60">
                  <span>Grand Total</span>
                  <span className="font-mono text-base">
                    {formatINR(selectedInvoice.totalAmount)}
                  </span>
                </div>
              </div>

              {/* Actions */}
              <div className="flex items-center justify-end gap-2 pt-3">
                {selectedInvoice.status !== "paid" && (
                  <Button
                    onClick={() => handleMarkPaid(selectedInvoice.id)}
                    className="h-8 text-xs rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white"
                  >
                    Mark as Paid
                  </Button>
                )}
                <Button
                  variant="outline"
                  onClick={() => {
                    toast.success("Invoice sent to client email");
                    setSelectedInvoice(null);
                  }}
                  className="h-8 text-xs rounded-xl"
                >
                  <Send className="size-3 mr-1.5" />
                  Send to Client
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Create Invoice Modal */}
        {isCreateOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4">
            <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-2xl space-y-4 animate-in fade-in zoom-in-95">
              <div className="flex items-center justify-between border-b border-border/60 pb-3">
                <h2 className="text-base font-bold text-foreground">
                  Create New Client Invoice
                </h2>
                <button
                  onClick={() => setIsCreateOpen(false)}
                  className="rounded-lg p-1 text-muted-foreground hover:bg-secondary"
                >
                  <X className="size-4" />
                </button>
              </div>

              <form onSubmit={handleCreateInvoice} className="space-y-3.5 text-xs">
                <div>
                  <label className="font-semibold text-foreground block mb-1">
                    Client Name
                  </label>
                  <input
                    required
                    value={newClient}
                    onChange={(e) => setNewClient(e.target.value)}
                    placeholder="e.g. PixelCraft or Northstar Labs"
                    className="w-full rounded-xl border border-border bg-secondary/40 px-3 py-2 text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </div>

                <div>
                  <label className="font-semibold text-foreground block mb-1">
                    Project / Milestone Description
                  </label>
                  <input
                    required
                    value={newDesc}
                    onChange={(e) => setNewDesc(e.target.value)}
                    placeholder="e.g. Website Retainer or AI Automation Sprint"
                    className="w-full rounded-xl border border-border bg-secondary/40 px-3 py-2 text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="font-semibold text-foreground block mb-1">
                      Subtotal (₹)
                    </label>
                    <input
                      required
                      type="number"
                      value={newAmount}
                      onChange={(e) => setNewAmount(e.target.value)}
                      placeholder="84000"
                      className="w-full rounded-xl border border-border bg-secondary/40 px-3 py-2 text-foreground focus:outline-none focus:ring-1 focus:ring-primary font-mono"
                    />
                  </div>
                  <div>
                    <label className="font-semibold text-foreground block mb-1">
                      Due Date
                    </label>
                    <input
                      required
                      type="date"
                      value={newDueDate}
                      onChange={(e) => setNewDueDate(e.target.value)}
                      className="w-full rounded-xl border border-border bg-secondary/40 px-3 py-2 text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                  </div>
                </div>

                <div className="rounded-xl bg-secondary/60 p-2.5 text-[11px] text-muted-foreground border border-border/80">
                  GST of 18% is automatically computed on the invoice subtotal for verified Indian corporate clients.
                </div>

                <div className="flex justify-end gap-2 pt-2 border-t border-border">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setIsCreateOpen(false)}
                    className="h-8 text-xs rounded-xl"
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    className="h-8 text-xs rounded-xl bg-black text-white hover:bg-neutral-800"
                  >
                    Generate Invoice
                  </Button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}
