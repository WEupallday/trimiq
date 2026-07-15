import type { Metadata } from "next";
import { Inter } from "next/font/google";
import Script from "next/script";
import "./globals.css";
import Link from "next/link";
import SupportWidget from "@/components/SupportWidget";
import TikTokPixel from "@/components/TikTokPixel";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

const GTM_ID = "GTM-T2MVNBDL";
// Pixel ID from env (swap without a code change), falling back to the
// authoritative Events Manager ID.
const TT_PIXEL_ID = process.env.NEXT_PUBLIC_TIKTOK_PIXEL_ID || "D9BS13JC77UBS5FSCTT0";

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
      {/* TikTok base pixel — injected in the ROOT LAYOUT with beforeInteractive
          so the exact ttq snippet is emitted into the <head> of the served HTML.
          TikTok's "detect base code" scans the page head, so this is the reliable
          install. Loads once + fires the initial PageView; SPA route-change
          PageViews are handled by <TikTokPixel /> below. */}
      <Script id="tiktok-pixel-base" strategy="beforeInteractive">
        {`!function (w, d, t) {
  w.TiktokAnalyticsObject = t;
  var ttq = w[t] = w[t] || [];
  ttq.methods = ["page","track","identify","instances","debug","on","off","once","ready","alias","group","enableCookie","disableCookie","holdConsent","revokeConsent","grantConsent"];
  ttq.setAndDefer = function (t, e) { t[e] = function () { t.push([e].concat(Array.prototype.slice.call(arguments, 0))) } };
  for (var i = 0; i < ttq.methods.length; i++) ttq.setAndDefer(ttq, ttq.methods[i]);
  ttq.instance = function (t) { for (var e = ttq._i[t] || [], n = 0; n < ttq.methods.length; n++) ttq.setAndDefer(e, ttq.methods[n]); return e };
  ttq.load = function (e, n) {
    var r = "https://analytics.tiktok.com/i18n/pixel/events.js", o = n && n.partner;
    ttq._i = ttq._i || {}; ttq._i[e] = []; ttq._i[e]._u = r;
    ttq._t = ttq._t || {}; ttq._t[e] = +new Date;
    ttq._o = ttq._o || {}; ttq._o[e] = n || {};
    n = document.createElement("script"); n.type = "text/javascript"; n.async = !0; n.src = r + "?sdkid=" + e + "&lib=" + t;
    e = document.getElementsByTagName("script")[0]; e.parentNode.insertBefore(n, e)
  };
  ttq.load('${TT_PIXEL_ID}');
  ttq.page();
}(window, document, 'ttq');`}
      </Script>
      {/* Google Tag Manager (kept installed for future tags) */}
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
        <TikTokPixel /> {/* SPA route-change PageViews + ttTrack helper */}
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
