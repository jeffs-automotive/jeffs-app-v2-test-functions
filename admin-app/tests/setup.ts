/**
 * Vitest global setup for admin-app (mirrors scheduler-app/tests/setup.ts).
 *
 * - @testing-library/jest-dom: extends Vitest's `expect` with DOM matchers
 * - @testing-library cleanup: auto after-each handled by RTL since v14
 *
 * Wire MSW `server.listen()` / `server.close()` here once component or DAL
 * tests need to mock the orchestrator edge function (the admin-app DAL
 * talks to it over JSON-RPC; MSW intercepts at the fetch boundary).
 */
import "@testing-library/jest-dom/vitest";
