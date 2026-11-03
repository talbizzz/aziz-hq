"use client";
import { useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase-browser";
export default function Mfa() {
  const [factorId, setFactorId] = useState(""), [secret, setSecret] = useState(""), [code, setCode] = useState(""), [err, setErr] = useState("");
  useEffect(() => { (async () => {
    const sb = supabaseBrowser();
    const { data: list } = await sb.auth.mfa.listFactors();
    const verified = list?.totp?.[0];
    if (verified) { setFactorId(verified.id); return; }
    // a previous visit may have left an unverified factor behind: remove it, else enroll fails (mfa_factor_name_conflict)
    for (const f of list?.all ?? []) if (f.status === "unverified") await sb.auth.mfa.unenroll({ factorId: f.id });
    const { data, error } = await sb.auth.mfa.enroll({ factorType: "totp", friendlyName: `spike-${Date.now()}` });
    if (error) { setErr(error.message); return; }
    setFactorId(data.id); setSecret(data.totp.secret);
  })(); }, []);
  async function verify(e: React.FormEvent) {
    e.preventDefault();
    const sb = supabaseBrowser();
    const { data: ch, error: e1 } = await sb.auth.mfa.challenge({ factorId });
    if (e1) { setErr(e1.message); return; }
    const { error: e2 } = await sb.auth.mfa.verify({ factorId, challengeId: ch.id, code });
    if (e2) setErr(e2.message); else window.location.href = "/dashboard";
  }
  return (<form onSubmit={verify}><h1>mfa</h1>
    {secret && <p data-testid="secret">{secret}</p>}
    <input name="code" placeholder="code" value={code} onChange={(e) => setCode(e.target.value)} />
    <button type="submit">verify</button><p data-testid="err">{err}</p></form>);
}
