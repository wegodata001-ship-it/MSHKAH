import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  PWA_APP_NAME,
  PWA_ICONS,
  PWA_SHORT_NAME,
  PWA_START_URL,
  PWA_SW_VERSION,
} from "@/lib/pwa/config";

describe("PWA setup", () => {
  it("uses customer menu as start URL", () => {
    expect(PWA_START_URL).toBe("/");
  });

  it("service worker does not cache API routes", () => {
    const sw = readFileSync(resolve(process.cwd(), "public/sw.js"), "utf8");
    expect(sw).toMatch(/isApiRequest/);
    expect(sw).toMatch(/if \(isApiRequest\(url\)\) return/);
    expect(sw).toMatch(PWA_SW_VERSION);
  });

  it("manifest defines standalone app name", () => {
    expect(PWA_APP_NAME).toBe("Mishkat Cafe");
    expect(PWA_SHORT_NAME).toBe("Mishkat");
    expect(PWA_ICONS.favicon).toBe("/favicon.ico");
    expect(PWA_ICONS.icon192).toBe("/icon-192.png");
    expect(PWA_ICONS.icon512).toBe("/icon-512.png");
    expect(PWA_START_URL).toBe("/");
    const manifest = readFileSync(resolve(process.cwd(), "src/app/manifest.ts"), "utf8");
    expect(manifest).toMatch(/display:\s*"standalone"/);
    expect(manifest).toMatch(/PWA_APP_NAME/);
    expect(manifest).toMatch(/PWA_ICONS\.icon192/);
    expect(manifest).toMatch(/PWA_ICONS\.icon512/);
    expect(manifest).toMatch(/purpose:\s*"maskable"/);
  });

  it("layout registers PWA manager without changing admin routes", () => {
    const layout = readFileSync(resolve(process.cwd(), "src/app/layout.tsx"), "utf8");
    expect(layout).toMatch(/PwaManager/);
    expect(layout).toMatch(/appleWebApp/);
  });
});
