import type { Metadata } from "next";
import { Inter } from "next/font/google";
import Script from "next/script";
import "./globals.css";
import Link from "next/link";
import SupportWidget from "@/components/SupportWidget";
import TikTokPixel from "@/components/TikTokPixel"; // <-- ADDED

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

const GTM_ID = "GTM-T2MVNBDL";

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
      {/* Google Tag Manager */}
      <Script id="gtm-init" strategy="afterInteractive">
        {`(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer','${GTM_ID}');`}
      </Script>
      <body className={`${inter.variable} font-sans bg-ink text-white antialiased`}>
        {/* Google Tag Manager (noscript) */}
        <noscript>
          <iframe
            src={`https://www.googletagmanager.com/ns.html?id=${GTM_ID}`}
            height="0"
            width="0"
            style={{ display: "none", visibility: "hidden" }}
          />
        </noscript>
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
