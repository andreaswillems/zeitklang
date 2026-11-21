import { describe, expect, it } from "vitest";
import { LOCAL_REDIRECT_URI, PAGES_REDIRECT_URI, redirectUriForHost } from "./config.ts";

describe("redirectUriForHost", () => {
  it("127.0.0.1 → lokaler Callback auf Port 8080", () => {
    expect(redirectUriForHost("127.0.0.1")).toBe(LOCAL_REDIRECT_URI);
    expect(redirectUriForHost("127.0.0.1")).toBe("https://127.0.0.1:8080/callback");
  });

  it("localhost → lokaler Callback (wie web/config.js)", () => {
    expect(redirectUriForHost("localhost")).toBe(LOCAL_REDIRECT_URI);
  });

  it("Pages-Host → Site-Root (Spezifikation §11)", () => {
    expect(redirectUriForHost("andreaswillems.github.io")).toBe(PAGES_REDIRECT_URI);
    expect(redirectUriForHost("andreaswillems.github.io")).toBe(
      "https://andreaswillems.github.io/zeitklang/",
    );
  });

  it("jeder andere Host → Pages-URL", () => {
    expect(redirectUriForHost("example.com")).toBe(PAGES_REDIRECT_URI);
    expect(redirectUriForHost("192.168.1.10")).toBe(PAGES_REDIRECT_URI);
  });
});
