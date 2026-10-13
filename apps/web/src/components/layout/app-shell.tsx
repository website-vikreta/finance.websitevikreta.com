"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { Navbar } from "./navbar";
import { Sidebar } from "./sidebar";
import { FinanceAIDrawer } from "@/components/chat/finance-ai-drawer";
import { Sparkles, ChevronLeft, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface AppShellProps {
  children: React.ReactNode;
}

/** Min/max chat panel widths in pixels. */
const CHAT_MIN_WIDTH = 300;
const CHAT_MAX_WIDTH = 700;
const CHAT_DEFAULT_WIDTH = 380;

export function AppShell({ children }: AppShellProps) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [financeAIOpen, setFinanceAIOpen] = useState(false);
  const [chatWidth, setChatWidth] = useState(CHAT_DEFAULT_WIDTH);

  // Drag state — kept in refs for performance (no re-renders during drag)
  const isDragging = useRef(false);
  const dragStartX = useRef(0);
  const dragStartWidth = useRef(0);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleExport = () => {
    toast.success("Finance report exported successfully", {
      description: "Downloaded complete CSV audit for current fiscal period.",
    });
  };

  const handleOpenFinanceAI = () => {
    if (typeof window !== "undefined" && window.innerWidth >= 768 && window.innerWidth < 1024) {
      setSidebarCollapsed(true);
    }
    setFinanceAIOpen(true);
  };

  const handleToggleFinanceAI = () => {
    if (!financeAIOpen && typeof window !== "undefined" && window.innerWidth >= 768 && window.innerWidth < 1024) {
      setSidebarCollapsed(true);
    }
    setFinanceAIOpen((v) => !v);
  };

  const [isResizing, setIsResizing] = useState(false);

  // ── Resize handlers ─────────────────────────────────────────────────────
  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      isDragging.current = true;
      setIsResizing(true);
      dragStartX.current = e.clientX;
      dragStartWidth.current = chatWidth;
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    },
    [chatWidth],
  );

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!isDragging.current) return;
    // Dragging left increases the chat panel width (panel is on the right)
    const delta = dragStartX.current - e.clientX;
    const newWidth = Math.min(CHAT_MAX_WIDTH, Math.max(CHAT_MIN_WIDTH, dragStartWidth.current + delta));
    setChatWidth(newWidth);
  }, []);

  const onPointerUp = useCallback(() => {
    isDragging.current = false;
    setIsResizing(false);
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  }, []);

  // Keyboard accessibility: arrow keys to resize
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const step = e.shiftKey ? 50 : 20;
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        setChatWidth((w) => Math.min(CHAT_MAX_WIDTH, w + step));
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        setChatWidth((w) => Math.max(CHAT_MIN_WIDTH, w - step));
      } else if (e.key === "Home") {
        e.preventDefault();
        setChatWidth(CHAT_MIN_WIDTH);
      } else if (e.key === "End") {
        e.preventDefault();
        setChatWidth(CHAT_MAX_WIDTH);
      }
    },
    [],
  );

  // Arrow controls: expand / shrink by 40px
  const onExpandChat = useCallback((e?: React.MouseEvent) => {
    e?.stopPropagation();
    setChatWidth((w) => Math.min(CHAT_MAX_WIDTH, w + 40));
  }, []);

  const onShrinkChat = useCallback((e?: React.MouseEvent) => {
    e?.stopPropagation();
    setChatWidth((w) => Math.max(CHAT_MIN_WIDTH, w - 40));
  }, []);

  const onResetChat = useCallback((e?: React.MouseEvent) => {
    e?.stopPropagation();
    setChatWidth(CHAT_DEFAULT_WIDTH);
  }, []);

  // Clamp chat width on window resize
  useEffect(() => {
    const handleResize = () => {
      if (typeof window === "undefined") return;
      const viewportW = window.innerWidth;
      // On mobile, the panel is full-width overlay — skip clamping
      if (viewportW < 768) return;
      // Ensure panel doesn't exceed 60% of viewport
      const maxAllowed = Math.min(CHAT_MAX_WIDTH, Math.floor(viewportW * 0.6));
      setChatWidth((w) => Math.min(maxAllowed, Math.max(CHAT_MIN_WIDTH, w)));
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  return (
    <div className="flex h-dvh min-h-0 flex-col bg-background font-sans text-foreground">
      {/* Top Navbar */}
      <Navbar
        onToggleSidebar={() => setMobileSidebarOpen((v) => !v)}
        onOpenFinanceAI={handleToggleFinanceAI}
        isFinanceAIOpen={financeAIOpen}
        onExport={handleExport}
      />

      <div ref={containerRef} className="relative flex min-h-0 flex-1 overflow-hidden">
        {/* Left Sidebar */}
        <Sidebar
          collapsed={sidebarCollapsed}
          onToggleCollapse={() => setSidebarCollapsed((v) => !v)}
          isMobileOpen={mobileSidebarOpen}
          onCloseMobile={() => setMobileSidebarOpen(false)}
        />

        {/* Main content automatically resizes beside the docked Finance AI panel */}
        <main
          className={cn(
            "min-w-0 flex-1 overflow-x-hidden overflow-y-auto transition-[padding] duration-200",
            financeAIOpen ? "p-4 md:p-6" : "p-4 md:p-8"
          )}
        >
          <div className="mx-auto max-w-7xl space-y-6">
            {children}
          </div>
        </main>

        {/* Floating "Ask Finance AI" pill at bottom-right */}
        {!financeAIOpen && (
          <button
            onClick={handleOpenFinanceAI}
            id="floating-ask-finance-ai-pill"
            aria-label="Open Finance Chat Bot chat"
            className="fixed bottom-6 right-6 z-30 flex items-center gap-2.5 rounded-full bg-foreground px-4 py-2.5 text-xs font-bold text-background transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <div className="flex size-6 items-center justify-center rounded-full bg-primary text-primary-foreground">
              <Sparkles className="size-3.5 fill-current" />
            </div>
            <span>Ask Finance Chat Bot</span>
          </button>
        )}

        {/* ── Resizable Divider (desktop only, visible when chat panel is open) ── */}
        {financeAIOpen && (
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize chat panel"
            aria-valuenow={chatWidth}
            aria-valuemin={CHAT_MIN_WIDTH}
            aria-valuemax={CHAT_MAX_WIDTH}
            tabIndex={0}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onKeyDown={onKeyDown}
            onDoubleClick={onResetChat}
            className={cn(
              "relative hidden md:flex flex-col items-center justify-center",
              "w-2.5 shrink-0 cursor-col-resize select-none",
              "border-l border-r border-border/40",
              "bg-surface-soft hover:bg-primary/10 active:bg-primary/20",
              "transition-colors duration-150",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
              "group"
            )}
          >
            {/* Drag grip indicators */}
            <div className="flex flex-col items-center gap-1 opacity-30 group-hover:opacity-75 transition-opacity">
              <div className="h-1 w-0.5 rounded-full bg-muted-foreground" />
              <div className="h-1 w-0.5 rounded-full bg-muted-foreground" />
              <div className="h-1 w-0.5 rounded-full bg-muted-foreground" />
              <div className="h-1 w-0.5 rounded-full bg-muted-foreground" />
            </div>

            {/* Simple arrow controls without circular background or dynamic width indicator */}
            <div
              className={cn(
                "absolute z-30 flex flex-col items-center gap-1 transition-opacity duration-150",
                isResizing
                  ? "opacity-100"
                  : "opacity-40 group-hover:opacity-100 hover:!opacity-100"
              )}
            >
              {/* Expand button (Widen chat panel) */}
              <button
                type="button"
                aria-label="Widen chat panel (+40px)"
                onClick={onExpandChat}
                disabled={chatWidth >= CHAT_MAX_WIDTH}
                className="grid size-5 place-items-center rounded-full text-muted-foreground hover:bg-primary/20 hover:text-primary transition-colors disabled:opacity-30 disabled:pointer-events-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                <ChevronLeft className="size-3.5" />
              </button>

              {/* Shrink button (Narrow chat panel) */}
              <button
                type="button"
                aria-label="Narrow chat panel (-40px)"
                onClick={onShrinkChat}
                disabled={chatWidth <= CHAT_MIN_WIDTH}
                className="grid size-5 place-items-center rounded-full text-muted-foreground hover:bg-primary/20 hover:text-primary transition-colors disabled:opacity-30 disabled:pointer-events-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                <ChevronRight className="size-3.5" />
              </button>
            </div>
          </div>
        )}

        {/* Right-docked Finance AI Drawer */}
        <FinanceAIDrawer
          isOpen={financeAIOpen}
          onClose={() => setFinanceAIOpen(false)}
          panelWidth={chatWidth}
        />
      </div>
    </div>
  );
}
