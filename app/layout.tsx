import type { Metadata } from "next";
import { Inter, Geist_Mono } from "next/font/google";
import "./globals.css";
import HelpChat from "@/components/help-chat";
import { isPublicViewer } from "@/lib/demo/viewer";

// Inter is the rebrand's UI face (see the "New design system" block in
// globals.css). Geist Mono stays the monospace face — code blocks, SHAs and
// branch names across the app still use font-mono.
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Loop Dashboard",
  description: "Control room for autonomous improvement loops.",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // The help assistant POSTs to /api/assistant, an LLM route the proxy
  // hard-blocks for anonymous callers (see lib/public-access.ts) — a chat
  // bubble that errors on every message is worse than no bubble. This is the
  // root layout, so it also renders for /login; isPublicViewer() there is
  // moot (the pathname check inside HelpChat already hides it), but skipping
  // the render here is the smallest change that keeps demo visitors from
  // ever seeing it anywhere in the app.
  const demoMode = await isPublicViewer();

  return (
    <html
      lang="en"
      className={`${inter.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full bg-zinc-950 text-zinc-100">
        {children}
        {!demoMode && <HelpChat />}
      </body>
    </html>
  );
}
