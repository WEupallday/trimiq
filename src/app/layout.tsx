import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

export const metadata: Metadata = {
  title: "TrimIQ — Turn raw clips into publish-ready videos",
  description:
    "TrimIQ uses AI to automatically remove dead space, long pauses, and bad takes from your TikTok Shop videos. Upload, click once, download a clean edit.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${inter.variable} font-sans bg-ink text-white antialiased`}>
        {children}
      </body>
    </html>
  );
}
