import { rollForward, cellsOf, computeBehavioralMetrics, computeCriticalTiles, optimizeSolution, simulateLevel } from './abyss-engine.mjs';
import { applyPatterns } from './scripts/puzzle-patterns.mjs';

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

function solveCarvingBFS(startPos, goalPos, tileMap, portals) {
  const queue = [{ x: startPos.x, z: startPos.z, o: 'V', path: [], oChanges: 0 }];
  const visited = new Set();
  visited.add(`${startPos.x},${startPos.z},V`);
  
  while(queue.length > 0) {
    const cur = queue.shift();
    
    if (cur.o === 'V' && cur.x === goalPos.x && cur.z === goalPos.z) {
      return { path: cur.path, oChanges: cur.oChanges };
    }
    
    for (const dir of ['up', 'down', 'left', 'right']) {
      let next = rollForward(cur, dir);
      const footprint = cellsOf(next);
      
      let valid = true;
      for (const [fx, fz] of footprint) {
        const type = tileMap.get(`${fx},${fz}`);
        if (!type) { valid = false; break; }
        if (type === 'fragile' && next.o === 'V') { valid = false; break; }
      }
      if (!valid) continue;
      
      if (next.o === 'V' && portals && portals.has(`${next.x},${next.z}`)) {
        const tg = portals.get(`${next.x},${next.z}`);
        next = { x: tg.x, z: tg.z, o: 'V' };
      }
      
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

function pruneIsolatedTiles(data) {
  let changed = true;
  let tiles = [...data.tiles];
  
  while (changed) {
    changed = false;
    const currentSet = new Set(tiles.map(t => `${t.x},${t.z}`));
    const newTiles = tiles.filter(t => {
      if (t.x === data.start_state.pos.x && t.z === data.start_state.pos.z) return true;
      if (t.x === data.hole_pos.x && t.z === data.hole_pos.z) return true;
      if (t.type === 'portal' || t.type === 'moving') return true;
      
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
  
  const tileMap = new Map();
  const portals = new Map();
  
  let sx, sz, gx, gz;
  const length = gridSize;
  let totalWidth = gridSize;

  // 1. توليد اللوح المبدئي (إما جزر وبوابات، أو لوح متصل)
  if (mechanics.portal) {
    const islWidth = Math.max(4, Math.floor(gridSize / 1.5));
    const gap = 3;
    totalWidth = islWidth * 2 + gap;
    
    for (let x = 0; x < islWidth; x++) {
      for (let z = 0; z < length; z++) tileMap.set(`${x},${z}`, 'normal');
    }
    for (let x = islWidth + gap; x < totalWidth; x++) {
      for (let z = 0; z < length; z++) tileMap.set(`${x},${z}`, 'normal');
    }
    
    sx = 1 + Math.floor(rng() * 2); 
    sz = 1 + Math.floor(rng() * 2);
    gx = totalWidth - 2 - Math.floor(rng() * 2); 
    gz = length - 2 - Math.floor(rng() * 2);
    
    const px1 = islWidth - 1;
    const pz1 = Math.floor(length / 2);
    const px2 = islWidth + gap;
    const pz2 = Math.floor(length / 2) + (rng() > 0.5 ? 1 : -1);
    
    tileMap.set(`${px1},${pz1}`, 'portal');
    tileMap.set(`${px2},${pz2}`, 'portal');
    portals.set(`${px1},${pz1}`, { x: px2, z: pz2 });
    portals.set(`${px2},${pz2}`, { x: px1, z: pz1 });
  } else {
    for (let x = 0; x < totalWidth; x++) {
      for (let z = 0; z < length; z++) tileMap.set(`${x},${z}`, 'normal');
    }
    sx = 1 + Math.floor(rng() * 2);
    sz = 1 + Math.floor(rng() * 2);
    gx = totalWidth - 2 - Math.floor(rng() * 2);
    gz = length - 2 - Math.floor(rng() * 2);
  }

  const startPos = { x: sx, z: sz };
  const goalPos = { x: gx, z: gz };
  const startKey = `${startPos.x},${startPos.z}`;
  const goalKey = `${goalPos.x},${goalPos.z}`;

  let currentResult = solveCarvingBFS(startPos, goalPos, tileMap, portals);
  if (!currentResult) throw new Error("اللوح الأولي غير قابل للحل!");
  
  let currentFitness = currentResult.path.length + 1.5 * currentResult.oChanges;
  const fragileEnabled = mechanics.fragile !== false;

  // 2. النحت الإجباري (Carving)
  for (let i = 0; i < iterations; i++) {
    const x = Math.floor(rng() * totalWidth);
    const z = Math.floor(rng() * length);
    const k = `${x},${z}`;

    if (k === startKey || k === goalKey || portals.has(k)) continue;

    let currentFragile = 0;
    for (const t of tileMap.values()) if (t === 'fragile') currentFragile++;

    let action = 'remove';
    if (fragileEnabled && rng() < 0.15 && currentFragile < 3) {
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

    const newResult = solveCarvingBFS(startPos, goalPos, tileMap, portals);
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

  // 3. التمويه (Obfuscation) - مسارات خادعة
  const emptyCells = [];
  for (let x = 0; x < totalWidth; x++) {
    for (let z = 0; z < length; z++) {
      if (!tileMap.has(`${x},${z}`)) emptyCells.push({x, z});
    }
  }
  emptyCells.sort(() => rng() - 0.5);

  let decoysAdded = 0;
  const maxDecoys = Math.floor(gridSize * 1.5); 

  for (const cell of emptyCells) {
    if (decoysAdded >= maxDecoys) break;
    const k = `${cell.x},${cell.z}`;
    
    const hasNeighbor = 
      tileMap.has(`${cell.x+1},${cell.z}`) || 
      tileMap.has(`${cell.x-1},${cell.z}`) || 
      tileMap.has(`${cell.x},${cell.z+1}`) || 
      tileMap.has(`${cell.x},${cell.z-1}`);
      
    if (!hasNeighbor) continue;

    tileMap.set(k, 'normal');
    const newResult = solveCarvingBFS(startPos, goalPos, tileMap, portals);
    
    if (!newResult) {
      tileMap.delete(k);
    } else {
      const newFitness = newResult.path.length + 1.5 * newResult.oChanges;
      if (newFitness >= currentFitness) {
        decoysAdded++;
      } else {
        tileMap.delete(k);
      }
    }
  }

  // حساب مرات الزيارة بناءً على الحل الفعلي الحالي لمعرفة البلاطات المؤهلة للأفخاخ 
  let visitCount = new Map();
  let cur = { x: startPos.x, z: startPos.z, o: 'V' };
  visitCount.set(`${cur.x},${cur.z}`, 1);
  
  for (const dir of currentResult.path) {
    cur = rollForward(cur, dir);
    if (cur.o === 'V' && portals.has(`${cur.x},${cur.z}`)) {
      const tg = portals.get(`${cur.x},${cur.z}`);
      cur = { x: tg.x, z: tg.z, o: 'V' };
    }
    for (const [fx, fz] of cellsOf(cur)) {
      const k = `${fx},${fz}`;
      visitCount.set(k, (visitCount.get(k) || 0) + 1);
    }
  }

  // 4. البلاطات المتحركة (Moving) - معالجة التوقيت الصحيح
  const movingTiles = new Map();
  if (mechanics.moving !== false) {
    let movingPlaced = 0;
    const maxMoving = 2;
    const candidates = [];
    for (const [k, count] of visitCount) {
      if (count === 1 && k !== startKey && k !== goalKey && !portals.has(k) && tileMap.get(k) === 'normal') {
        candidates.push(k);
      }
    }
    candidates.sort(() => rng() - 0.5);

    const tileXArr = [...tileMap.keys()].map(k => Number(k.split(',')[0]));
    const tileZArr = [...tileMap.keys()].map(k => Number(k.split(',')[1]));
    const tMinX = Math.min(...tileXArr), tMaxX = Math.max(...tileXArr);
    const tMinZ = Math.min(...tileZArr), tMaxZ = Math.max(...tileZArr);

    for (const k of candidates) {
      if (movingPlaced >= maxMoving) break;
      const [cx, cz] = k.split(',').map(Number);
      
      const axes = ['x', 'z'].sort(() => rng() - 0.5);
      for (const axis of axes) {
        const center = axis === 'x' ? cx : cz;
        const lo = center - 1;
        const hi = center + 1;
        const kLo = axis === 'x' ? `${lo},${cz}` : `${cx},${lo}`;
        const kHi = axis === 'x' ? `${hi},${cz}` : `${cx},${hi}`;

        if (tileMap.has(kLo) || tileMap.has(kHi)) continue;
        
        if (axis === 'x' && (lo < tMinX - 1 || hi > tMaxX + 1)) continue;
        if (axis === 'z' && (lo < tMinZ - 1 || hi > tMaxZ + 1)) continue;

        const movingParam = {
          axis,
          range: [lo, hi],
          stepsPerPhase: 1 + Math.floor(rng() * 2),
          startPhase: 0
        };

        // نجهز الخريطة المؤقتة لاختبار البلاطة المتحركة وحل التوقيت
        const tempTiles = [];
        for (const [tk, ttype] of tileMap.entries()) {
           const [tx, tz] = tk.split(',').map(Number);
           const t = { x: tx, z: tz, type: tk === k ? 'moving' : ttype };
           if (t.type === 'portal') t.target = portals.get(tk);
           if (t.type === 'moving') t.params = tk === k ? movingParam : movingTiles.get(tk);
           tempTiles.push(t);
        }
        
        const tempLevel = {
           start_state: { pos: { x: startPos.x, z: startPos.z }, orientation: "vertical" },
           hole_pos: { x: goalPos.x, z: goalPos.z },
           tiles: tempTiles,
           solution_data: currentResult.path 
        };
        
        // Optimize الحل مع مراعاة توقيت البلاطات المتحركة
        const optLevel = optimizeSolution(tempLevel);
        
        // المحاكاة النهائية للتأكد من عدم السقوط
        if (simulateLevel(optLevel).ok) {
           tileMap.set(k, 'moving');
           movingTiles.set(k, movingParam);
           currentResult.path = optLevel.solution_data; 
           movingPlaced++;
           break;
        }
      }
    }
  }

  // بعد تعديل البلاطات المتحركة قد يكون الحل الأمثل قد تغيّر، لذا نحدث مرات الزيارة مرة أخرى.
  visitCount.clear();
  cur = { x: startPos.x, z: startPos.z, o: 'V' };
  visitCount.set(`${cur.x},${cur.z}`, 1);
  for (const dir of currentResult.path) {
    cur = rollForward(cur, dir);
    if (cur.o === 'V' && portals.has(`${cur.x},${cur.z}`)) {
      const tg = portals.get(`${cur.x},${cur.z}`);
      cur = { x: tg.x, z: tg.z, o: 'V' };
    }
    for (const [fx, fz] of cellsOf(cur)) {
      visitCount.set(`${fx},${fz}`, (visitCount.get(`${fx},${fz}`) || 0) + 1);
    }
  }

  // 5. البلاطات المتداعية (Crumbling)
  if (mechanics.crumbling !== false) {
    let crumblingPlaced = 0;
    const candidates = [];
    for (const [k, count] of visitCount) {
      if (count === 1 && k !== startKey && k !== goalKey && !portals.has(k) && tileMap.get(k) === 'normal') {
        candidates.push(k);
      }
    }
    candidates.sort(() => rng() - 0.5);
    
    for (const k of candidates) {
      if (crumblingPlaced >= 3) break;
      tileMap.set(k, 'crumbling');
      crumblingPlaced++;
    }
  }

  // تجميع هيكل المرحلة
  const tiles = [];
  for (const [k, type] of tileMap.entries()) {
    const [x, z] = k.split(',').map(Number);
    const tile = { x, z, type };
    if (type === 'portal') {
      tile.target = portals.get(k);
    }
    if (type === 'moving') {
      tile.params = movingTiles.get(k);
    }
    tiles.push(tile);
  }

  let rawLevel = {
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

  // توليد PathStates ليتم تطبيق الأنماط عليها
  const pathStates = [{ x: startPos.x, z: startPos.z, o: 'V' }];
  let curPS = { x: startPos.x, z: startPos.z, o: 'V' };
  for (const dir of currentResult.path) {
    curPS = rollForward(curPS, dir);
    if (curPS.o === 'V' && portals.has(`${curPS.x},${curPS.z}`)) {
      const tg = portals.get(`${curPS.x},${curPS.z}`);
      curPS = { x: tg.x, z: tg.z, o: 'V' };
    }
    pathStates.push(curPS);
  }
  rawLevel._internal = { pathStates };

  // 6. تطبيق أنماط الألغاز (Puzzle Patterns)
  const patternsToApply = ['FRAGILE_BRIDGE', 'ONE_TIME_PATH', 'PRECISION_CORRIDOR'];
  const patRng = makeRNG(seed ^ 0x12345);
  const patLevel = applyPatterns(rawLevel, patternsToApply, patRng);

  // نستخدم دالة التنظيف للحفاظ على المسارات الخادعة
  const cleanLevel = pruneIsolatedTiles(patLevel);
  
  // التحقق النهائي بعد تطبيق الأنماط (في حال كسر أحد الأنماط الحل)
  let finalLevel = cleanLevel;
  if (!simulateLevel(finalLevel).ok) {
     const optLevelFinal = optimizeSolution(finalLevel);
     if (simulateLevel(optLevelFinal).ok) {
        finalLevel.solution_data = optLevelFinal.solution_data;
        finalLevel.tiles = optLevelFinal.tiles;
     } else {
        // إذا فشل كل شيء، نتراجع عن تطبيق الأنماط لنضمن قابليتها للحل
        finalLevel = pruneIsolatedTiles(rawLevel);
     }
  }

  const ct = computeCriticalTiles(finalLevel);
  const metrics = computeBehavioralMetrics(finalLevel, ct);
  
  finalLevel.level_metadata.computed_difficulty = metrics.behavioral_difficulty;
  finalLevel.level_metadata.behavioral_analysis = {
    ...metrics,
    puzzle_efficiency: +(currentResult.path.length / finalLevel.tiles.length).toFixed(2)
  };
  
  if (mechanics.portal) {
    finalLevel.level_metadata.island_count = 2;
  }

  // نحذف البيانات الداخلية
  delete finalLevel._internal;

  return finalLevel;
}
