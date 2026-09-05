import { parentPort, workerData } from 'node:worker_threads';
import { auditPage } from '../core/audit.mjs';

try {
  parentPort.postMessage({ report: auditPage(workerData) });
} catch {
  parentPort.postMessage({
    error: 'The HTML exceeded analysis limits or could not be parsed.',
  });
}
