#!/usr/bin/env node

import http from "node:http";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { buildProblemFirstLevel } from "../problem-engine.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");

const PORT = Number(process.env.WORKBENCH_PORT ?? 5174);
const BASE_URL = String(
  process.env.BASE_URL ?? "https://abyss-levels.encryptosystem.com"
).trim().replace(/\/+$/, "");
const API_TOKEN = String(process.env.API_TOKEN ?? process.env.TOKEN ?? "").trim();
const READ_TIMEOUT_MS = 15000;

function json(res, statusCode, payload) {
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};
  return JSON.parse(raw);
}

function withTimeout(ms) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), ms);
  return {
    signal: controller.signal,
    clear: () => clearTimeout(t),
  };
}

async function fetchCloud(pathname, options = {}) {
  const headers = new Headers(options.headers ?? {});
  if (API_TOKEN) headers.set("x-api-token", API_TOKEN);
  const timeout = withTimeout(READ_TIMEOUT_MS);
  try {
    return await fetch(`${BASE_URL}${pathname}`, {
      ...options,
      headers,
      signal: timeout.signal,
    });
  } finally {
    timeout.clear();
  }
}

async function fetchLevel(slot) {
  const response = await fetchCloud(`/levels/${slot}`);
  if (response.status === 404) return null;
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Cloud GET /levels/${slot} failed (${response.status}): ${text.slice(0, 200)}`);
  }
  return response.json();
}

async function handleApi(req, res, url) {
  if (url.pathname === "/api/config" && req.method === "GET") {
    json(res, 200, {
      baseUrl: BASE_URL,
      tokenConfigured: Boolean(API_TOKEN),
      warning: API_TOKEN ? null : "API token not set. Publishing may fail.",
    });
    return;
  }

  if (url.pathname === "/api/levels" && req.method === "GET") {
    const start = Math.max(1, Number(url.searchParams.get("start") ?? 1));
    const end = Math.max(start, Number(url.searchParams.get("end") ?? 50));
    const out = [];
    for (let slot = start; slot <= end; slot++) {
      try {
        const level = await fetchLevel(slot);
        if (!level) continue;
        out.push({
          slot,
          id: level?.level_metadata?.id ?? `slot_${slot}`,
          seed: level?.level_metadata?.seed ?? null,
          difficulty: level?.level_metadata?.computed_difficulty ?? null,
          generatorMode: level?.level_metadata?.generator_mode ?? null,
        });
      } catch (err) {
        out.push({
          slot,
          error: err.message,
        });
      }
    }
    json(res, 200, { start, end, levels: out });
    return;
  }

  const levelMatch = url.pathname.match(/^\/api\/levels\/(\d+)$/);
  if (levelMatch && req.method === "GET") {
    const slot = Number(levelMatch[1]);
    try {
      const level = await fetchLevel(slot);
      if (!level) {
        json(res, 404, { error: `Slot ${slot} not found` });
        return;
      }
      json(res, 200, { slot, level });
    } catch (err) {
      json(res, 502, { error: err.message });
    }
    return;
  }

  if (levelMatch && req.method === "PUT") {
    const slot = Number(levelMatch[1]);
    try {
      const body = await readJsonBody(req);
      if (!body || typeof body !== "object") {
        json(res, 400, { error: "Invalid level payload" });
        return;
      }
      const response = await fetchCloud(`/levels/${slot}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const text = await response.text();
      if (!response.ok) {
        json(res, 502, { error: `Cloud PUT failed (${response.status})`, details: text.slice(0, 400) });
        return;
      }
      json(res, 200, { ok: true, slot, status: response.status });
    } catch (err) {
      json(res, 500, { error: err.message });
    }
    return;
  }

  if (url.pathname === "/api/generate" && req.method === "POST") {
    try {
      const body = await readJsonBody(req);
      const slot = Math.max(1, Number(body.slot ?? 1));
      const seed = Number(body.seed ?? Date.now() % 100000);
      const gridSize = Number(body.gridSize ?? 9);
      const iterations = Number(body.iterations ?? 1600);
      const mechanics = body.mechanics ?? {
        fragile: true,
        crumbling: true,
        moving: true,
        portal: false,
      };

      if (!Number.isInteger(seed) || !Number.isInteger(gridSize) || !Number.isInteger(iterations)) {
        json(res, 400, { error: "slot, seed, gridSize, iterations must be integers" });
        return;
      }

      const level = buildProblemFirstLevel({
        seed,
        gridSize,
        iterations,
        mechanics,
      });
      level.level_metadata.slot = slot;

      json(res, 200, { slot, level });
    } catch (err) {
      json(res, 500, { error: err.message });
    }
    return;
  }

  json(res, 404, { error: "Not found" });
}

const STATIC_FILES = new Map([
  ["/", "level-workbench.html"],
  ["/level-workbench.html", "level-workbench.html"],
  ["/level-workbench.css", "level-workbench.css"],
  ["/level-workbench.js", "level-workbench.js"],
]);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url);
      return;
    }

    const rel = STATIC_FILES.get(url.pathname);
    if (!rel) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }

    const abs = path.join(PROJECT_ROOT, rel);
    const data = await readFile(abs);
    const ext = path.extname(abs);
    res.writeHead(200, { "Content-Type": MIME[ext] ?? "application/octet-stream" });
    res.end(data);
  } catch (err) {
    json(res, 500, { error: err.message });
  }
});

server.listen(PORT, () => {
  console.log(`Level Workbench running on http://localhost:${PORT}`);
  console.log(`Cloud base URL: ${BASE_URL}`);
  console.log(`API token configured: ${API_TOKEN ? "yes" : "no"}`);
});
