"use client";

// ===========================================================================
// TikTok Pixel (browser SPA helper) — TrimIQ
//
//  • The base pixel is injected in the ROOT LAYOUT (app/layout.tsx) with
//    beforeInteractive so it lands in the <head> of the served HTML. This
//    component does NOT inject the base code (that would double-load).
//  • It fires ttq.page() on every client-side App Router navigation (SPA route
//    change), which the head snippet's single initial page() does not cover.
//  • Exports ttTrack() for dedup'd standard events. All ttq calls are guarded.
// ===========================================================================
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef, Suspense } from "react";

declare global {
  interface Window {
    ttq?: any;
    TiktokAnalyticsObject?: string;
  }
}

function RouteChangeTracker() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const firstRun = useRef(true);

  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false; // head snippet already fired the initial page()
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

// -------- Client helper for dedup'd standard events ------------------------
export function ttTrack(
  event: string,
  properties?: Record<string, unknown>,
  event_id?: string
) {
  if (typeof window === "undefined" || !window.ttq || typeof window.ttq.track !== "function") return;
  window.ttq.track(event, properties || {}, event_id ? { event_id } : undefined);
}
