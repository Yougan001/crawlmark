'use client';

import { useRef, useState } from 'react';
import { ArrowUpRight, Download, ScanLine, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { FindingState, Report, Summary } from '@/core/report';

const endpoint =
  import.meta.env.VITE_INSPECTION_API ||
  (import.meta.env.DEV ? '/api/inspect' : '');
const labels: Record<FindingState, string> = {
  pass: 'Pass',
  review: 'Review',
  fail: 'Issue',
  unknown: 'Unknown',
  'not-applicable': 'Not applicable',
};

function Score({ title, summary }: { title: string; summary: Summary }) {
  return (
    <div className="score">
      <span>{title}</span>
      <strong>
        {summary.score ?? '—'}
        <small>/100</small>
      </strong>
      <p>
        {summary.coverage}% coverage · {summary.assessed}/{summary.eligible}{' '}
        weighted checks
      </p>
    </div>
  );
}

export default function Home() {
  const [url, setUrl] = useState('');
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<'all' | 'action' | 'unknown'>('all');
  const current = useRef<{ id: number; cancel?: () => void }>({ id: 0 });

  function reset(message = '') {
    current.current.cancel?.();
    current.current = { id: current.current.id + 1 };
    setBusy(false);
    setReport(null);
    setError(message);
    setFilter('all');
  }

  async function inspect(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    reset();
    if (!endpoint) {
      setError(
        'A public inspection API has not been connected yet. The sample remains available.',
      );
      return;
    }
    const controller = new AbortController();
    const id = current.current.id;
    current.current.cancel = () => controller.abort();
    setBusy(true);
    const timer = setTimeout(() => controller.abort(), 30000);
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.trim() }),
        signal: controller.signal,
        credentials: 'omit',
        cache: 'no-store',
      });
      const payload = await response.json();
      if (!response.ok)
        throw new Error(
          payload.error?.message ||
            'The inspection service could not complete this request.',
        );
      if (
        payload.version !== 1 ||
        !Array.isArray(payload.checks) ||
        !payload.summary
      )
        throw new Error('The service returned an unsupported report.');
      if (current.current.id === id) setReport(payload as Report);
    } catch (failure) {
      if (current.current.id === id)
        setError(
          controller.signal.aborted
            ? 'The request exceeded 30 seconds. No old report has been kept.'
            : failure instanceof Error
              ? failure.message
              : 'The service could not be reached.',
        );
    } finally {
      clearTimeout(timer);
      if (current.current.id === id) {
        setBusy(false);
        current.current.cancel = undefined;
      }
    }
  }

  function sample() {
    reset();
    const id = current.current.id;
    const worker = new Worker(
      new URL('../workers/sample.worker.ts', import.meta.url),
      { type: 'module' },
    );
    const timer = setTimeout(() => {
      if (current.current.id === id) reset('The sample analysis timed out.');
    }, 5000);
    current.current.cancel = () => {
      clearTimeout(timer);
      worker.terminate();
    };
    setBusy(true);
    worker.onmessage = (
      event: MessageEvent<{ report?: Report; error?: string }>,
    ) => {
      if (current.current.id !== id) return;
      current.current.cancel?.();
      current.current.cancel = undefined;
      setBusy(false);
      setReport(event.data.report ?? null);
      setError(event.data.error ?? '');
    };
    worker.onerror = () => {
      if (current.current.id === id)
        reset('The sample worker could not start.');
    };
    worker.postMessage({});
  }

  function download() {
    if (!report) return;
    const objectUrl = URL.createObjectURL(
      new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }),
    );
    const anchor = document.createElement('a');
    anchor.href = objectUrl;
    anchor.download = `crawlmark-${report.mode}-report.json`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  }

  const visible =
    report?.checks.filter(
      (finding) =>
        filter === 'all' ||
        (filter === 'unknown'
          ? finding.state === 'unknown'
          : finding.state === 'review' || finding.state === 'fail'),
    ) ?? [];

  return (
    <main className="audit-desk">
      <header>
        <span className="brand">
          <ScanLine aria-hidden="true" />
          Crawlmark
        </span>
        <span>URL INSPECTION / EVIDENCE FIRST</span>
        <a
          className="source-link"
          href="https://github.com/Yougan001/crawlmark"
        >
          Source <ArrowUpRight size={14} />
        </a>
      </header>
      <section className="entry">
        <p className="eyebrow">TECHNICAL SEO + CONTENT ACCESS</p>
        <h1>
          Check the page.
          <br />
          Keep the evidence.
        </h1>
        <p>One URL. Concrete checks. A practical fix list.</p>
        <form onSubmit={inspect}>
          <label htmlFor="url">Public page URL</label>
          <div className="url-row">
            <Input
              id="url"
              type="url"
              value={url}
              maxLength={2048}
              onChange={(event) => {
                reset();
                setUrl(event.target.value);
              }}
              placeholder="https://example.com/article"
              required
              spellCheck={false}
              autoComplete="off"
            />
            <Button type="submit" disabled={busy || !endpoint}>
              Inspect page <ArrowUpRight aria-hidden="true" />
            </Button>
            {busy && (
              <Button
                type="button"
                variant="outline"
                onClick={() => reset('Inspection cancelled.')}
              >
                <X aria-hidden="true" />
                Cancel
              </Button>
            )}
          </div>
        </form>
        <div className="entry-bottom">
          <p className="connection-note">
            {endpoint
              ? 'URLs are sent to the inspection service. Public pages only — no passwords, private links or signed URLs.'
              : 'Public URL service is not connected yet. The sample runs locally; it does not inspect your URL.'}
          </p>
          <Button
            type="button"
            variant="outline"
            onClick={sample}
            disabled={busy}
          >
            Open sample report
          </Button>
        </div>
        <p className="status-line" aria-live="polite">
          {busy
            ? 'Inspecting… fetching bounded responses and building the evidence report.'
            : error}
        </p>
      </section>
      {report ? (
        <section className="results" aria-label="Inspection report">
          <div className="report-heading">
            <div>
              <p className="eyebrow">
                {report.mode === 'sample'
                  ? 'SAMPLE FIXTURE · NOT A LIVE WEBSITE'
                  : 'LIVE RESPONSE SNAPSHOT'}
              </p>
              <h2>{report.page?.title || 'Page inspection'}</h2>
              <p className="report-url">{report.url}</p>
            </div>
            <Button variant="outline" onClick={download}>
              <Download aria-hidden="true" />
              JSON report
            </Button>
          </div>
          {report.summary.blockers.length > 0 && (
            <div className="blocker-note">
              <strong>Resolve access restrictions first.</strong>{' '}
              {report.summary.blockers.length} blocking finding(s) are present.
              The checklist score does not override them.
            </div>
          )}
          <div className="scores">
            <Score title="CHECKLIST" summary={report.summary} />
            <Score
              title="CRAWL & INDEX SIGNALS"
              summary={report.groups.access}
            />
            <Score
              title="CONTENT & EXTRACTABILITY"
              summary={report.groups.content}
            />
          </div>
          <p className="score-note">
            Project-defined weights, not a ranking or GEO citation score.
            Unknown checks reduce coverage, not the score. A pass records a
            narrow observation, not search-engine approval.
          </p>
          <div className="filter-row">
            <div className="filters" aria-label="Filter findings">
              {(['all', 'action', 'unknown'] as const).map((value) => (
                <Button
                  key={value}
                  variant={filter === value ? 'default' : 'outline'}
                  aria-pressed={filter === value}
                  onClick={() => setFilter(value)}
                >
                  {value === 'all'
                    ? 'All checks'
                    : value === 'action'
                      ? 'Needs attention'
                      : 'Unknown'}
                </Button>
              ))}
            </div>
            <span>{visible.length} checks</span>
          </div>
          <div className="findings">
            {visible.length ? (
              visible.map((finding, index) => (
                <article
                  key={finding.id}
                  className={`finding ${finding.state}`}
                >
                  <div className="finding-index">
                    {String(index + 1).padStart(2, '0')}
                  </div>
                  <div>
                    <div className="finding-title">
                      <h3>{finding.title}</h3>
                      <span className={`state ${finding.state}`}>
                        {labels[finding.state]}
                      </span>
                    </div>
                    <p>{finding.evidence}</p>
                    <div className="next-step">
                      <b>Next step</b>
                      <p>{finding.action}</p>
                    </div>
                    <a href={finding.source} target="_blank" rel="noreferrer">
                      Reference <ArrowUpRight size={13} />
                    </a>
                  </div>
                </article>
              ))
            ) : (
              <p className="empty">No checks in this view.</p>
            )}
          </div>
          {report.page && (
            <details className="outline">
              <summary>
                Source heading outline · {report.page.headingCount} headings
              </summary>
              <ol>
                {report.page.headings.map((heading, index) => (
                  <li key={index}>
                    <span>
                      H{heading.level} · line {heading.line ?? '—'}
                    </span>
                    {heading.value || '(empty)'}
                  </li>
                ))}
              </ol>
              {report.page.headingCount > 200 && (
                <p>Only the first 200 headings are shown.</p>
              )}
            </details>
          )}
          {report.redirects.length > 0 && (
            <details className="outline">
              <summary>Redirect chain · {report.redirects.length} hops</summary>
              <ol>
                {report.redirects.map((hop, index) => (
                  <li key={index}>
                    <span>HTTP {hop.status}</span>
                    {hop.url} → {hop.target}
                  </li>
                ))}
              </ol>
            </details>
          )}
          <details className="outline">
            <summary>Method and limits</summary>
            <ul>
              {report.limits.map((limit) => (
                <li key={limit}>{limit}</li>
              ))}
            </ul>
            <p>
              Pass = full weight, review = half, issue = zero. Unknown and
              not-applicable are omitted from the score. Coverage counts unknown
              weighted checks. Checked: {report.checkedAt}.
            </p>
          </details>
        </section>
      ) : (
        <section className="report-slice">
          <div className="report-heading">
            <h2>A small inspection, with clear boundaries</h2>
            <span>13 CHECKS / ONE RESPONSE</span>
          </div>
          <div className="scope-grid">
            <article>
              <b>01</b>
              <h3>Crawl & index signals</h3>
              <p>
                HTTP status, Googlebot rules, noindex directives and canonical
                hints.
              </p>
            </article>
            <article>
              <b>02</b>
              <h3>Content & extractability</h3>
              <p>
                Titles, headings, source text, snippet restrictions and JSON-LD
                syntax.
              </p>
            </article>
            <article>
              <b>03</b>
              <h3>A reviewable fix list</h3>
              <p>
                Observed evidence, a concrete next step, reference links and a
                portable JSON report.
              </p>
            </article>
          </div>
        </section>
      )}
      <footer>
        No login cookies, page scripts or browser rendering. No ranking or
        citation guarantees. Missing evidence stays unknown.
      </footer>
    </main>
  );
}
