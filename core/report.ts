export type FindingState =
  | 'pass'
  | 'review'
  | 'fail'
  | 'unknown'
  | 'not-applicable';
export interface AuditInput {
  url: string;
  status?: number | null;
  headers?: Record<string, string[] | undefined>;
  html?: string | null;
  robots?: { status?: number; text?: string; error?: string } | null;
  redirects?: { url: string; status: number; target: string }[];
  checkedAt?: string;
  mode?: string;
}
export interface Finding {
  id: string;
  group: 'access' | 'content';
  title: string;
  state: FindingState;
  weight: number;
  evidence: string;
  action: string;
  source: string;
  blocking: boolean;
}
export interface Summary {
  score: number | null;
  coverage: number;
  assessed: number;
  eligible: number;
  blockers: string[];
}
export interface Report {
  version: number;
  mode: string;
  checkedAt: string;
  url: string;
  status: number | null;
  summary: Summary;
  groups: { access: Summary; content: Summary };
  checks: Finding[];
  redirects: { url: string; status: number; target: string }[];
  page: null | {
    title: string;
    canonical: string | null;
    headings: { level: number; value: string; line: number | null }[];
    headingCount: number;
    bodyCharacters: number;
  };
  limits: string[];
}
