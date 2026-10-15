import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import { ChatSessionProvider } from "@/components/chat/chat-session-provider";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
});

// Icons come from app/favicon.ico, app/icon.svg, app/apple-icon.png and app/opengraph-image.png.
export const metadata: Metadata = {
  metadataBase: new URL("https://finance.websitevikreta.com"),
  title: { default: "Finance | Website Vikreta", template: "%s | Finance | Website Vikreta" },
  description: "Internal income and expense tracker for Website Vikreta managers.",
  applicationName: "Website Vikreta Finance",
  robots: { index: false, follow: false },
  openGraph: { title: "Website Vikreta Finance", description: "Internal income and expense tracker for Website Vikreta managers.", siteName: "Website Vikreta", type: "website" },
};

// White matches the top bar in mobile browser chrome.
export const viewport: Viewport = { themeColor: "#FFFFFF" };

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${jetbrainsMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-background text-foreground">
        <TooltipProvider>
          <ChatSessionProvider>{children}</ChatSessionProvider>
        </TooltipProvider>
        <Toaster theme="light" />
      </body>
    </html>
  );
}
