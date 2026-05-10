/**
 * Vitest global setup.
 *
 * - @testing-library/jest-dom: extends Vitest's `expect` with DOM matchers
 * - @testing-library cleanup: auto after-each handled by RTL since v14
 *
 * Add MSW server.listen()/close() here once we wire MSW handlers (Story 2+).
 */
import "@testing-library/jest-dom/vitest";
