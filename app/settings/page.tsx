"use client";

import { useState } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { User, Building, Bell, Shield, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

export default function SettingsPage() {
  const [emailAlerts, setEmailAlerts] = useState(true);
  const [overdueAlerts, setOverdueAlerts] = useState(true);

  const handleSave = () => {
    toast.success("Settings saved successfully", {
      description: "Business and profile configuration updated.",
    });
  };

  return (
    <AppShell>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-foreground">
            Settings
          </h1>
          <p className="text-xs text-muted-foreground mt-1">
            Manage your account credentials, business entity information, and alert rules.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Profile Card */}
          <div className="rounded-2xl border border-border bg-card p-6 shadow-xs space-y-4">
            <div className="flex items-center gap-2.5 pb-3 border-b border-border/60">
              <User className="size-4 text-foreground" />
              <h2 className="text-sm font-bold text-foreground">Your Profile</h2>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="text-muted-foreground block mb-1">Full Name</label>
                <input
                  defaultValue="Shubham G."
                  className="w-full rounded-xl border border-border bg-secondary/40 px-3 py-2 text-foreground font-semibold"
                />
              </div>

              <div>
                <label className="text-muted-foreground block mb-1">Email</label>
                <input
                  defaultValue="shubham@websitevikreta.com"
                  disabled
                  className="w-full rounded-xl border border-border bg-secondary/20 px-3 py-2 text-muted-foreground font-mono"
                />
              </div>

              <div>
                <label className="text-muted-foreground block mb-1">Role</label>
                <div className="inline-block rounded-lg bg-neutral-100 px-2.5 py-1 text-[11px] font-bold text-foreground">
                  Finance Administrator / Founder
                </div>
              </div>
            </div>
          </div>

          {/* Business Entity Details Card */}
          <div className="rounded-2xl border border-border bg-card p-6 shadow-xs space-y-4">
            <div className="flex items-center gap-2.5 pb-3 border-b border-border/60">
              <Building className="size-4 text-foreground" />
              <h2 className="text-sm font-bold text-foreground">Business Details</h2>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="text-muted-foreground block mb-1">Legal Entity</label>
                <input
                  defaultValue="Website Vikreta LLP"
                  className="w-full rounded-xl border border-border bg-secondary/40 px-3 py-2 text-foreground font-semibold"
                />
              </div>

              <div>
                <label className="text-muted-foreground block mb-1">GSTIN</label>
                <input
                  defaultValue="27AABCU9603R1ZM"
                  className="w-full rounded-xl border border-border bg-secondary/40 px-3 py-2 text-foreground font-mono font-bold"
                />
              </div>

              <div>
                <label className="text-muted-foreground block mb-1">Registered Address</label>
                <textarea
                  rows={2}
                  defaultValue="Baner Road, Pune, Maharashtra 411045, India"
                  className="w-full rounded-xl border border-border bg-secondary/40 px-3 py-2 text-foreground resize-none"
                />
              </div>
            </div>
          </div>

          {/* Notification Preferences Card */}
          <div className="rounded-2xl border border-border bg-card p-6 shadow-xs space-y-4">
            <div className="flex items-center gap-2.5 pb-3 border-b border-border/60">
              <Bell className="size-4 text-foreground" />
              <h2 className="text-sm font-bold text-foreground">Notifications</h2>
            </div>

            <div className="space-y-4 text-xs">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-semibold text-foreground">Daily Digest Email</p>
                  <p className="text-[11px] text-muted-foreground">Morning summary of receivables</p>
                </div>
                <input
                  type="checkbox"
                  checked={emailAlerts}
                  onChange={(e) => setEmailAlerts(e.target.checked)}
                  className="size-4 accent-[#FFD600]"
                />
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <p className="font-semibold text-foreground">Overdue Alerts</p>
                  <p className="text-[11px] text-muted-foreground">Immediate alert when invoice passes due date</p>
                </div>
                <input
                  type="checkbox"
                  checked={overdueAlerts}
                  onChange={(e) => setOverdueAlerts(e.target.checked)}
                  className="size-4 accent-[#FFD600]"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Team Members Placeholder */}
        <div className="rounded-2xl border border-border bg-card p-6 shadow-xs space-y-3">
          <div className="flex items-center justify-between pb-3 border-b border-border/60">
            <div className="flex items-center gap-2">
              <Users className="size-4 text-foreground" />
              <h2 className="text-sm font-bold text-foreground">Authorized Managers</h2>
            </div>
            <span className="text-xs text-muted-foreground">Internal Access Only</span>
          </div>

          <div className="divide-y divide-border/60 text-xs">
            <div className="py-2.5 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="size-7 rounded-full bg-[#FFD600] flex items-center justify-center font-bold text-[10px]">
                  SG
                </div>
                <div>
                  <span className="font-bold text-foreground">Shubham G.</span>
                  <span className="text-muted-foreground text-[11px] block">shubham@websitevikreta.com</span>
                </div>
              </div>
              <span className="rounded-full bg-neutral-100 px-2.5 py-0.5 text-[10px] font-bold">
                Owner
              </span>
            </div>
          </div>
        </div>

        <div className="flex justify-end pt-2">
          <Button
            onClick={handleSave}
            className="rounded-full bg-black text-white hover:bg-neutral-800 h-9 text-xs font-semibold px-6"
          >
            Save Changes
          </Button>
        </div>
      </div>
    </AppShell>
  );
}
