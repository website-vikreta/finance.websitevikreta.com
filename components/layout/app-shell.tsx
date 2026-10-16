"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { Navbar } from "./navbar";
import { Sidebar } from "./sidebar";
import { FinanceAIDrawer } from "@/components/chat/finance-ai-drawer";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { BotFace } from "@/components/chat/bot-face";
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

  const handleOpenFinanceAI = () => {
    // Docked panel (>=1280px) next to a full sidebar leaves little room below 1536px: fold the sidebar to icons.
    if (typeof window !== "undefined" && window.innerWidth >= 1280 && window.innerWidth < 1536) {
      setSidebarCollapsed(true);
    }
    setFinanceAIOpen(true);
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
      // Below 1280px the panel is an overlay sheet — skip clamping
      if (viewportW < 1280) return;
      // Ensure panel doesn't exceed 60% of viewport
      const maxAllowed = Math.min(CHAT_MAX_WIDTH, Math.floor(viewportW * 0.6));
      setChatWidth((w) => Math.min(maxAllowed, Math.max(CHAT_MIN_WIDTH, w)));
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  return (
    <div className="flex h-dvh min-h-0 flex-col bg-background font-sans text-foreground print:block print:h-auto print:bg-card">
      {/* Top Navbar */}
      <Navbar
        onToggleSidebar={() => setMobileSidebarOpen((v) => !v)}
      />

      <div ref={containerRef} className="relative flex min-h-0 flex-1 overflow-hidden print:block print:overflow-visible">
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
            "min-w-0 flex-1 overflow-x-hidden overflow-y-auto transition-[padding] duration-200 print:overflow-visible print:p-0",
            financeAIOpen ? "p-4 md:p-6" : "p-4 pb-24 md:p-8 md:pb-24" // pb-24 keeps the last row clear of the floating bot
          )}
        >
          <div className="@container mx-auto max-w-7xl space-y-6">
            {children}
          </div>
        </main>

        {/* Floating bot face at bottom-right; blinks and smiles (motion-safe only) */}
        {!financeAIOpen && (
          <button
            type="button"
            onClick={handleOpenFinanceAI}
            aria-label="Open Finance Chat Bot"
            title="Finance Chat Bot"
            className="bot-fab group print:hidden fixed right-4 bottom-4 z-30 grid size-14 place-items-center rounded-full bg-primary text-primary-foreground shadow-md transition-transform hover:scale-105 active:scale-95 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 sm:right-6 sm:bottom-6"
          >
            <BotFace className="size-8" />
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
              "relative hidden xl:flex print:hidden flex-col items-center justify-center",
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
                className="grid size-5 place-items-center rounded-full text-muted-foreground hover:bg-primary/20 hover:text-foreground transition-colors disabled:opacity-30 disabled:pointer-events-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                <ChevronLeft className="size-3.5" />
              </button>

              {/* Shrink button (Narrow chat panel) */}
              <button
                type="button"
                aria-label="Narrow chat panel (-40px)"
                onClick={onShrinkChat}
                disabled={chatWidth <= CHAT_MIN_WIDTH}
                className="grid size-5 place-items-center rounded-full text-muted-foreground hover:bg-primary/20 hover:text-foreground transition-colors disabled:opacity-30 disabled:pointer-events-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
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
