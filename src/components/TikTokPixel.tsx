"use client";

// ===========================================================================
// TikTok Pixel (browser) — TrimIQ
//
//  • The TikTok base pixel is now loaded by Google Tag Manager (container
//    GTM-T2MVNBDL, tag "TT-D9BOMKJC77U7PB56RM50-Web-Tag-Pixel_Setup",
//    trigger: All Pages). This component no longer injects the base code —
//    injecting it here as well would double-load the pixel.
//  • It still fires ttq.page() on every client-side App Router navigation
//    (pathname / query change), because the GTM-loaded base code only fires
//    the initial PageView per full page load.
//  • It also exports the ttTrack() helper used across the app for dedup'd
//    standard events. All ttq calls are guarded, so nothing breaks if GTM or
//    the pixel script is blocked or hasn't loaded yet.
// ===========================================================================
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef, Suspense } from "react";

declare global {
  interface Window {
    ttq?: any;
    TiktokAnalyticsObject?: string;
  }
}

// Fire a PageView on every route change (after the first, which the GTM-loaded
// base snippet's own ttq.page() already covers). useSearchParams must live
// under a Suspense boundary in the App Router.
function RouteChangeTracker() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const firstRun = useRef(true);

  useEffect(() => {
    if (firstRun.current) {
      // The GTM-loaded base snippet already calls ttq.page() on initial load —
      // don't double-count it.
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
  return (
    <Suspense fallback={null}>
      <RouteChangeTracker />
    </Suspense>
  );
}

// -------- Client helpers for dedup'd standard events -----------------------
// Fire the browser side of a standard event with a shared event_id so it
// deduplicates against the matching server-side Events API call. The pixel
// itself is loaded by GTM; window.ttq is the same queue either way.
export function ttTrack(
  event: string,
  properties?: Record<string, unknown>,
  event_id?: string
) {
  if (typeof window === "undefined" || !window.ttq || typeof window.ttq.track !== "function") return;
  window.ttq.track(event, properties || {}, event_id ? { event_id } : undefined);
}
