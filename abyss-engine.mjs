/**
 * محرك Abyss Block — نفس منطق engine.jsx لاستخدامات Node (سطر أوامر) والمتصفح عبر استيراد.
 * لا يعتمد على window.
 */

function makeRNG(seed) {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function rollForward(state, dir) {
  const { x, z, o } = state;
  if (o === "V") {
    if (dir === "right") return { x: x + 1, z, o: "HX" };
    if (dir === "left") return { x: x - 2, z, o: "HX" };
    if (dir === "down") return { x, z: z + 1, o: "HZ" };
    if (dir === "up") return { x, z: z - 2, o: "HZ" };
  } else if (o === "HX") {
    if (dir === "right") return { x: x + 2, z, o: "V" };
    if (dir === "left") return { x: x - 1, z, o: "V" };
    if (dir === "down") return { x, z: z + 1, o: "HX" };
    if (dir === "up") return { x, z: z - 1, o: "HX" };
  } else if (o === "HZ") {
    if (dir === "right") return { x: x + 1, z, o: "HZ" };
    if (dir === "left") return { x: x - 1, z, o: "HZ" };
    if (dir === "down") return { x, z: z + 2, o: "V" };
    if (dir === "up") return { x, z: z - 1, o: "V" };
  }
  return state;
}

function rollReverse(state, dir) {
  const { x, z, o } = state;
  if (o === "V") {
    if (dir === "right") return { x: x - 2, z, o: "HX" };
    if (dir === "left") return { x: x + 1, z, o: "HX" };
    if (dir === "down") return { x, z: z - 2, o: "HZ" };
    if (dir === "up") return { x, z: z + 1, o: "HZ" };
  } else if (o === "HX") {
    if (dir === "right") return { x: x - 1, z, o: "V" };
    if (dir === "left") return { x: x + 2, z, o: "V" };
    if (dir === "down") return { x, z: z - 1, o: "HX" };
    if (dir === "up") return { x, z: z + 1, o: "HX" };
  } else if (o === "HZ") {
    if (dir === "right") return { x: x - 1, z, o: "HZ" };
    if (dir === "left") return { x: x + 1, z, o: "HZ" };
    if (dir === "down") return { x, z: z - 1, o: "V" };
    if (dir === "up") return { x, z: z + 2, o: "V" };
  }
  return state;
}

function cellsOf(state) {
  const { x, z, o } = state;
  if (o === "V") return [[x, z]];
  if (o === "HX") return [[x, z], [x + 1, z]];
  if (o === "HZ") return [[x, z], [x, z + 1]];
  return [[x, z]];
}

function stateKey(s) {
  return `${s.x},${s.z},${s.o}`;
}

function generateGoldenPath(rng, steps, bounds) {
  let cur = { x: 0, z: 0, o: "V" };
  const pathStates = [cur];
  const visitedKeys = new Set([stateKey(cur)]);
  const visitedCells = new Map();
  cellsOf(cur).forEach(([x, z]) => visitedCells.set(`${x},${z}`, 0));

  const dirs = ["up", "down", "left", "right"];

  for (let step = 0; step < steps; step++) {
    const order = [...dirs].sort(() => rng() - 0.5);
    let advanced = false;
    for (const d of order) {
      const prev = rollReverse(cur, d);
      const cells = cellsOf(prev);
      if (
        !cells.every(
          ([x, z]) => x >= bounds.minX && x <= bounds.maxX && z >= bounds.minZ && z <= bounds.maxZ
        )
      )
        continue;
      if (visitedKeys.has(stateKey(prev))) continue;
      cur = prev;
      pathStates.push(cur);
      visitedKeys.add(stateKey(cur));
      cells.forEach(([x, z]) => {
        const k = `${x},${z}`;
        if (!visitedCells.has(k)) visitedCells.set(k, pathStates.length - 1);
      });
      advanced = true;
      break;
    }
    if (!advanced) break;
  }

  pathStates.reverse();
  const solution = [];
  for (let i = 0; i < pathStates.length - 1; i++) {
    const a = pathStates[i];
    const b = pathStates[i + 1];
    for (const d of dirs) {
      const r = rollForward(a, d);
      if (r.x === b.x && r.z === b.z && r.o === b.o) {
        solution.push(d);
        break;
      }
    }
  }
  return { pathStates, solution, visitedCells };
}

function injectHazards(level, opts, rng) {
  const { pathStates } = level;
  const tilesByKey = new Map();

  for (const s of pathStates) {
    for (const [x, z] of cellsOf(s)) {
      const k = `${x},${z}`;
      if (!tilesByKey.has(k)) tilesByKey.set(k, { x, z, type: "normal" });
    }
  }

  const goal = pathStates[pathStates.length - 1];
  const start = pathStates[0];
  const goalKey = `${goal.x},${goal.z}`;
  const startCells = cellsOf(start).map(([x, z]) => `${x},${z}`);

  if (opts.fragile) {
    const verticalCells = new Set();
    const horizontalCells = new Set();
    for (const s of pathStates) {
      for (const [x, z] of cellsOf(s)) {
        const k = `${x},${z}`;
        if (s.o === "V") verticalCells.add(k);
        else horizontalCells.add(k);
      }
    }
    for (const k of horizontalCells) {
      if (verticalCells.has(k)) continue;
      if (k === goalKey) continue;
      if (startCells.includes(k)) continue;
      const t = tilesByKey.get(k);
      if (t && rng() < 0.35) t.type = "fragile";
    }
  }

  if (opts.crumbling) {
    const visitCount = new Map();
    pathStates.forEach((s) => {
      for (const [x, z] of cellsOf(s)) {
        const k = `${x},${z}`;
        visitCount.set(k, (visitCount.get(k) || 0) + 1);
      }
    });
    for (const [k, count] of visitCount) {
      if (count > 1) continue;
      if (k === goalKey) continue;
      if (startCells.includes(k)) continue;
      const t = tilesByKey.get(k);
      if (!t || t.type !== "normal") continue;
      if (rng() < 0.18) t.type = "crumbling";
    }
  }

  if (opts.moving) {
    const candidates = [...tilesByKey.values()].filter(
      (t) =>
        t.type === "normal" &&
        `${t.x},${t.z}` !== goalKey &&
        !startCells.includes(`${t.x},${t.z}`)
    );
    const count = Math.min(3, Math.floor(candidates.length / 30));
    for (let i = 0; i < count; i++) {
      const idx = Math.floor(rng() * candidates.length);
      const c = candidates.splice(idx, 1)[0];
      if (!c) break;
      c.type = "moving";
      const axis = rng() < 0.5 ? "x" : "z";
      const range =
        axis === "x" ? [c.x, c.x + 1 + Math.floor(rng() * 2)] : [c.z, c.z + 1 + Math.floor(rng() * 2)];
      c.params = { axis, range, speed: +(0.8 + rng() * 1.5).toFixed(2) };
    }
  }

  if (opts.portal) {
    const candidates = [...tilesByKey.values()].filter(
      (t) =>
        t.type === "normal" &&
        `${t.x},${t.z}` !== goalKey &&
        !startCells.includes(`${t.x},${t.z}`)
    );
    if (candidates.length >= 6) {
      const a = candidates.splice(Math.floor(rng() * candidates.length), 1)[0];
      candidates.sort((p, q) => {
        const dp = Math.hypot(p.x - a.x, p.z - a.z);
        const dq = Math.hypot(q.x - a.x, q.z - a.z);
        return dq - dp;
      });
      const b = candidates[0];
      a.type = "portal";
      a.target = { x: b.x, z: b.z };
      b.type = "portal";
      b.target = { x: a.x, z: a.z };
    }
  }

  return [...tilesByKey.values()];
}

/** @typedef {{ fragile: boolean; crumbling: boolean; moving: boolean; portal: boolean }} MechanicsOpts */

export function buildLevel({
  difficulty = 5,
  seed = 42,
  mechanics = /** @type {Partial<MechanicsOpts>} */ ({}),
  gridSize = 40,
}) {
  const rng = makeRNG(seed);
  const steps = 8 + difficulty * 6;
  const half = Math.floor(gridSize / 2);
  const bounds = { minX: -half, maxX: half, minZ: -half, maxZ: half };

  /** @type {Required<MechanicsOpts>} */
  const mech = {
    fragile: mechanics.fragile ?? false,
    crumbling: mechanics.crumbling ?? false,
    moving: mechanics.moving ?? false,
    portal: mechanics.portal ?? false,
  };

  const path = generateGoldenPath(rng, steps, bounds);
  const tiles = injectHazards(path, mech, rng);

  const start = path.pathStates[0];
  const goal = path.pathStates[path.pathStates.length - 1];

  return {
    level_metadata: {
      id: `lvl_${seed.toString(16)}_${Date.now().toString(36)}`,
      difficulty,
      seed,
      steps_to_solve: path.solution.length,
    },
    world_settings: { environment: "abyss_default", gravity: 1.0 },
    start_state: {
      pos: { x: start.x, z: start.z },
      orientation:
        start.o === "V" ? "vertical" : start.o === "HX" ? "horizontal-x" : "horizontal-z",
    },
    hole_pos: { x: goal.x, z: goal.z },
    tiles,
    solution_data: path.solution,
    _internal: { pathStates: path.pathStates },
  };
}

export { makeRNG, rollForward, rollReverse, cellsOf, stateKey, generateGoldenPath, injectHazards };
