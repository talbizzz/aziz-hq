"use client";
import { useState } from "react";
import { supabaseBrowser } from "@/lib/supabase-browser";
export default function Login() {
  const [email, setEmail] = useState(""), [password, setPassword] = useState(""), [err, setErr] = useState("");
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const { error } = await supabaseBrowser().auth.signInWithPassword({ email, password });
    if (error) setErr(error.message); else window.location.href = "/mfa";
  }
  return (<form onSubmit={submit}><h1>login</h1>
    <input name="email" placeholder="email" value={email} onChange={(e) => setEmail(e.target.value)} />
    <input name="password" type="password" placeholder="password" value={password} onChange={(e) => setPassword(e.target.value)} />
    <button type="submit">sign in</button><p data-testid="err">{err}</p></form>);
}
