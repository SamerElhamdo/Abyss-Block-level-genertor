const dom = {
  rangeStart: document.getElementById("range-start"),
  rangeEnd: document.getElementById("range-end"),
  loadLevelsBtn: document.getElementById("load-levels-btn"),
  levelsList: document.getElementById("levels-list"),
  slotInput: document.getElementById("slot-input"),
  seedInput: document.getElementById("seed-input"),
  gridInput: document.getElementById("grid-input"),
  iterInput: document.getElementById("iter-input"),
  mechFragile: document.getElementById("mech-fragile"),
  mechCrumbling: document.getElementById("mech-crumbling"),
  mechMoving: document.getElementById("mech-moving"),
  mechPortal: document.getElementById("mech-portal"),
  loadSlotBtn: document.getElementById("load-slot-btn"),
  generateBtn: document.getElementById("generate-btn"),
  simulateBtn: document.getElementById("simulate-btn"),
  publishBtn: document.getElementById("publish-btn"),
  status: document.getElementById("status-box"),
  jsonPreview: document.getElementById("json-preview"),
  canvas: document.getElementById("level-canvas"),
};

let currentLevel = null;
let currentSlot = Number(dom.slotInput.value);
let blockState = null;
let simRaf = 0;

function setStatus(msg, append = true) {
  const t = `[${new Date().toLocaleTimeString()}] ${msg}`;
  dom.status.textContent = append ? `${dom.status.textContent}\n${t}`.trim() : t;
  dom.status.scrollTop = dom.status.scrollHeight;
}

function summarize(level) {
  if (!level) return "No level";
  return JSON.stringify({
    level_metadata: level.level_metadata,
    start_state: level.start_state,
    hole_pos: level.hole_pos,
    tiles: `[${level.tiles?.length ?? 0}]`,
    solution_data: `[${level.solution_data?.length ?? 0}]`,
  }, null, 2);
}

