import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { auditPage } from '../core/audit.mjs';
import { sampleInput } from '../core/sample.mjs';

const report = JSON.parse(
  await readFile(
    new URL('../work/downloads/crawlmark-sample-report.json', import.meta.url),
    'utf8',
  ),
);
const expected = auditPage({ ...sampleInput, checkedAt: report.checkedAt });
assert.deepEqual(report, expected);
assert.equal(report.summary.score, 81);
assert.deepEqual(report.summary.blockers, ['index']);
console.log(
  `Verified actual downloaded sample: ${report.checks.length} checks, score ${report.summary.score}, noindex blocker.`,
);
