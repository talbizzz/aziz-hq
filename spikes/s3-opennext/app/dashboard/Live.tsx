"use client";
import { useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase-browser";
export default function Live() {
  const [rows, setRows] = useState<string[]>([]), [status, setStatus] = useState("connecting");
  useEffect(() => {
    const sb = supabaseBrowser();
    let ch: ReturnType<typeof sb.channel> | undefined, cancelled = false;
    (async () => {
      // the browser client loads its session asynchronously; without this the channel joins as anon and RLS hides every row
      const { data } = await sb.auth.getSession();
      await sb.realtime.setAuth(data.session?.access_token ?? null);
      if (cancelled) return;
      ch = sb.channel("s3").on("postgres_changes", { event: "INSERT", schema: "public", table: "s3_events" },
        (p) => setRows((r) => [...r, (p.new as { note: string }).note])).subscribe((s) => setStatus(s));
    })();
    return () => { cancelled = true; if (ch) sb.removeChannel(ch); };
  }, []);
  return (<div><p data-testid="rt-status">{status}</p><ul>{rows.map((r, i) => <li key={i} data-testid="row">{r}</li>)}</ul></div>);
}
