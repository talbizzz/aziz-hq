import { defineConfig } from "@playwright/test";
export default defineConfig({ testDir: ".", testMatch: ["check.spec.ts", "tg.spec.ts"], use: { baseURL: "http://localhost:8787" }, timeout: 60_000, reporter: "list" });
