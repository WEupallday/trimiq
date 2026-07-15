import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import Link from "next/link";
import SupportWidget from "@/components/SupportWidget";
import TikTokPixel from "@/components/TikTokPixel"; // <-- ADDED

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

export const metadata: Metadata = {
  title: "TrimIQ — Turn raw clips into publish-ready videos",
  description:
    "TrimIQ automatically removes dead space, long pauses, filler words, and bad takes from your videos - then adds captions and smart zooms. Upload, click once, download an edit ready for TikTok, Reels & Shorts.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${inter.variable} font-sans bg-ink text-white antialiased`}>
        <TikTokPixel /> {/* <-- ADDED: loads globally, inits once, fires page() on route changes */}
        {children}
        <footer className="relative z-10 border-t border-white/10 px-6 py-6 text-center text-xs text-white/35">
          <span>© {new Date().getFullYear()} TrimIQ</span>
          <span className="mx-2 text-white/20">·</span>
          <Link href="/terms" className="transition hover:text-white/70">Terms of Service</Link>
          <span className="mx-2 text-white/20">·</span>
          <Link href="/privacy" className="transition hover:text-white/70">Privacy Policy</Link>
        </footer>
        <SupportWidget />
      </body>
    </html>
  );
}
