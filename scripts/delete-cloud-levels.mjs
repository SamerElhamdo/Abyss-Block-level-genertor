#!/usr/bin/env node
/**
 * Delete cloud levels in a slot range.
 *
 * Environment variables:
 *   BASE_URL         API base URL (default: https://abyss-levels.encryptosystem.com)
 *   API_TOKEN        Required API token for x-api-token header
 *   START_SLOT       Start slot, inclusive (default: 1)
 *   END_SLOT         End slot, inclusive (default: 500)
 *   USE_LVL_ID       If "1", delete /levels/lvl_{slot} instead of /levels/{slot}
 *   CONTINUE_ON_404  If "1", treat HTTP 404 as success (default: 1)
 *   DRY_RUN          If "1", print deletes without sending requests
 */

function normalizeBaseUrl(url) {
  return String(url ?? "")
    .trim()
    .replace(/\/+$/, "");
}

function parseIntRequired(value, label) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    throw new Error(`${label} must be an integer`);
  }
  return parsed;
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

  const startSlot = parseIntRequired(process.env.START_SLOT ?? "1", "START_SLOT");
  const endSlot = parseIntRequired(process.env.END_SLOT ?? "500", "END_SLOT");
  if (endSlot < startSlot) {
    console.error("END_SLOT must be greater than or equal to START_SLOT");
    process.exit(1);
  }

  const useLvlId = process.env.USE_LVL_ID === "1";
  const continueOn404 = process.env.CONTINUE_ON_404 !== "0";
  const dryRun = process.env.DRY_RUN === "1";

  console.log(`Deleting levels from slot ${startSlot} to ${endSlot}`);
  console.log(`Base URL: ${baseUrl}`);
  console.log(`Endpoint mode: ${useLvlId ? "lvl_{slot}" : "numeric slot"}`);
  console.log(`CONTINUE_ON_404=${continueOn404 ? "1" : "0"}`);
  if (dryRun) console.log("DRY_RUN=1 (no requests will be sent)");
  console.log();

  const results = [];
  for (let slot = startSlot; slot <= endSlot; slot++) {
    const identifier = useLvlId ? `lvl_${slot}` : String(slot);
    const url = `${baseUrl}/levels/${identifier}`;

    if (dryRun) {
      console.log(`· [DRY] DELETE ${url}`);
      results.push({ slot, ok: true });
      continue;
    }

    try {
      const response = await fetch(url, {
        method: "DELETE",
        headers: {
          "x-api-token": apiToken,
        },
      });

      const bodyText = await response.text();
      if (response.ok) {
        console.log(`✓ slot ${slot}: HTTP ${response.status}`);
        results.push({ slot, ok: true });
        continue;
      }

      if (continueOn404 && response.status === 404) {
        console.log(`~ slot ${slot}: HTTP 404 (skipped)`);
        results.push({ slot, ok: true });
        continue;
      }

      console.error(`✗ slot ${slot}: HTTP ${response.status} ${response.statusText}`);
      if (bodyText) console.error(`  response: ${bodyText.slice(0, 400)}`);
      results.push({ slot, ok: false });
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
