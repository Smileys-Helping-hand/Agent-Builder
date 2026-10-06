/**
 * Runs before every test file: Testing Library's matchers for Vitest
 * (toBeInTheDocument, toHaveTextContent, toBeDisabled…), and a clean page
 * between tests — saved data included. Apps save to localStorage; without
 * clearing it, one test's save was the next test's "no saved game", and a
 * build spent a whole pass "fixing" a loadGame that was right.
 */
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(() => {
  cleanup();
  globalThis.localStorage?.clear();
  globalThis.sessionStorage?.clear();
});
