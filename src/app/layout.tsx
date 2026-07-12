import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import SupportWidget from "@/components/SupportWidget";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

export const metadata: Metadata = {
  title: "TrimIQ — Turn raw clips into publish-ready videos",
  description:
    "TrimIQ automatically removes dead space, long pauses, filler words, and bad takes from your videos - then adds captions and smart zooms. Upload, click once, download a TikTok-ready edit.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${inter.variable} font-sans bg-ink text-white antialiased`}>
        {children}
        <SupportWidget />
      </body>
    </html>
  );
}