function orientToShort(o) {
  if (o === "vertical") return "V";
  if (o === "horizontal-x") return "HX";
  return "HZ";
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

function buildStates(level) {
  if (!level?.start_state) return [];
  let cur = {
    x: level.start_state.pos.x,
    z: level.start_state.pos.z,
    o: orientToShort(level.start_state.orientation),
  };
  const states = [cur];
  for (const dir of level.solution_data || []) {
    cur = rollForward(cur, dir);
    states.push(cur);
  }
  return states;
}

function drawLevel(level) {
  const canvas = dom.canvas;
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.floor(rect.width * dpr));
  canvas.height = Math.max(1, Math.floor(rect.height * dpr));
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, rect.width, rect.height);
  ctx.fillStyle = "#070b11";
  ctx.fillRect(0, 0, rect.width, rect.height);

  if (!level || !Array.isArray(level.tiles) || level.tiles.length === 0) return;
  const palette = {
    normal: { fill: "#1d2128", stroke: "#2a2f38", text: "#52606d" },
    fragile: { fill: "#3b1f0e", stroke: "#c2560a", text: "#ff8a3d" },
    crumbling: { fill: "#3a0f14", stroke: "#c8323f", text: "#ff5868" },
    moving: { fill: "#2a1740", stroke: "#7e3fd6", text: "#b380ff" },
    portal: { fill: "#0e2a30", stroke: "#1ec4d6", text: "#66e7f3" },
  };

  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const t of level.tiles) {
    minX = Math.min(minX, t.x);
    maxX = Math.max(maxX, t.x);
    minZ = Math.min(minZ, t.z);
    maxZ = Math.max(maxZ, t.z);
  }
  minX -= 1; minZ -= 1; maxX += 1; maxZ += 1;

  const cols = maxX - minX + 1;
  const rows = maxZ - minZ + 1;
  const cell = Math.max(6, Math.min(rect.width / cols, rect.height / rows));
  const ox = (rect.width - cols * cell) / 2;
  const oy = (rect.height - rows * cell) / 2;

  const toPx = (x, z) => ({
    x: ox + (x - minX) * cell,
    y: oy + (z - minZ) * cell,
  });

  for (let gx = minX; gx <= maxX; gx++) {
    for (let gz = minZ; gz <= maxZ; gz++) {
      const p = toPx(gx, gz);
      ctx.fillStyle = "#121821";
      ctx.fillRect(p.x + cell / 2, p.y + cell / 2, 1, 1);
    }
  }

  for (const t of level.tiles) {
    const p = toPx(t.x, t.z);
    const c = palette[t.type] ?? palette.normal;
    ctx.fillStyle = c.fill;
    ctx.fillRect(p.x + 1, p.y + 1, cell - 2, cell - 2);
    ctx.strokeStyle = c.stroke;
    ctx.strokeRect(p.x + 1.5, p.y + 1.5, cell - 3, cell - 3);
    if (cell >= 14) {
      ctx.fillStyle = c.text;
      ctx.font = `${Math.max(8, Math.floor(cell * 0.38))}px JetBrains Mono, monospace`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const glyph = { fragile: "F", crumbling: "✕", moving: "↔", portal: "◎" }[t.type] || "";
      if (glyph) ctx.fillText(glyph, p.x + cell / 2, p.y + cell / 2 + 1);
    }
  }

  ctx.strokeStyle = "rgba(102,231,243,0.35)";
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 3]);
  const linked = new Set();
  for (const t of level.tiles) {
    if (t.type !== "portal" || !t.target) continue;
    const k = [`${t.x},${t.z}`, `${t.target.x},${t.target.z}`].sort().join("|");
    if (linked.has(k)) continue;
    linked.add(k);
    const a = toPx(t.x, t.z);
    const b = toPx(t.target.x, t.target.z);
    ctx.beginPath();
    ctx.moveTo(a.x + cell / 2, a.y + cell / 2);
    ctx.lineTo(b.x + cell / 2, b.y + cell / 2);
    ctx.stroke();
  }
  ctx.setLineDash([]);

  if (level.start_state?.pos) {
    const p = toPx(level.start_state.pos.x, level.start_state.pos.z);
    ctx.strokeStyle = "#9ef58a";
    ctx.lineWidth = 2;
    ctx.strokeRect(p.x + 2, p.y + 2, cell - 4, cell - 4);
  }
  if (level.hole_pos) {
    const p = toPx(level.hole_pos.x, level.hole_pos.z);
    const cx = p.x + cell / 2;
    const cy = p.y + cell / 2;
    const r = Math.max(3, cell * 0.42);
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0, "#000");
    g.addColorStop(0.6, "#000");
    g.addColorStop(1, "rgba(102,231,243,0.4)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#66e7f3";
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  if (blockState) {
    const p = toPx(blockState.x, blockState.z);
    let w = cell;
    let h = cell;
    if (blockState.o === "HX") w = cell * 2;
    if (blockState.o === "HZ") h = cell * 2;
    ctx.fillStyle = "rgba(0,0,0,0.5)";
    ctx.fillRect(p.x + 4, p.y + 4, w - 2, h - 2);
    const grad = ctx.createLinearGradient(p.x, p.y, p.x + w, p.y + h);
    grad.addColorStop(0, "#a8f0ff");
    grad.addColorStop(1, "#3ec7d8");
    ctx.fillStyle = grad;
    ctx.fillRect(p.x + 2, p.y + 2, w - 4, h - 4);
    ctx.strokeStyle = "#0a0c10";
    ctx.lineWidth = 2;
    ctx.strokeRect(p.x + 2, p.y + 2, w - 4, h - 4);
    ctx.fillStyle = "rgba(255,255,255,0.18)";
    ctx.fillRect(p.x + 2, p.y + 2, w - 4, 4);
    ctx.fillStyle = "rgba(10,12,16,0.65)";
    ctx.font = `bold ${Math.max(10, Math.floor(cell * 0.35))}px JetBrains Mono, monospace`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const marker = blockState.o === "V" ? "■" : blockState.o === "HX" ? "▬" : "▮";
    ctx.fillText(marker, p.x + w / 2, p.y + h / 2);
  }
}

function setCurrent(slot, level) {
  cancelAnimationFrame(simRaf);
  currentSlot = slot;
  currentLevel = level;
  dom.slotInput.value = String(slot);
  dom.seedInput.value = String(level?.level_metadata?.seed ?? dom.seedInput.value);
  blockState = level?.start_state?.pos
    ? {
        x: level.start_state.pos.x,
        z: level.start_state.pos.z,
        o: orientToShort(level.start_state.orientation),
      }
    : null;
  dom.jsonPreview.textContent = summarize(level);
  drawLevel(level);
}

