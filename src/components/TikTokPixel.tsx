"use client";

// ===========================================================================
// TikTok Pixel (browser) — TrimIQ
//
//  • The base pixel is injected DIRECTLY in code here (NOT via GTM) so the raw
//    page source contains the TikTok base code. TikTok's "detect base code"
//    check scans the served page and does not reliably detect tag-manager
//    installs, so the in-code snippet is the reliable install.
//  • Initializes exactly ONCE (afterInteractive + the snippet's own guard),
//    fires ttq.page() on initial load, and fires ttq.page() again on every
//    client-side App Router navigation (SPA route change).
//  • Pixel ID from NEXT_PUBLIC_TIKTOK_PIXEL_ID (swap without a code change),
//    falling back to the authoritative Events Manager ID.
//  • GTM stays installed (see layout) for future tags; its TikTok tag is
//    PAUSED so there is exactly ONE pixel loader — this one.
// ===========================================================================
import Script from "next/script";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef, Suspense } from "react";

const PIXEL_ID = process.env.NEXT_PUBLIC_TIKTOK_PIXEL_ID || "D9BS13JC77UBS5FSCTT0";

declare global {
  interface Window {
    ttq?: any;
    TiktokAnalyticsObject?: string;
  }
}

// Fire a PageView on every client-side route change (after the first, which the
// base snippet already fired). useSearchParams must be under a Suspense boundary.
function RouteChangeTracker() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const firstRun = useRef(true);

  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false; // don't double-count the initial page()
      return;
    }
    if (typeof window !== "undefined" && window.ttq && typeof window.ttq.page === "function") {
      window.ttq.page();
    }
  }, [pathname, searchParams]);

  return null;
}

export default function TikTokPixel() {
  if (!PIXEL_ID) return null;

  return (
    <>
      {/* Official TikTok base pixel, injected in-code so it's in the page source. */}
      <Script id="tiktok-pixel-base" strategy="afterInteractive">
        {`
!function (w, d, t) {
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
  ttq.load('${PIXEL_ID}');
  ttq.page();
}(window, document, 'ttq');
        `}
      </Script>
      <Suspense fallback={null}>
        <RouteChangeTracker />
      </Suspense>
    </>
  );
}

// -------- Client helper for dedup'd standard events ------------------------
// Fires the browser side of a standard event with a shared event_id so it
// deduplicates against the matching server-side Events API call.
export function ttTrack(
  event: string,
  properties?: Record<string, unknown>,
  event_id?: string
) {
  if (typeof window === "undefined" || !window.ttq || typeof window.ttq.track !== "function") return;
  window.ttq.track(event, properties || {}, event_id ? { event_id } : undefined);
}
