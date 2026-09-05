import { auditPage } from '../core/audit.mjs';
import { sampleInput } from '../core/sample.mjs';

self.onmessage = () => {
  try {
    self.postMessage({ report: auditPage(sampleInput) });
  } catch {
    self.postMessage({ error: 'The sample could not be analyzed.' });
  }
};
