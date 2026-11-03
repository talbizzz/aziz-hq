import { defineConfig } from "@playwright/test";
export default defineConfig({ testDir: ".", testMatch: "check.spec.ts", use: { baseURL: "http://localhost:8788" }, timeout: 60_000, reporter: "list", workers: 1 });
