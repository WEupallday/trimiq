// Self-hosted product analytics: one row per event in our own Postgres.
// No third-party services. track() never throws — analytics must never
// break a product flow.
import { prisma } from "./db";

export type EventProps = Record<string, string | number | boolean | null | undefined>;

export async function track(
  name: string,
  opts: { email?: string | null; anonId?: string | null; props?: EventProps } = {}
): Promise<void> {
  try {
    const props = opts.props ? JSON.parse(JSON.stringify(opts.props)) : undefined;
    await prisma.event.create({
      data: {
        name: name.slice(0, 64),
        email: opts.email ?? null,
        anonId: opts.anonId ?? null,
        props,
      },
    });
  } catch (e: any) {
    console.error("[analytics] dropped event:", name, e?.message);
  }
}
