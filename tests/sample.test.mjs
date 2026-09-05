import test from 'node:test';
import assert from 'node:assert/strict';
import { sampleInput } from '../core/sample.mjs';
import { auditPage } from '../core/audit.mjs';

test('the displayed sample is a labeled, engine-calculated report with an independent blocker', () => {
  const report = auditPage(sampleInput);
  assert.equal(report.mode, 'sample');
  assert.equal(report.summary.score, 81);
  assert.equal(report.summary.coverage, 100);
  assert.deepEqual(report.summary.blockers, ['index']);
  assert.equal(
    report.checks.filter(
      (check) => check.state === 'review' || check.state === 'fail',
    ).length,
    3,
  );
});
