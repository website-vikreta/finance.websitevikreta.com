"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, Building2, ChevronLeft, ChevronRight, FileText, LayoutDashboard, LogOut, Receipt, Settings, Users } from "lucide-react";
import { cn } from "@/lib/utils";

interface SidebarProps {
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  isMobileOpen?: boolean;
  onCloseMobile?: () => void;
}

const navItems = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { label: "Transactions", href: "/transactions", icon: Receipt },
  { label: "Invoices", href: "/invoices", icon: FileText },
  { label: "Clients", href: "/clients", icon: Users },
  { label: "Reports", href: "/reports", icon: BarChart3 },
  { label: "Bank connections", href: "/bank-connections", icon: Building2 },
  { label: "Settings", href: "/settings", icon: Settings },
];

export function Sidebar({ collapsed = false, onToggleCollapse, isMobileOpen = false, onCloseMobile }: SidebarProps) {
  const pathname = usePathname();

  return (
    <>
      {isMobileOpen ? <button type="button" aria-label="Close navigation" onClick={onCloseMobile} className="fixed inset-0 z-40 bg-foreground/40 md:hidden" /> : null}
      <aside className={cn("fixed inset-y-16 z-50 flex flex-col border-r border-border bg-card transition-[width,left] duration-200 md:static md:z-auto", isMobileOpen ? "left-0 w-60" : "-left-60 md:left-0", collapsed ? "md:w-16" : "md:w-60")}>
        <nav className="flex-1 space-y-1 overflow-y-auto p-3" aria-label="Main navigation">
          {navItems.map(({ label, href, icon: Icon }) => {
            const active = pathname === href || (href !== "/dashboard" && pathname.startsWith(href));
            return (
              <Link key={href} href={href} onClick={onCloseMobile} title={collapsed ? label : undefined} className={cn("flex h-10 items-center gap-3 rounded-lg px-3 text-caption transition-colors focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50", active ? "bg-foreground text-background" : "text-muted-foreground hover:bg-accent hover:text-foreground", collapsed && "md:justify-center md:px-0")}>
                <Icon className={cn("size-4 shrink-0", active && "text-primary")} aria-hidden />
                {collapsed ? null : <span className="truncate">{label}</span>}
              </Link>
            );
          })}
        </nav>
        <div className="space-y-1 border-t border-border p-3">
          <button type="button" onClick={onToggleCollapse} className="hidden h-10 w-full items-center justify-center gap-2 rounded-lg text-caption text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 md:flex" aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}>
            {collapsed ? <ChevronRight className="size-4" aria-hidden /> : <><ChevronLeft className="size-4" aria-hidden /><span>Collapse</span></>}
          </button>
          <a href="/api/auth/logout" className={cn("flex h-10 items-center gap-3 rounded-lg px-3 text-caption text-muted-foreground hover:bg-accent hover:text-expense focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50", collapsed && "md:justify-center md:px-0")} title={collapsed ? "Sign out" : undefined}>
            <LogOut className="size-4 shrink-0" aria-hidden />
            {collapsed ? null : <span>Sign out</span>}
          </a>
        </div>
      </aside>
    </>
  );
}
