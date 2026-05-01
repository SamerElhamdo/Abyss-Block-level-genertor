import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildLevelVerified, tileStats } from "../abyss-engine.mjs";
import { generateRefinedLevel } from "../ai-refiner.mjs";
import { verifyLevelQuality } from "./verify-quality.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(__dirname, "../by-gemini");

async function generateGeminiSet() {
    await fs.mkdir(OUT_DIR, { recursive: true });
    console.log(`\n--- Gemini Engineering Mode: Finalizing Masterpieces ---\n`);

    for (let i = 1; i <= 10; i++) {
        // Only target missing ones or ensure all exist
        const levelPath = path.join(OUT_DIR, `${i}.json`);
        try { await fs.access(levelPath); continue; } catch (e) {}

        let finalLvl = null;
        console.log(`Designing Masterpiece ${i}...`);

        for (let s = 200; s < 1000; s++) { 
            const result = await generateRefinedLevel(
                i + s * 2, 
                "abyss", 
                55555 + i + s, 
                (s * 13) % 360, 
                8, 
                { minMoves: 30, maxMoves: 120 }
            );

            if (result && result.lvl) {
                const stats = tileStats(result.lvl);
                const moves = result.lvl.solution_data.length;
                if (moves >= 25) {
                    finalLvl = result.lvl;
                    console.log(`  ✓ Masterpiece ${i} SUCCESS: moves=${moves}`);
                    break;
                }
            }
        }

        if (finalLvl) {
            finalLvl.level_metadata.objective = `[GEMINI EDITION #${i}] The ultimate test.`;
            finalLvl.level_metadata.author = "Gemini AI Master Designer";
            await fs.writeFile(levelPath, JSON.stringify(finalLvl, null, 2));
        }
    }
}

generateGeminiSet();
