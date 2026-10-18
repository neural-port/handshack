import '@testing-library/jest-dom/vitest';

// jsdom doesn't implement scrolling — the router calls scrollTo on navigation.
Object.defineProperty(window, 'scrollTo', { value: () => undefined, writable: true });
