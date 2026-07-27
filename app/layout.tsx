import type { Metadata } from "next";
import { Inter, Geist_Mono } from "next/font/google";
import "./globals.css";
import HelpChat from "@/components/help-chat";

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

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full bg-zinc-950 text-zinc-100">
        {children}
        <HelpChat />
      </body>
    </html>
  );
}
