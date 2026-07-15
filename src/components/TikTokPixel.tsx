"use client";

// ===========================================================================
// TikTok Pixel (browser) — TrimIQ
//
//  • Injects the official TikTok base pixel exactly ONCE, globally (mounted in
//    the root layout so it loads on every page).
//  • Initializes the pixel a single time (guarded), then fires ttq.page() on
//    the initial load AND on every client-side App Router navigation
//    (pathname / query change) — TikTok needs a PageView per route change in a
//    single-page app.
//  • No hydration mismatch: the <Script> runs after interactive, and the
//    route-change effect is client-only.
//  • Pixel ID comes from NEXT_PUBLIC_TIKTOK_PIXEL_ID so it is swappable without
//    a code change (falls back to the authoritative Events Manager ID).
// ===========================================================================
import Script from "next/script";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef, Suspense } from "react";

const PIXEL_ID = process.env.NEXT_PUBLIC_TIKTOK_PIXEL_ID || "D9BFVS3C77U7PB56R3N0";

declare global {
  interface Window {
    ttq?: any;
    TiktokAnalyticsObject?: string;
  }
}

// Fire a PageView on every route change (after the first, which the base
// snippet's own ttq.page() already covers). useSearchParams must live under a
// Suspense boundary in the App Router.
function RouteChangeTracker() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const firstRun = useRef(true);

  useEffect(() => {
    if (firstRun.current) {
      // The base snippet already calls ttq.page() on initial load — don't
      // double-count it.
      firstRun.current = false;
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
      {/* Official TikTok base pixel. `afterInteractive` + the id guard means it
          initializes exactly once, even across fast refreshes. */}
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

// -------- Client helpers for dedup'd standard events -----------------------
// Fire the browser side of a standard event with a shared event_id so it
// deduplicates against the matching server-side Events API call.
export function ttTrack(
  event: string,
  properties?: Record<string, unknown>,
  event_id?: string
) {
  if (typeof window === "undefined" || !window.ttq || typeof window.ttq.track !== "function") return;
  window.ttq.track(event, properties || {}, event_id ? { event_id } : undefined);
}
