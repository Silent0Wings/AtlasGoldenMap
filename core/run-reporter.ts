/**
 * run-reporter.ts — writes review/run-summary.json at the end of every run. Failures are split by class
 * (visual: needs review; infra: timeouts and connection errors; error: everything else), plus flaky tests
 * (passed on retry) and every atlas-warning annotation. cli.mjs and the review UI read it.
 */
import type { FullResult, Reporter, TestCase, TestResult } from '@playwright/test/reporter';
import { DIRS, writeAtomic } from './store.mjs';

type FailureClass = 'visual' | 'infra' | 'error';

const clean = (s: string) => s.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
const errorText = (r?: TestResult) => clean((r?.errors ?? []).map(e => e.message ?? '').join('\n'));
const firstLine = (s: string) => (s.split('\n').find(l => l.trim()) ?? '').trim().slice(0, 300);

function classOf(text: string): FailureClass {
  if (text.includes('visual check failed')) return 'visual';
  if (/timeout|timed out|net::ERR|ECONN|has been closed/i.test(text)) return 'infra';
  return 'error';
}

export default class RunReporter implements Reporter {
  private tests = new Set<TestCase>();

  // the last call per test carries its final state; outcome() is read in onEnd
  onTestEnd(test: TestCase) { this.tests.add(test); }

  async onEnd(result: FullResult) {
    const failures: { id: string; variant: string; class: FailureClass; message: string; retries: number }[] = [];
    const flaky: { id: string; variant: string; retries: number; message: string }[] = [];
    const warnings: { id: string; variant: string; message: string }[] = [];
    const seen = new Set<string>();

    for (const test of this.tests) {
      const id = test.title;
      const variant = test.parent.project()?.name ?? '';
      const outcome = test.outcome();
      const retries = Math.max(0, test.results.length - 1);
      const failed = test.results.filter(r => r.status !== 'passed' && r.status !== 'skipped');

      if (outcome === 'unexpected') {
        const text = errorText(failed.at(-1));
        failures.push({ id, variant, class: classOf(text), message: firstLine(text), retries });
      } else if (outcome === 'flaky') {
        flaky.push({ id, variant, retries, message: firstLine(errorText(failed[0])) });
      }

      for (const r of test.results) {
        for (const a of r.annotations) {
          if (a.type !== 'atlas-warning') continue;
          const message = a.description ?? '';
          const key = `${id}\0${variant}\0${message}`;
          if (seen.has(key)) continue;
          seen.add(key);
          warnings.push({ id, variant, message });
        }
      }
    }

    writeAtomic(DIRS.summary, JSON.stringify({
      finishedAt: new Date().toISOString(),
      status: result.status,
      total: this.tests.size,
      failures,
      flaky,
      warnings,
    }, null, 2) + '\n');
  }
}