function simulate() {
  if (!currentLevel?.solution_data?.length) return;
  const states = buildStates(currentLevel);
  if (!states.length) return;
  cancelAnimationFrame(simRaf);
  const stepMs = 320;
  const startTs = performance.now();
  const tick = (ts) => {
    const idx = Math.min(states.length - 1, Math.floor((ts - startTs) / stepMs));
    blockState = states[idx];
    drawLevel(currentLevel);
    if (idx < states.length - 1) simRaf = requestAnimationFrame(tick);
  };
  simRaf = requestAnimationFrame(tick);
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(options.headers ?? {}) },
    ...options,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error ?? `Request failed: ${response.status}`);
  }
  return data;
}

async function loadList() {
  const start = Number(dom.rangeStart.value || 1);
  const end = Number(dom.rangeEnd.value || start);
  setStatus(`Loading cloud list [${start}-${end}]...`);
  const data = await api(`/api/levels?start=${start}&end=${end}`);
  dom.levelsList.innerHTML = "";
  for (const item of data.levels) {
    const div = document.createElement("div");
    div.className = "wb-item";
    const mode = item.generatorMode ?? "unknown";
    const seed = item.seed ?? "-";
    const diff = item.difficulty ?? "-";
    if (item.error) {
      div.textContent = `#${item.slot} error: ${item.error}`;
    } else {
      div.textContent = `#${item.slot} | seed ${seed} | diff ${diff} | ${mode}`;
    }
    div.addEventListener("click", async () => {
      document.querySelectorAll(".wb-item").forEach((n) => n.classList.remove("active"));
      div.classList.add("active");
      try {
        const one = await api(`/api/levels/${item.slot}`);
        setCurrent(item.slot, one.level);
        setStatus(`Loaded cloud slot ${item.slot}`);
      } catch (err) {
        setStatus(`Failed loading slot ${item.slot}: ${err.message}`);
      }
    });
    dom.levelsList.appendChild(div);
  }
  setStatus(`Loaded ${data.levels.length} list entries.`);
}

async function loadSlot() {
  const slot = Number(dom.slotInput.value || 1);
  const data = await api(`/api/levels/${slot}`);
  setCurrent(slot, data.level);
  setStatus(`Slot ${slot} loaded from cloud.`);
}

async function generate() {
  const body = {
    slot: Number(dom.slotInput.value || 1),
    seed: Number(dom.seedInput.value || 1),
    gridSize: Number(dom.gridInput.value || 9),
    iterations: Number(dom.iterInput.value || 1600),
    mechanics: {
      fragile: dom.mechFragile.checked,
      crumbling: dom.mechCrumbling.checked,
      moving: dom.mechMoving.checked,
      portal: dom.mechPortal.checked,
    },
  };
  setStatus(`Generating slot ${body.slot} with seed=${body.seed}...`);
  const data = await api("/api/generate", { method: "POST", body: JSON.stringify(body) });
  setCurrent(body.slot, data.level);
  setStatus(`Generated slot ${body.slot} using new problem engine.`);
}

async function publish() {
  if (!currentLevel) {
    setStatus("Nothing to publish. Generate or load a level first.");
    return;
  }
  const slot = Number(dom.slotInput.value || currentSlot || 1);
  setStatus(`Publishing slot ${slot}...`);
  await api(`/api/levels/${slot}`, {
    method: "PUT",
    body: JSON.stringify(currentLevel),
  });
  setStatus(`Published slot ${slot} successfully.`);
}

dom.loadLevelsBtn.addEventListener("click", () => loadList().catch((e) => setStatus(e.message)));
dom.loadSlotBtn.addEventListener("click", () => loadSlot().catch((e) => setStatus(e.message)));
dom.generateBtn.addEventListener("click", () => generate().catch((e) => setStatus(e.message)));
dom.simulateBtn.addEventListener("click", simulate);
dom.publishBtn.addEventListener("click", () => publish().catch((e) => setStatus(e.message)));
window.addEventListener("resize", () => drawLevel(currentLevel));

(async function bootstrap() {
  try {
    const cfg = await api("/api/config");
    setStatus(`Workbench connected to ${cfg.baseUrl}`, false);
    if (cfg.warning) setStatus(cfg.warning);
    await loadList();
  } catch (err) {
    setStatus(`Bootstrap failed: ${err.message}`, false);
  }
})();
