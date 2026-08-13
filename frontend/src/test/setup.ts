import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
  value: () => null,
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
