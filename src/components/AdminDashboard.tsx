"use client";

import { useCallback, useEffect, useState } from "react";

const PLAN_OPTIONS = ["free", "starter", "pro", "unlimited"];

function fmtDate(iso: string) {
  try {
    return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  } catch {
    return iso;
  }
}

function fmtPrice(a: number | null | undefined) {
  return a === null || a === undefined ? "—" : `$${a}`;
}

function fmtMoney(n: number | null | undefined) {
  const v = Number(n) || 0;
  return "$" + v.toLocaleString("en-US", { minimumFractionDigits: Number.isInteger(v) ? 0 : 2, maximumFractionDigits: 2 });
}

export default function AdminDashboard({ data: initialData }: { data: any }) {
  const [data, setData] = useState<any>(initialData);
  const [q, setQ] = useState("");
  const [cbOnly, setCbOnly] = useState(false);
  const [busyId, setBusyId] = useState("");
  const [testMsg, setTestMsg] = useState("");
  const [updatedAt, setUpdatedAt] = useState<string>("");
  const s = data.stats;
  const r = data.revenue || {};

  // Pull the latest admin data (used by both the 30s auto-refresh and actions).
  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/process?admin=data", { cache: "no-store" });
      if (!res.ok) return;
      const d = await res.json();
      setData(d);
      setUpdatedAt(new Date().toLocaleTimeString());
    } catch {
      /* keep showing the last good data */
    }
  }, []);

  useEffect(() => {
    const id = setInterval(refresh, 30000);
    return () => clearInterval(id);
  }, [refresh]);

  async function sendTest() {
    setTestMsg("Sending…");
    try {
      const res = await fetch("/api/process?admin=action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "testNotification" }),
      });
      const b = await res.json().catch(() => ({}));
      setTestMsg(res.ok ? "Test sent — check your Discord channel." : b.error || "Failed to send.");
    } catch {
      setTestMsg("Failed to send.");
    }
  }

  async function act(userId: string, action: string, plan?: string) {
    if (action === "delete" && !confirm("Permanently delete this user?")) return;
    if (
      action === "migratePricing" &&
      !confirm("Switch this subscriber onto the current Stripe price for their plan? No proration — the new amount applies from their next renewal.")
    )
      return;
    setBusyId(userId);
    try {
      const res = await fetch("/api/process?admin=action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, userId, plan }),
      });
      const body = await res.json().catch(() => ({}));
      if (action === "migratePricing") alert(body.message || body.error || "Done.");
      await refresh();
    } catch {
      /* ignore */
    }
    setBusyId("");
  }

  const users = (data.users as any[]).filter((u) => {
    if (cbOnly && !u.isCreatorBeta) return false;
    const t = q.trim().toLowerCase();
    if (!t) return true;
    return (u.username || "").toLowerCase().includes(t) || u.email.toLowerCase().includes(t);
  });

  return (
    <div className="space-y-10">
      <div className="flex items-center gap-2 text-xs text-white/40">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
        Live · auto-updates every 30s{updatedAt ? ` · last ${updatedAt}` : ""}
      </div>

      {/* Top stats */}
      <Section title="Overview">
        <Grid>
          <Stat label="Total users" value={s.totalUsers} />
          <Stat label="New today" value={s.newToday} accent />
          <Stat label="Paid users" value={s.paid} />
          <Stat label="Free users" value={s.free} />
          <Stat label="Active subs" value={s.active} />
          <Stat label="Trials" value={s.trialing} />
          <Stat label="Canceled" value={s.canceled} />
          <Stat label="MRR" value={fmtMoney(s.mrr)} accent />
          <Stat label="Creator Beta" value={s.creatorBetaUsers} accent />
        </Grid>
        <p className="mt-3 text-xs text-white/40">
          Live Stripe pricing — Starter {fmtPrice(s.pricing?.starter)} · Pro {fmtPrice(s.pricing?.pro)} · Unlimited {fmtPrice(s.pricing?.unlimited)} /mo
        </p>
      </Section>

      {/* Revenue analytics */}
      <Section title="Revenue analytics">
        <Grid>
          <Stat label="MRR" value={fmtMoney(r.mrr)} accent />
          <Stat label="Today" value={fmtMoney(r.revenueToday)} />
          <Stat label="This week" value={fmtMoney(r.revenueWeek)} />
          <Stat label="This month" value={fmtMoney(r.revenueMonth)} />
          <Stat label="Lifetime" value={fmtMoney(r.revenueLifetime)} accent />
          <Stat label="ARPU" value={fmtMoney(r.arpu)} />
          <Stat label="New subs today" value={r.newSubsToday ?? 0} />
          <Stat label="New subs this week" value={r.newSubsWeek ?? 0} />
          <Stat label="Canceled this week" value={r.canceledWeek ?? 0} />
          <Stat label="Active paying" value={r.activePaying ?? 0} />
        </Grid>
        {r.available === false && (
          <p className="mt-3 text-xs text-amber-300/70">Stripe revenue data isn&apos;t available right now.</p>
        )}
        <div className="mt-4 grid gap-3 lg:grid-cols-3">
          <MiniChart title="Revenue / day (30d)" points={r.revenueByDay || []} type="bar" money color="#34d399" />
          <MiniChart title="New subscriptions / day (30d)" points={r.newSubsByDay || []} type="bar" color="#818cf8" />
          <MiniChart title="Active subscriptions (30d)" points={r.activeSubsByDay || []} type="line" color="#f472b6" />
        </div>
      </Section>

      {/* Video analytics */}
      <Section title="Video analytics">
        <Grid>
          <Stat label="Videos processed" value={s.videosTotal} />
          <Stat label="Processed today" value={s.videosToday} accent />
          <Stat label="Avg processing" value={`${(s.avgProcessingMs / 1000).toFixed(1)}s`} />
          <Stat label="Failed jobs" value={s.videosFailed} />
          <Stat label="Creator Beta videos" value={s.creatorBetaVideos} accent />
        </Grid>
        <p className="mt-3 text-xs text-white/40">
          Creator Beta = invited creator testers (separate from the free trial). Each gets {s.creatorBetaEdits} free edits.
        </p>
      </Section>

      {/* System */}
      <Section title="System">
        <Grid>
          <Stat label="Server" value={data.system.status === "online" ? "🟢 Online" : "Down"} />
          <Stat label="Processing now" value={data.system.processing} />
          <Stat label="Queue waiting" value={data.system.queueDepth} />
        </Grid>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Btn onClick={sendTest} disabled={testMsg === "Sending…"}>Send test notification</Btn>
          {testMsg && <span className="text-xs text-white/50">{testMsg}</span>}
        </div>
        {data.recentErrors.length > 0 && (
          <div className="mt-4">
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-white/40">Recent errors</p>
            <div className="space-y-2">
              {data.recentErrors.map((e: any, i: number) => (
                <div key={i} className="glass rounded-lg p-3 text-xs">
                  <div className="flex justify-between gap-3">
                    <span className="truncate text-white/80">{e.name} · {e.email}</span>
                    <span className="shrink-0 text-white/30">{fmtDate(e.createdAt)}</span>
                  </div>
                  <p className="mt-1 text-red-300">{e.error}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </Section>

      {/* Users */}
      <Section title={`Users (${data.users.length})`}>
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by username or email…"
            className="w-full rounded-xl border border-white/10 bg-white/[0.03] px-4 py-2.5 text-sm outline-none transition focus:border-indigo-400/50 sm:max-w-sm"
          />
          <button
            onClick={() => setCbOnly((v) => !v)}
            className={`rounded-xl border px-3 py-2.5 text-xs font-medium transition ${
              cbOnly
                ? "border-amber-400/50 bg-amber-500/15 text-amber-200"
                : "border-white/10 text-white/60 hover:text-white"
            }`}
          >
            Creator Beta only
          </button>
        </div>
        <div className="space-y-2">
          {users.map((u) => (
            <div key={u.id} className="glass rounded-xl p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium">
                    {u.username || <span className="text-white/40">no username</span>}
                    {u.isAdmin && <span className="ml-2 rounded bg-indigo-500/20 px-1.5 py-0.5 text-[10px] text-indigo-200">ADMIN</span>}
                    {u.isCreatorBeta && <span className="ml-2 rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] text-amber-200">CREATOR BETA</span>}
                    {u.suspended && <span className="ml-2 rounded bg-red-500/20 px-1.5 py-0.5 text-[10px] text-red-200">SUSPENDED</span>}
                  </p>
                  <p className="truncate text-sm text-white/50">{u.email}</p>
                  {u.tiktokUsername && (
                    <p className="truncate text-xs text-pink-300/80">TikTok @{u.tiktokUsername}</p>
                  )}
                  <p className="mt-1 text-xs text-white/40">
                    Joined {fmtDate(u.createdAt)} · {u.planName} ·{" "}
                    {u.creditsLeft === null ? "unlimited edits" : `${u.creditsLeft}/${u.editLimit} edits left`}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    value={u.plan}
                    onChange={(e) => act(u.id, "setPlan", e.target.value)}
                    disabled={busyId === u.id}
                    className="rounded-lg border border-white/10 bg-white/[0.05] px-2 py-1.5 text-xs outline-none"
                  >
                    {PLAN_OPTIONS.map((p) => (
                      <option key={p} value={p} className="bg-neutral-900">{p}</option>
                    ))}
                  </select>
                  <Btn onClick={() => act(u.id, "resetCredits")} disabled={busyId === u.id}>Reset credits</Btn>
                  {u.suspended ? (
                    <Btn onClick={() => act(u.id, "unsuspend")} disabled={busyId === u.id}>Unsuspend</Btn>
                  ) : (
                    <Btn onClick={() => act(u.id, "suspend")} disabled={busyId === u.id}>Suspend</Btn>
                  )}
                  {u.subscriptionStatus === "active" && u.plan !== "free" && (
                    <Btn onClick={() => act(u.id, "migratePricing")} disabled={busyId === u.id}>Migrate pricing</Btn>
                  )}
                  {u.isCreatorBeta ? (
                    <Btn onClick={() => act(u.id, "unmarkCreatorBeta")} disabled={busyId === u.id}>Remove Creator Beta</Btn>
                  ) : (
                    <Btn onClick={() => act(u.id, "markCreatorBeta")} disabled={busyId === u.id}>Make Creator Beta</Btn>
                  )}
                  <Btn danger onClick={() => act(u.id, "delete")} disabled={busyId === u.id}>Delete</Btn>
                </div>
              </div>
            </div>
          ))}
          {users.length === 0 && <p className="text-sm text-white/40">No users match.</p>}
        </div>
      </Section>

      {/* Feedback */}
      <Section title={`Feedback (${data.feedback.length})`}>
        {data.feedback.length === 0 ? (
          <p className="text-sm text-white/40">No feedback yet.</p>
        ) : (
          <div className="space-y-2">
            {data.feedback.map((f: any, i: number) => (
              <div key={i} className="glass rounded-xl p-4">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-amber-300">{"★".repeat(f.rating)}<span className="text-white/15">{"★".repeat(5 - f.rating)}</span></span>
                  <span className="text-xs text-white/30">{f.email || "anon"} · {fmtDate(f.createdAt)}</span>
                </div>
                {f.comment && <p className="mt-2 text-sm text-white/80">{f.comment}</p>}
              </div>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-4 text-lg font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function Grid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">{children}</div>;
}

function Stat({ label, value, accent }: { label: string; value: any; accent?: boolean }) {
  return (
    <div className="glass rounded-xl p-4">
      <div className="text-xs text-white/50">{label}</div>
      <div className={`mt-1 text-2xl font-bold ${accent ? "text-indigo-300" : ""}`}>{value}</div>
    </div>
  );
}

function Btn({ children, onClick, disabled, danger }: { children: React.ReactNode; onClick: () => void; disabled?: boolean; danger?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`rounded-lg px-2.5 py-1.5 text-xs font-medium transition disabled:opacity-40 ${
        danger ? "border border-red-400/30 text-red-200 hover:bg-red-500/10" : "border border-white/10 text-white/70 hover:text-white"
      }`}
    >
      {children}
    </button>
  );
}

// Lightweight dependency-free SVG chart (bar or line) over a {date,value}[] series.
function MiniChart({
  title,
  points,
  type = "bar",
  money = false,
  color = "#818cf8",
}: {
  title: string;
  points: { date: string; value: number }[];
  type?: "bar" | "line";
  money?: boolean;
  color?: string;
}) {
  const pts = points || [];
  const n = pts.length || 1;
  const max = Math.max(1, ...pts.map((p) => p.value || 0));
  const W = 600;
  const H = 140;
  const fmt = (v: number) => (money ? fmtMoney(v) : String(v));

  return (
    <div className="glass rounded-xl p-4">
      <div className="mb-2 flex items-baseline justify-between">
        <p className="text-xs font-medium text-white/70">{title}</p>
        <p className="text-[10px] text-white/30">peak {fmt(max)}</p>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="w-full" style={{ height: 120 }}>
        {type === "bar"
          ? pts.map((p, i) => {
              const bw = W / n;
              const h = ((p.value || 0) / max) * (H - 8);
              return (
                <rect key={i} x={i * bw + 0.7} y={H - h} width={Math.max(0.8, bw - 1.4)} height={h} rx="1" fill={color}>
                  <title>{`${p.date}: ${fmt(p.value || 0)}`}</title>
                </rect>
              );
            })
          : (
            <polyline
              fill="none"
              stroke={color}
              strokeWidth="2"
              vectorEffect="non-scaling-stroke"
              points={pts.map((p, i) => `${n > 1 ? (i / (n - 1)) * W : 0},${H - ((p.value || 0) / max) * (H - 8)}`).join(" ")}
            />
          )}
      </svg>
      <div className="mt-1 flex justify-between text-[10px] text-white/30">
        <span>{pts[0]?.date}</span>
        <span>{pts[pts.length - 1]?.date}</span>
      </div>
    </div>
  );
}
