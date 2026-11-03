import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase-server";
import Live from "./Live";
export const dynamic = "force-dynamic";
export default async function Dashboard() {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect("/login");
  const { data: aal } = await sb.auth.mfa.getAuthenticatorAssuranceLevel();
  if (aal?.currentLevel !== "aal2") redirect("/mfa");
  return (<div><h1>dashboard</h1><p data-testid="who">{user.email}</p><Live /></div>);
}
