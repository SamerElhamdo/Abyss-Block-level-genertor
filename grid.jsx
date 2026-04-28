// =====================================================================
// GRID VISUALIZER
// Top-down 2D grid; block draws as tipping rectangle between states.
// =====================================================================
const { useRef, useEffect, useMemo, useState } = React;

const TILE_COLORS = {
  normal:    { fill: "#1d2128", stroke: "#2a2f38", text: "#52606d" },
  fragile:   { fill: "#3b1f0e", stroke: "#c2560a", text: "#ff8a3d" },
  crumbling: { fill: "#3a0f14", stroke: "#c8323f", text: "#ff5868" },
  moving:    { fill: "#2a1740", stroke: "#7e3fd6", text: "#b380ff" },
  portal:    { fill: "#0e2a30", stroke: "#1ec4d6", text: "#66e7f3" },
};

function GridVisualizer({ level, blockState, simulating, simStep, onCellHover }) {
  const canvasRef = useRef(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const wrapRef = useRef(null);
  const animRef = useRef(0);

  // Resize observer
  useEffect(() => {
    if (!wrapRef.current) return;
    const ro = new ResizeObserver(() => {
      const r = wrapRef.current.getBoundingClientRect();
      setSize({ w: Math.max(200, r.width), h: Math.max(200, r.height) });
    });
    ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, []);

  // Compute tile bounds from level
  const bounds = useMemo(() => {
    if (!level) return { minX: -8, maxX: 8, minZ: -8, maxZ: 8 };
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const t of level.tiles) {
      if (t.x < minX) minX = t.x; if (t.x > maxX) maxX = t.x;
      if (t.z < minZ) minZ = t.z; if (t.z > maxZ) maxZ = t.z;
    }
    // pad
    return { minX: minX - 1, maxX: maxX + 1, minZ: minZ - 1, maxZ: maxZ + 1 };
  }, [level]);

  // tile size
  const cell = useMemo(() => {
    const cols = bounds.maxX - bounds.minX + 1;
    const rows = bounds.maxZ - bounds.minZ + 1;
    const cw = size.w / cols;
    const ch = size.h / rows;
    return Math.max(6, Math.min(cw, ch));
  }, [bounds, size]);

  const offset = useMemo(() => {
    const cols = bounds.maxX - bounds.minX + 1;
    const rows = bounds.maxZ - bounds.minZ + 1;
    const totalW = cols * cell;
    const totalH = rows * cell;
    return { x: (size.w - totalW) / 2, y: (size.h - totalH) / 2 };
  }, [bounds, size, cell]);

  function gridToPx(gx, gz) {
    return {
      x: offset.x + (gx - bounds.minX) * cell,
      y: offset.y + (gz - bounds.minZ) * cell,
    };
  }

  // ---- Render -------------------------------------------------------
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = size.w * dpr;
    canvas.height = size.h * dpr;
    canvas.style.width = size.w + "px";
    canvas.style.height = size.h + "px";
    const ctx = canvas.getContext("2d");
    ctx.scale(dpr, dpr);
    drawScene(ctx);
    function loop() {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.scale(dpr, dpr);
      drawScene(ctx);
      animRef.current = requestAnimationFrame(loop);
    }
    cancelAnimationFrame(animRef.current);
    animRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animRef.current);
  }, [level, blockState, size, cell, offset, bounds]);

  function drawScene(ctx) {
    ctx.clearRect(0, 0, size.w, size.h);
    // bg dotted grid
    ctx.fillStyle = "#0a0c10";
    ctx.fillRect(0, 0, size.w, size.h);
    ctx.fillStyle = "#161a21";
    for (let gx = bounds.minX; gx <= bounds.maxX; gx++) {
      for (let gz = bounds.minZ; gz <= bounds.maxZ; gz++) {
        const { x, y } = gridToPx(gx, gz);
        ctx.fillRect(x + cell / 2 - 0.5, y + cell / 2 - 0.5, 1, 1);
      }
    }

    if (!level) return;

    // tiles
    for (const t of level.tiles) {
      const { x, y } = gridToPx(t.x, t.z);
      const c = TILE_COLORS[t.type] || TILE_COLORS.normal;
      ctx.fillStyle = c.fill;
      ctx.fillRect(x + 1, y + 1, cell - 2, cell - 2);
      ctx.strokeStyle = c.stroke;
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 1.5, y + 1.5, cell - 3, cell - 3);

      // glyph
      if (cell >= 14) {
        ctx.fillStyle = c.text;
        ctx.font = `${Math.max(8, Math.floor(cell * 0.38))}px JetBrains Mono, monospace`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        const glyph = {
          fragile: "F", crumbling: "✕", moving: "↔", portal: "◎"
        }[t.type] || "";
        if (glyph) ctx.fillText(glyph, x + cell / 2, y + cell / 2 + 1);
      }
    }

    // portal links
    ctx.strokeStyle = "rgba(102,231,243,0.35)";
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    const seen = new Set();
    for (const t of level.tiles) {
      if (t.type !== "portal" || !t.target) continue;
      const k1 = `${t.x},${t.z}`;
      const k2 = `${t.target.x},${t.target.z}`;
      const k = [k1, k2].sort().join("|");
      if (seen.has(k)) continue;
      seen.add(k);
      const a = gridToPx(t.x, t.z);
      const b = gridToPx(t.target.x, t.target.z);
      ctx.beginPath();
      ctx.moveTo(a.x + cell / 2, a.y + cell / 2);
      ctx.lineTo(b.x + cell / 2, b.y + cell / 2);
      ctx.stroke();
    }
    ctx.setLineDash([]);

    // Hole
    if (level.hole_pos) {
      const { x, y } = gridToPx(level.hole_pos.x, level.hole_pos.z);
      const cx = x + cell / 2, cy = y + cell / 2;
      const r = cell * 0.42;
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

    // Start indicator
    if (level.start_state) {
      const sx = level.start_state.pos.x;
      const sz = level.start_state.pos.z;
      const { x, y } = gridToPx(sx, sz);
      ctx.strokeStyle = "rgba(166,255,140,0.7)";
      ctx.lineWidth = 2;
      ctx.strokeRect(x + 2, y + 2, cell - 4, cell - 4);
      if (cell > 18) {
        ctx.fillStyle = "rgba(166,255,140,0.9)";
        ctx.font = `${Math.floor(cell * 0.3)}px JetBrains Mono`;
        ctx.textAlign = "left";
        ctx.textBaseline = "top";
        ctx.fillText("S", x + 4, y + 4);
      }
    }

    // Block
    if (blockState) {
      drawBlock(ctx, blockState);
    }
  }

  function drawBlock(ctx, s) {
    // s can include fractional position + tipProgress for animation
    const { x, z, o, tipFrom, tipProgress = 0 } = s;
    const px = gridToPx(x, z);

    let w = cell, h = cell;
    if (o === "HX") w = cell * 2;
    if (o === "HZ") h = cell * 2;

    ctx.save();
    // shadow
    ctx.fillStyle = "rgba(0,0,0,0.5)";
    ctx.fillRect(px.x + 4, px.y + 4, w - 2, h - 2);

    // tipping interp: scale during transition
    let scaleX = 1, scaleY = 1;
    if (tipFrom && tipProgress > 0 && tipProgress < 1) {
      const p = tipProgress;
      // fake tipping: small bounce in scale
      const lift = Math.sin(p * Math.PI) * 0.08;
      scaleX = 1 + lift;
      scaleY = 1 + lift;
    }

    const cx = px.x + w / 2, cy = px.y + h / 2;
    ctx.translate(cx, cy);
    ctx.scale(scaleX, scaleY);
    ctx.translate(-w / 2, -h / 2);

    // body
    const grad = ctx.createLinearGradient(0, 0, w, h);
    grad.addColorStop(0, "#a8f0ff");
    grad.addColorStop(1, "#3ec7d8");
    ctx.fillStyle = grad;
    ctx.fillRect(2, 2, w - 4, h - 4);
    ctx.strokeStyle = "#0a0c10";
    ctx.lineWidth = 2;
    ctx.strokeRect(2, 2, w - 4, h - 4);

    // top highlight
    ctx.fillStyle = "rgba(255,255,255,0.18)";
    ctx.fillRect(2, 2, w - 4, 4);

    // orientation indicator
    ctx.fillStyle = "rgba(10,12,16,0.65)";
    ctx.font = `bold ${Math.max(10, Math.floor(cell * 0.35))}px JetBrains Mono, monospace`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const label = o === "V" ? "■" : o === "HX" ? "▬" : "▮";
    ctx.fillText(label, w / 2, h / 2);

    ctx.restore();
  }

  return (
    <div ref={wrapRef} className="abs-grid-wrap">
      <canvas ref={canvasRef} className="abs-grid-canvas" />
      {!level && (
        <div className="abs-grid-empty">
          <div className="abs-grid-empty-title">NO LEVEL LOADED</div>
          <div className="abs-grid-empty-sub">Configure parameters → press [GENERATE]</div>
        </div>
      )}
    </div>
  );
}

window.GridVisualizer = GridVisualizer;
