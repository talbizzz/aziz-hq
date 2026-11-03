import { useEffect, useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { supabase } from "./supabase";

type Gate = "loading" | "anon" | "aal1" | "aal2";
function useGate(): Gate {
  const [g, setG] = useState<Gate>("loading");
  useEffect(() => {
    const read = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return setG("anon");
      const { data } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      setG(data?.currentLevel === "aal2" ? "aal2" : "aal1");
    };
    read();
    const { data: sub } = supabase.auth.onAuthStateChange(() => { read(); });
    return () => sub.subscription.unsubscribe();
  }, []);
  return g;
}

function RequireAal2({ children }: { children: React.ReactNode }) {
  const g = useGate();
  if (g === "loading") return <p>loading</p>;
  if (g === "anon") return <Navigate to="/login" replace />;
  if (g === "aal1") return <Navigate to="/mfa" replace />;
  return <>{children}</>;
}

function Login() {
  const [email, setEmail] = useState(""), [password, setPassword] = useState(""), [err, setErr] = useState("");
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) setErr(error.message); else window.location.assign("/mfa");
  }
  return (<form onSubmit={submit}><h1>login</h1>
    <input name="email" placeholder="email" value={email} onChange={(e) => setEmail(e.target.value)} />
    <input name="password" type="password" placeholder="password" value={password} onChange={(e) => setPassword(e.target.value)} />
    <button type="submit">sign in</button><p data-testid="err">{err}</p></form>);
}

function Mfa() {
  const [factorId, setFactorId] = useState(""), [secret, setSecret] = useState(""), [code, setCode] = useState(""), [err, setErr] = useState("");
  useEffect(() => { (async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { window.location.assign("/login"); return; }
    const { data: list } = await supabase.auth.mfa.listFactors();
    if (list?.totp?.[0]) { setFactorId(list.totp[0].id); return; }
    // remove stale unverified factors left by an earlier visit (else enroll fails: mfa_factor_name_conflict)
    for (const f of list?.all ?? []) if (f.status === "unverified") await supabase.auth.mfa.unenroll({ factorId: f.id });
    const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: `spike-${Date.now()}` });
    if (error) { setErr(error.message); return; }
    setFactorId(data.id); setSecret(data.totp.secret);
  })(); }, []);
  async function verify(e: React.FormEvent) {
    e.preventDefault();
    const { data: ch, error: e1 } = await supabase.auth.mfa.challenge({ factorId });
    if (e1) { setErr(e1.message); return; }
    const { error: e2 } = await supabase.auth.mfa.verify({ factorId, challengeId: ch.id, code });
    if (e2) setErr(e2.message); else window.location.assign("/dashboard");
  }
  return (<form onSubmit={verify}><h1>mfa</h1>{secret && <p data-testid="secret">{secret}</p>}
    <input name="code" placeholder="code" value={code} onChange={(e) => setCode(e.target.value)} />
    <button type="submit">verify</button><p data-testid="err">{err}</p></form>);
}

function Dashboard() {
  const [rows, setRows] = useState<string[]>([]), [status, setStatus] = useState("connecting"), [who, setWho] = useState("");
  useEffect(() => {
    let ch: ReturnType<typeof supabase.channel> | undefined, cancelled = false;
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      setWho(session?.user.email ?? "");
      await supabase.realtime.setAuth(session?.access_token ?? null);
      if (cancelled) return;
      ch = supabase.channel("s3").on("postgres_changes", { event: "INSERT", schema: "public", table: "s3_events" },
        (p) => setRows((r) => [...r, (p.new as { note: string }).note])).subscribe((s) => setStatus(s));
    })();
    return () => { cancelled = true; if (ch) supabase.removeChannel(ch); };
  }, []);
  return (<div><h1>dashboard</h1><p data-testid="who">{who}</p><p data-testid="rt-status">{status}</p>
    <button onClick={() => supabase.auth.signOut().then(() => window.location.assign("/login"))}>sign out</button>
    <ul>{rows.map((r, i) => <li key={i} data-testid="row">{r}</li>)}</ul></div>);
}

export default function App() {
  return (<Routes>
    <Route path="/login" element={<Login />} />
    <Route path="/mfa" element={<Mfa />} />
    <Route path="/dashboard" element={<RequireAal2><Dashboard /></RequireAal2>} />
    <Route path="*" element={<Navigate to="/dashboard" replace />} />
  </Routes>);
}
