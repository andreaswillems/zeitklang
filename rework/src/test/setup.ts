import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/preact";
import { afterEach } from "vitest";

// Cleanup nach jedem Component-Test (§6).
afterEach(() => {
    cleanup();
});
