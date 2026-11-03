import { verifyAccess } from "@/lib/access";
export async function GET(req: Request) {
  const r = await verifyAccess(req);
  return r.ok ? Response.json({ ok: true, email: r.email }) : new Response("denied", { status: r.status });
}
