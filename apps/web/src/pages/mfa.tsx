import { useEffect, useState, type FormEvent } from 'react';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { supabase } from '../lib/supabase';

interface Enrolment {
  factorId: string;
  qr?: string;
  secret?: string;
}

// Verified TOTP factor -> just ask for a code. Otherwise enrol first (removing stale unverified factors: M0 finding).
async function prepareFactor(): Promise<Enrolment> {
  const { data: list, error } = await supabase.auth.mfa.listFactors();
  if (error) throw error;
  const verified = list.totp[0];
  if (verified) return { factorId: verified.id };

  for (const f of list.all) {
    if (f.factor_type === 'totp' && f.status === 'unverified')
      await supabase.auth.mfa.unenroll({ factorId: f.id });
  }
  const { data, error: enrolError } = await supabase.auth.mfa.enroll({
    factorType: 'totp',
    friendlyName: `aziz-hq-${Date.now()}`,
  });
  if (enrolError) throw enrolError;
  return { factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret };
}

export function MfaPage() {
  const [enrolment, setEnrolment] = useState<Enrolment | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    prepareFactor().then(
      (e) => !cancelled && setEnrolment(e),
      (e: Error) => !cancelled && setError(e.message),
    );
    return () => {
      cancelled = true;
    };
  }, []);

  async function verify(e: FormEvent) {
    e.preventDefault();
    if (!enrolment) return;
    setError('');
    const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({
      factorId: enrolment.factorId,
    });
    if (challengeError) return setError(challengeError.message);
    const { error: verifyError } = await supabase.auth.mfa.verify({
      factorId: enrolment.factorId,
      challengeId: challenge.id,
      code: code.trim(),
    });
    // On success the session reaches aal2 and the route guard moves us to the dashboard.
    if (verifyError) setError(verifyError.message);
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm items-center p-6">
      <Card className="w-full">
        <CardHeader>
          <CardTitle>Two-factor authentication</CardTitle>
          <CardDescription>
            {enrolment?.qr
              ? 'Scan the QR code with your authenticator app, then enter the 6-digit code.'
              : 'Enter the 6-digit code from your authenticator app.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {enrolment?.qr && (
            <>
              <img
                src={enrolment.qr}
                alt="TOTP QR code"
                className="mx-auto size-40"
                data-testid="mfa-qr"
              />
              <p
                className="break-all text-center font-mono text-xs text-muted-foreground"
                data-testid="mfa-secret"
              >
                {enrolment.secret}
              </p>
            </>
          )}
          <form onSubmit={verify} className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="code">Code</Label>
              <Input
                id="code"
                inputMode="numeric"
                autoComplete="one-time-code"
                required
                value={code}
                onChange={(e) => setCode(e.target.value)}
                data-testid="mfa-code"
              />
            </div>
            {error && (
              <p role="alert" className="text-sm text-destructive" data-testid="mfa-error">
                {error}
              </p>
            )}
            <Button type="submit" disabled={!enrolment} data-testid="mfa-submit">
              Verify
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
