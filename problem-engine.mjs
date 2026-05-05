import { rollForward, cellsOf, computeBehavioralMetrics, computeCriticalTiles } from './abyss-engine.mjs';

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

/**
 * محرك البحث في الخريطة (BFS) مخصص لعملية النحت (Carving)
 */
function solveCarvingBFS(startPos, goalPos, tileMap) {
  const queue = [{ x: startPos.x, z: startPos.z, o: 'V', path: [], oChanges: 0 }];
  const visited = new Set();
  visited.add(`${startPos.x},${startPos.z},V`);
  
  while(queue.length > 0) {
    const cur = queue.shift();
    
    if (cur.o === 'V' && cur.x === goalPos.x && cur.z === goalPos.z) {
      return { path: cur.path, oChanges: cur.oChanges };
    }
    
    for (const dir of ['up', 'down', 'left', 'right']) {
      const next = rollForward(cur, dir);
      const footprint = cellsOf(next);
      
      let valid = true;
      for (const [fx, fz] of footprint) {
        const type = tileMap.get(`${fx},${fz}`);
        if (!type) { valid = false; break; }
        if (type === 'fragile' && next.o === 'V') { valid = false; break; }
      }
      if (!valid) continue;
      
      const nk = `${next.x},${next.z},${next.o}`;
      if (!visited.has(nk)) {
        visited.add(nk);
        queue.push({
          ...next,
          path: [...cur.path, dir],
          oChanges: cur.oChanges + (next.o !== cur.o ? 1 : 0)
        });
      }
    }
  }
  return null; 
}

/**
 * تنظيف البلاطات المعزولة تماماً (لا يزيل المسارات الخادعة كما تفعل دالة المحرك القديم)
 */
function pruneIsolatedTiles(data) {
  let changed = true;
  let tiles = [...data.tiles];
  
  while (changed) {
    changed = false;
    const currentSet = new Set(tiles.map(t => `${t.x},${t.z}`));
    const newTiles = tiles.filter(t => {
      // لا تحذف أبداً نقطة البداية أو الهدف
      if (t.x === data.start_state.pos.x && t.z === data.start_state.pos.z) return true;
      if (t.x === data.hole_pos.x && t.z === data.hole_pos.z) return true;
      
      const hasNeighbor =
        currentSet.has(`${t.x + 1},${t.z}`) || 
        currentSet.has(`${t.x - 1},${t.z}`) ||
        currentSet.has(`${t.x},${t.z + 1}`) || 
        currentSet.has(`${t.x},${t.z - 1}`);
        
      if (!hasNeighbor) { changed = true; return false; }
      return true;
    });
    tiles = newTiles;
  }
  return { ...data, tiles };
}

