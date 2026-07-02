/**
 * sentry-stub — no-op @sentry/nextjs replacement for bare-node eval runs.
 * The Next bundle's export surface doesn't fully resolve outside Next
 * (addBreadcrumb missing), and the eval must not report to Sentry anyway.
 */
const noop = () => {};
export const addBreadcrumb = noop;
export const captureException = noop;
export const captureMessage = noop;
export const setTag = noop;
export const setContext = noop;
export const withScope = (fn) =>
  fn({ setTag: noop, setContext: noop, setLevel: noop, setFingerprint: noop });
export const logger = { info: noop, warn: noop, error: noop, debug: noop };
export default {
  addBreadcrumb,
  captureException,
  captureMessage,
  setTag,
  setContext,
  withScope,
  logger,
};
