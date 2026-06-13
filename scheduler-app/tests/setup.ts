/**
 * Vitest global setup.
 *
 * - @testing-library/jest-dom: extends Vitest's `expect` with DOM matchers
 * - @testing-library cleanup: auto after-each handled by RTL since v14
 */
import "@testing-library/jest-dom/vitest";