export function buildProblemFirstLevel({ seed = 42, gridSize = 10, iterations = 1000, mechanics = {} }) {
  const rng = makeRNG(seed);
  const width = gridSize;
  const length = gridSize;
  
  // 1. لوح صلب
  const tileMap = new Map();
  for (let x = 0; x < width; x++) {
    for (let z = 0; z < length; z++) {
      tileMap.set(`${x},${z}`, 'normal');
    }
  }

  let sx = 1 + Math.floor(rng() * 2);
  let sz = 1 + Math.floor(rng() * 2);
  let gx = width - 2 - Math.floor(rng() * 2);
  let gz = length - 2 - Math.floor(rng() * 2);

  const startPos = { x: sx, z: sz };
  const goalPos = { x: gx, z: gz };
  const startKey = `${startPos.x},${startPos.z}`;
  const goalKey = `${goalPos.x},${goalPos.z}`;

  let currentResult = solveCarvingBFS(startPos, goalPos, tileMap);
  if (!currentResult) throw new Error("اللوح الأولي غير قابل للحل!");
  
  let currentFitness = currentResult.path.length + 1.5 * currentResult.oChanges;
  const fragileEnabled = mechanics.fragile !== false;

  // 2. النحت الإجباري
  for (let i = 0; i < iterations; i++) {
    const x = Math.floor(rng() * width);
    const z = Math.floor(rng() * length);
    const k = `${x},${z}`;

    if (k === startKey || k === goalKey) continue;

    // حساب عدد الهشة حالياً للحد منها
    let currentFragile = 0;
    for (const t of tileMap.values()) if (t === 'fragile') currentFragile++;

    let action = 'remove';
    // نسبة وضع الفخاخ قليلة (10%) وبحد أقصى 3 فقط
    if (fragileEnabled && rng() < 0.10 && currentFragile < 3) {
      action = 'fragile';
    }

    const oldType = tileMap.get(k);

    if (action === 'remove') {
      if (!oldType) continue; 
      tileMap.delete(k);
    } else {
      if (!oldType || oldType === 'fragile') continue;
      tileMap.set(k, 'fragile');
    }

    const newResult = solveCarvingBFS(startPos, goalPos, tileMap);
    let revert = false;

    if (!newResult) {
      revert = true;
    } else {
      const newFitness = newResult.path.length + 1.5 * newResult.oChanges;
      if (newFitness >= currentFitness) {
        currentFitness = newFitness;
        currentResult = newResult;
      } else {
        revert = true; 
      }
    }

    if (revert) {
      if (oldType) tileMap.set(k, oldType);
      else tileMap.delete(k);
    }
  }

  // 3. مرحلة التمويه (Obfuscation Phase) - بناء مسارات خادعة
  const emptyCells = [];
  for (let x = 0; x < width; x++) {
    for (let z = 0; z < length; z++) {
      if (!tileMap.has(`${x},${z}`)) emptyCells.push({x, z});
    }
  }
  emptyCells.sort(() => rng() - 0.5);

  let decoysAdded = 0;
  // بناء مسارات خادعة تتناسب مع حجم الشبكة
  const maxDecoys = Math.floor(gridSize * 1.8); 

  for (const cell of emptyCells) {
    if (decoysAdded >= maxDecoys) break;
    const k = `${cell.x},${cell.z}`;
    
    // يجب أن تكون متصلة بالمسار لكي تشكل تفرعاً
    const hasNeighbor = 
      tileMap.has(`${cell.x+1},${cell.z}`) || 
      tileMap.has(`${cell.x-1},${cell.z}`) || 
      tileMap.has(`${cell.x},${cell.z+1}`) || 
      tileMap.has(`${cell.x},${cell.z-1}`);
      
    if (!hasNeighbor) continue;

    tileMap.set(k, 'normal');
    const newResult = solveCarvingBFS(startPos, goalPos, tileMap);
    
    if (!newResult) {
      tileMap.delete(k);
    } else {
      const newFitness = newResult.path.length + 1.5 * newResult.oChanges;
      // لا نقبل البلاطة إذا كانت تقدم اختصاراً أسهل للمسار الرئيسي!
      if (newFitness >= currentFitness) {
        decoysAdded++;
      } else {
        tileMap.delete(k);
      }
    }
  }

  // 4. حقن البلاطات المتداعية (بحد أقصى 2 فقط)
  if (mechanics.crumbling !== false) {
    const visitCount = new Map();
    let cur = { x: startPos.x, z: startPos.z, o: 'V' };
    visitCount.set(`${cur.x},${cur.z}`, 1);
    
    for (const dir of currentResult.path) {
      cur = rollForward(cur, dir);
      for (const [fx, fz] of cellsOf(cur)) {
        const k = `${fx},${fz}`;
        visitCount.set(k, (visitCount.get(k) || 0) + 1);
      }
    }

    let crumblingPlaced = 0;
    const candidates = [];
    for (const [k, count] of visitCount) {
      if (count === 1 && k !== startKey && k !== goalKey && tileMap.get(k) === 'normal') {
        candidates.push(k);
      }
    }
    candidates.sort(() => rng() - 0.5);
    
    for (const k of candidates) {
      if (crumblingPlaced >= 2) break;
      tileMap.set(k, 'crumbling');
      crumblingPlaced++;
    }
  }

  // 5. بناء هيكل المستوى
  const tiles = [];
  for (const [k, type] of tileMap.entries()) {
    const [x, z] = k.split(',').map(Number);
    tiles.push({ x, z, type });
  }

  const rawLevel = {
    level_metadata: {
      id: `prob_${seed.toString(16)}`,
      seed: seed,
      generator_mode: "problem_first_carving",
      iterations: iterations,
      grid_size: gridSize
    },
    world_settings: { environment: "abyss_default", gravity: 1.0 },
    start_state: {
      pos: { x: startPos.x, z: startPos.z },
      orientation: "vertical"
    },
    hole_pos: { x: goalPos.x, z: goalPos.z },
    tiles: tiles,
    solution_data: currentResult.path
  };

  // نستخدم دالة التنظيف الجديدة بدلاً من دالة المحرك القديم
  const cleanLevel = pruneIsolatedTiles(rawLevel);
  
  const ct = computeCriticalTiles(cleanLevel);
  const metrics = computeBehavioralMetrics(cleanLevel, ct);
  
  cleanLevel.level_metadata.computed_difficulty = metrics.behavioral_difficulty;
  cleanLevel.level_metadata.behavioral_analysis = {
    ...metrics,
    puzzle_efficiency: +(currentResult.path.length / cleanLevel.tiles.length).toFixed(2)
  };

  return cleanLevel;
}
