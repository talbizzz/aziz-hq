// Spike-only: does Realtime postgres_changes deliver to a signed-in supabase-js client? (no browser, no Worker)
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
const env = Object.fromEntries(readFileSync(".env.local", "utf8").split("\n").filter(Boolean).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
const API = env.NEXT_PUBLIC_SUPABASE_URL, KEY = env.NEXT_PUBLIC_SUPABASE_KEY, SECRET = env.SUPABASE_SECRET_KEY;
const email = `probe+${Date.now()}@example.test`, password = "Sp1ke-Passw0rd!";
await fetch(`${API}/auth/v1/admin/users`, { method: "POST", headers: { apikey: SECRET, "Content-Type": "application/json" }, body: JSON.stringify({ email, password, email_confirm: true }) });
const sb = createClient(API, KEY);
const { error } = await sb.auth.signInWithPassword({ email, password });
console.log("signin error:", error?.message ?? null);
const got = [];
await new Promise((res) => {
  sb.channel("probe").on("postgres_changes", { event: "INSERT", schema: "public", table: "s3_events" }, (p) => got.push(p.new.note))
    .subscribe((s, err) => { console.log("status", s, err?.message ?? ""); if (s === "SUBSCRIBED") res(); });
});
const t0 = Date.now();
const r = await fetch(`${API}/rest/v1/s3_events`, { method: "POST", headers: { apikey: SECRET, "Content-Type": "application/json" }, body: JSON.stringify({ note: "probe" }) });
console.log("insert status", r.status);
for (let i = 0; i < 50 && !got.length; i++) await new Promise((r) => setTimeout(r, 100));
console.log("received:", got, "after ms", Date.now() - t0);
process.exit(0);
