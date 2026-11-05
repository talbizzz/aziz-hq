// Best-effort, pattern-based secret redaction for transcripts and events (ADR-15 / milestone 4, C6). The real protection
// is scoping (no secrets in agent environments) and gitleaks on everything pushed; this removes what slips into logs.

interface Rule {
  kind: string;
  pattern: RegExp;
}

const RULES: Rule[] = [
  { kind: 'anthropic', pattern: /sk-ant-[A-Za-z0-9_-]{20,}/g },
  { kind: 'supabase', pattern: /sb_(?:secret|publishable)_[A-Za-z0-9_-]{16,}/g },
  { kind: 'jwt', pattern: /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g },
  { kind: 'telegram', pattern: /\b\d{8,10}:[A-Za-z0-9_-]{35}\b/g },
  { kind: 'github', pattern: /\bgithub_pat_[A-Za-z0-9_]{22,}\b/g },
  { kind: 'github', pattern: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/g },
  { kind: 'aws', pattern: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g },
];

const BEARER = /\b(Bearer\s+)[A-Za-z0-9._~+/=-]{16,}/g;
// KEY=value / "key": "value" for credential-looking keys; only the value is replaced
const CREDENTIAL =
  /\b([A-Za-z_]*(?:password|passwd|secret|token|api[_-]?key)[A-Za-z_]*)(["']?\s*[=:]\s*["']?)([^\s"',;}]{8,})/gi;

// A value that looks like a credential mixes in a digit or is long; this spares code such as `token = getToken()`.
const looksLikeSecret = (value: string) => /\d/.test(value) || value.length >= 16;

export function redactSecrets(text: string): string {
  let out = text;
  for (const { kind, pattern } of RULES) out = out.replace(pattern, `[REDACTED:${kind}]`);
  out = out.replace(BEARER, '$1[REDACTED:bearer]');
  out = out.replace(CREDENTIAL, (whole, key: string, sep: string, value: string) =>
    looksLikeSecret(value) ? `${key}${sep}[REDACTED:credential]` : whole,
  );
  return out;
}
