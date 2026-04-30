// Browser globals for node:test under jsdom.
// Loaded via `node --import tsx --import ./test-setup.ts --test ...`.
import 'global-jsdom/register';
import { Module } from 'node:module';

// Stub CSS imports so component files that `import './foo.css'` don't
// crash node:test (which has no CSS handler). Both tsx CJS and ESM
// paths funnel through Module._extensions, so this single hook suffices.
const M = Module as unknown as { _extensions: Record<string, (mod: unknown, filename: string) => void> };
M._extensions['.css'] = (mod) => {
  (mod as { exports: unknown }).exports = {};
};

class MockObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}

if (!('IntersectionObserver' in globalThis)) {
  (globalThis as { IntersectionObserver: unknown }).IntersectionObserver = MockObserver;
}
if (!('ResizeObserver' in globalThis)) {
  (globalThis as { ResizeObserver: unknown }).ResizeObserver = MockObserver;
}

if (typeof window !== 'undefined' && !window.matchMedia) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}
