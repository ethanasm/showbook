import type {
  Reporter,
  FullConfig,
  Suite,
  TestCase,
  TestResult,
  FullResult,
  TestError,
} from '@playwright/test/reporter';

interface FailureInfo {
  title: string;
  location?: string;
  message: string;
  stdout: string;
  stderr: string;
}

const STATUS_TAG: Record<string, string> = {
  passed: 'PASS',
  failed: 'FAIL',
  timedOut: 'TIME',
  skipped: 'SKIP',
  interrupted: 'INTR',
};

function chunksToString(chunks: ReadonlyArray<string | Buffer> | undefined) {
  if (!chunks || chunks.length === 0) return '';
  return chunks
    .map((c) => (typeof c === 'string' ? c : c.toString('utf8')))
    .join('');
}

function indent(text: string, prefix = '    ') {
  return text
    .split('\n')
    .map((line) => `${prefix}${line}`)
    .join('\n');
}

class ProgressReporter implements Reporter {
  private total = 0;
  private completed = 0;
  private failed = 0;
  private skipped = 0;
  private startedAt = 0;
  private failures: FailureInfo[] = [];

  printsToStdio() {
    return true;
  }

  onBegin(_config: FullConfig, suite: Suite) {
    this.total = suite.allTests().length;
    this.startedAt = Date.now();
    process.stdout.write(`Running ${this.total} tests\n`);
  }

  onTestEnd(test: TestCase, result: TestResult) {
    this.completed += 1;
    const status = result.status;
    if (status === 'failed' || status === 'timedOut') {
      this.failed += 1;
      const titlePath = test.titlePath().filter(Boolean);
      const title = titlePath.join(' › ');
      const message = result.error?.message ?? result.error?.value ?? 'unknown error';
      const location = test.location
        ? `${test.location.file}:${test.location.line}`
        : undefined;
      this.failures.push({
        title,
        location,
        message,
        stdout: chunksToString(result.stdout),
        stderr: chunksToString(result.stderr),
      });
    } else if (status === 'skipped') {
      this.skipped += 1;
    }
    const tag = STATUS_TAG[status] ?? status.toUpperCase();
    process.stdout.write(
      `[${tag}] Executing ${this.completed} of ${this.total} tests (${this.failed} failed)\n`,
    );
  }

  onError(error: TestError) {
    const msg = error.message ?? error.value ?? 'unknown error';
    process.stdout.write(`[ERR ] ${msg}\n`);
  }

  onEnd(result: FullResult) {
    const elapsedMs = Date.now() - this.startedAt;
    const elapsed = (elapsedMs / 1000).toFixed(1);

    if (this.failures.length > 0) {
      process.stdout.write(`\n${this.failures.length} failure(s):\n`);
      for (const f of this.failures) {
        process.stdout.write(`\n  ✗ ${f.title}\n`);
        if (f.location) process.stdout.write(`    at ${f.location}\n`);
        process.stdout.write(`${indent(f.message.trimEnd())}\n`);
        if (f.stdout.trim()) {
          process.stdout.write(`    --- stdout ---\n${indent(f.stdout.trimEnd())}\n`);
        }
        if (f.stderr.trim()) {
          process.stdout.write(`    --- stderr ---\n${indent(f.stderr.trimEnd())}\n`);
        }
      }
    }

    const passed = this.completed - this.failed - this.skipped;
    process.stdout.write(
      `\nDone: ${this.completed}/${this.total} in ${elapsed}s — ` +
        `${passed} passed, ${this.failed} failed, ${this.skipped} skipped ` +
        `(${result.status})\n`,
    );
  }
}

export default ProgressReporter;
