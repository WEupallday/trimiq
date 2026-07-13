"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import AccountSettings from "@/components/AccountSettings";
import LogoutButton from "@/components/LogoutButton";

// Standard top-right profile avatar: a silhouette circle that opens the
// account panel (username, email, TikTok handle, plan) on click.
export default function ProfileMenu({
  username,
  email,
  tiktok,
  planLabel,
  admin,
}: {
  username: string;
  email: string;
  tiktok: string;
  planLabel: string;
  admin: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label="Account"
        title="Account"
        className="flex h-9 w-9 items-center justify-center rounded-full border border-white/15 bg-white/[0.06] text-white/70 transition hover:border-white/30 hover:text-white"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M12 12a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9Zm0 2.25c-4.14 0-7.5 2.52-7.5 5.63 0 .62.5 1.12 1.13 1.12h12.74c.63 0 1.13-.5 1.13-1.12 0-3.11-3.36-5.63-7.5-5.63Z" />
        </svg>
      </button>

      {open && (
        <div className="absolute right-0 top-11 z-50 w-80 rounded-2xl border border-white/10 bg-ink/95 p-4 shadow-2xl backdrop-blur">
          <div className="mb-3 flex items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-fuchsia-500 text-sm font-bold text-white">
              {(username || email || "U").slice(0, 1).toUpperCase()}
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{username || "Set a username"}</p>
              <p className="truncate text-xs text-white/40">{email}</p>
            </div>
          </div>
          <div className="mb-3 flex flex-wrap gap-2 text-xs">
            <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-white/70">{planLabel}</span>
            {tiktok && (
              <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-white/70">TikTok @{tiktok}</span>
            )}
          </div>
          <AccountSettings currentUsername={username} email={email} currentTiktok={tiktok} />
          <div className="mt-3 flex items-center justify-between border-t border-white/10 pt-2">
            {admin ? (
              <Link
                href="/admin"
                className="rounded-lg px-2 py-1 text-xs font-medium text-indigo-200 transition hover:bg-indigo-500/10"
              >
                Admin
              </Link>
            ) : (
              <span />
            )}
            <LogoutButton />
          </div>
        </div>
      )}
    </div>
  );
}
