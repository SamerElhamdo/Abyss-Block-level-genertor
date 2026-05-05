#!/usr/bin/env node
/**
 * Publish generated levels one-by-one to API endpoint.
 *
 * Environment variables:
 *   BASE_URL       API base URL (default: https://abyss-levels.encryptosystem.com)
 *   API_TOKEN      Required API token for x-api-token header
 *   LEVELS_DIR     Relative levels directory (default: levels)
 *   START_SLOT     Optional start slot filter (inclusive)
 *   END_SLOT       Optional end slot filter (inclusive)
 *   USE_LVL_ID     Use /levels/lvl_{slot} endpoint instead of numeric slot
 *   DRY_RUN        If "1", prints requests without sending
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");

function normalizeBaseUrl(url) {
  return String(url ?? "")
    .trim()
    .replace(/\/+$/, "");
}

function parseOptionalInt(value, label) {
  if (value === undefined || value === "") return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    throw new Error(`${label} must be an integer`);
  }
  return parsed;
}

function extractSlotFromFileName(fileName) {
  const m = fileName.match(/^(\d+)\.json$/);
  return m ? Number(m[1]) : null;
}

async function loadLevelFiles(levelsDirAbs) {
  const entries = await fs.readdir(levelsDirAbs, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => /^\d+\.json$/.test(name))
    .sort((a, b) => Number(a.replace(".json", "")) - Number(b.replace(".json", "")));
}

async function readJson(filePath) {
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw);
}

async function main() {
  const baseUrl = normalizeBaseUrl(
    process.env.BASE_URL ?? "https://abyss-levels.encryptosystem.com"
  );
  if (!baseUrl) {
    console.error("BASE_URL is required");
    process.exit(1);
  }

  const apiToken = (process.env.API_TOKEN ?? process.env.TOKEN ?? "").trim();
  if (!apiToken) {
    console.error("API_TOKEN (or TOKEN) is required");
    process.exit(1);
  }

  const levelsDirRel = (process.env.LEVELS_DIR ?? "levels").trim();
  const levelsDirAbs = path.resolve(PROJECT_ROOT, levelsDirRel);
  const useLvlId = process.env.USE_LVL_ID === "1";
  const dryRun = process.env.DRY_RUN === "1";
  const startSlot = parseOptionalInt(process.env.START_SLOT, "START_SLOT");
  const endSlot = parseOptionalInt(process.env.END_SLOT, "END_SLOT");

  const files = await loadLevelFiles(levelsDirAbs);
  if (files.length === 0) {
    console.error(`No level files found in ${levelsDirAbs}`);
    process.exit(1);
  }

  const selectedFiles = files.filter((file) => {
    const slot = extractSlotFromFileName(file);
    if (slot === null) return false;
    if (startSlot !== null && slot < startSlot) return false;
    if (endSlot !== null && slot > endSlot) return false;
    return true;
  });

  if (selectedFiles.length === 0) {
    console.error("No files matched START_SLOT/END_SLOT filters");
    process.exit(1);
  }

  console.log(`Publishing ${selectedFiles.length} level(s) from ${levelsDirRel}`);
  console.log(`Base URL: ${baseUrl}`);
  console.log(`Endpoint mode: ${useLvlId ? "lvl_{slot}" : "numeric slot"}`);
  if (dryRun) console.log("DRY_RUN=1 (no requests will be sent)");
  console.log();

  const results = [];

  for (const fileName of selectedFiles) {
    const slot = extractSlotFromFileName(fileName);
    if (slot === null) continue;

    const filePath = path.join(levelsDirAbs, fileName);
    let payload;
    try {
      payload = await readJson(filePath);
    } catch (err) {
      console.error(`✗ slot ${slot}: failed to read/parse ${fileName}: ${err.message}`);
      results.push({ slot, ok: false });
      continue;
    }

    const identifier = useLvlId ? `lvl_${slot}` : String(slot);
    const url = `${baseUrl}/levels/${identifier}`;

    if (dryRun) {
      console.log(`· [DRY] PUT ${url}  <= ${fileName}`);
      results.push({ slot, ok: true });
      continue;
    }

    try {
      const response = await fetch(url, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "x-api-token": apiToken,
        },
        body: JSON.stringify(payload),
      });

      const bodyText = await response.text();
      if (!response.ok) {
        console.error(`✗ slot ${slot}: HTTP ${response.status} ${response.statusText}`);
        if (bodyText) console.error(`  response: ${bodyText.slice(0, 400)}`);
        results.push({ slot, ok: false });
        continue;
      }

      console.log(`✓ slot ${slot}: HTTP ${response.status}`);
      results.push({ slot, ok: true });
    } catch (err) {
      console.error(`✗ slot ${slot}: request failed: ${err.message}`);
      results.push({ slot, ok: false });
    }
  }

  const okCount = results.filter((r) => r.ok).length;
  const failCount = results.length - okCount;
  console.log();
  console.log(`Done: ${okCount}/${results.length} succeeded`);

  if (failCount > 0) {
    const failedSlots = results.filter((r) => !r.ok).map((r) => r.slot).join(", ");
    console.error(`Failed slots: ${failedSlots}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
