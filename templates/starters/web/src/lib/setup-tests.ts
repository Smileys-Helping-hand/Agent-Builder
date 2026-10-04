/**
 * Runs before every test file: Testing Library's matchers for Vitest
 * (toBeInTheDocument, toHaveTextContent, toBeDisabled…), and a clean page
 * between tests.
 */
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(() => cleanup());
