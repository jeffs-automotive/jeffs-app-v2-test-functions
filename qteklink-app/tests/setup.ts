/**
 * Vitest global setup for qteklink-app (mirrors admin-app/tests/setup.ts).
 *
 * - @testing-library/jest-dom: extends Vitest's `expect` with DOM matchers
 * - RTL handles after-each cleanup since v14
 *
 * Wire MSW server.listen()/close() here once component/DAL tests need to mock
 * the QBO Accounting API or Tekmetric over fetch (MSW intercepts at the fetch
 * boundary — same pattern the qbo-api-client client tests already use).
 */
import "@testing-library/jest-dom/vitest";
