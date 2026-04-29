// =====================================================================
// ABYSS BLOCK — Main App
// =====================================================================
const { useState, useEffect, useRef, useMemo, useCallback } = React;

const PRESETS = [
  { name: "TUTORIAL",   seed: 1001, difficulty: 2, mech: { fragile: false, crumbling: false, moving: false, portal: false } },
  { name: "STANDARD",   seed: 4747, difficulty: 5, mech: { fragile: true,  crumbling: false, moving: false, portal: false } },
  { name: "BRITTLE",    seed: 8821, difficulty: 6, mech: { fragile: true,  crumbling: true,  moving: false, portal: false } },
  { name: "DRIFTING",   seed: 1337, difficulty: 7, mech: { fragile: true,  crumbling: false, moving: true,  portal: false } },
  { name: "FRACTURED",  seed: 6502, difficulty: 8, mech: { fragile: true,  crumbling: true,  moving: false, portal: true  } },
  { name: "ABYSS",      seed: 9999, difficulty: 10, mech: { fragile: true, crumbling: true,  moving: true,  portal: true  } },
];

const DIRS = ["north", "east", "south", "west"];
const DIR_LABEL = { north: "N", east: "E", south: "S", west: "W" };
const DIR_AR    = { north: "شمال", east: "شرق", south: "جنوب", west: "غرب" };

function App() {
  const [difficulty, setDifficulty] = useState(5);
  const [seed, setSeed] = useState(4747);
  const [gridSize, setGridSize] = useState(40);
  const [mech, setMech] = useState({ fragile: true, crumbling: false, moving: false, portal: false });
  // Directional expansion: up to 2 cardinal directions + spread angle (total cone width in degrees)
  const [expansionDirs, setExpansionDirs] = useState([]);
  const [spreadDeg, setSpreadDeg] = useState(90);
  const [level, setLevel] = useState(null);
  const [block, setBlock] = useState(null);
  const [simulating, setSimulating] = useState(false);
  const [simStep, setSimStep] = useState(0);
  const [simSpeed, setSimSpeed] = useState(1);
  const [exportLevelNumber, setExportLevelNumber] = useState(1);
  const [history, setHistory] = useState([]);
  const [activePreset, setActivePreset] = useState("STANDARD");
  const fileInputRef = useRef(null);
  const simRafRef = useRef(0);
  const simSpeedRef = useRef(1);

  const toggleDir = useCallback((d) => {
    setExpansionDirs(prev => {
      if (prev.includes(d)) return prev.filter(x => x !== d);
      if (prev.length >= 2) return [prev[1], d]; // keep last + new
      return [...prev, d];
    });
  }, []);

  useEffect(() => {
    simSpeedRef.current = simSpeed;
  }, [simSpeed]);

  // ---- Generate ----
  const generate = useCallback(() => {
    const log = [];
    const t0 = performance.now();
    const dirStr = expansionDirs.length ? expansionDirs.join("+") : "free";
    log.push({ t: 0, msg: `[INIT]   seed=${seed} difficulty=${difficulty} grid=${gridSize} dir=${dirStr} spread=${spreadDeg}°` });
    log.push({ t: 0, msg: `[STAGE A] Reverse random walk…` });
    const expansionOpts = { directions: expansionDirs, spreadDeg };
    const lvl = window.AbyssEngine.buildLevel({
      difficulty, seed, gridSize, mechanics: mech, expansionOpts,
    });
    const dt = (performance.now() - t0).toFixed(1);
    log.push({ t: dt, msg: `[STAGE A] golden path: ${lvl._internal.pathStates.length} states, ${lvl.solution_data.length} moves` });
    const counts = lvl.tiles.reduce((a, t) => (a[t.type] = (a[t.type] || 0) + 1, a), {});
    log.push({ t: dt, msg: `[STAGE B] tiles: ${Object.entries(counts).map(([k, v]) => `${k}=${v}`).join(" ")}` });
    if (lvl.level_metadata.island_count) {
      log.push({ t: dt, msg: `[ISLAND] ${lvl.level_metadata.island_count} islands generated` });
    }
    log.push({ t: dt, msg: `[DONE]   ready in ${dt}ms` });
    setLevel(lvl);
    setHistory(log);
    setSimulating(false);
    setSimStep(0);
    const s = lvl._internal.pathStates[0];
    setBlock({ x: s.x, z: s.z, o: s.o });
  }, [difficulty, seed, gridSize, mech, expansionDirs, spreadDeg]);

  // ---- Clear ----
  const clearAll = () => {
    setLevel(null);
    setBlock(null);
    setHistory([]);
    setSimulating(false);
  };

  // ---- Simulate ----
  const simulate = useCallback(() => {
    if (!level) return;
    setSimulating(true);
    const states = level._internal.pathStates;
    const baseStepDur = 320; // ms per move at 1x speed
    let i = 0;
    let lastT = performance.now();
    setBlock({ x: states[0].x, z: states[0].z, o: states[0].o });
    setSimStep(0);

    function tick(now) {
      const dt = now - lastT;
      const stepDur = baseStepDur / Math.max(0.1, simSpeedRef.current);
      const p = Math.min(1, dt / stepDur);
      const a = states[i];
      const b = states[i + 1];
      if (!b) {
        setBlock({ x: a.x, z: a.z, o: a.o });
        setSimulating(false);
        return;
      }
      // interp between a and b
      const x = a.x + (b.x - a.x) * p;
      const z = a.z + (b.z - a.z) * p;
      // orientation switches halfway
      const o = p < 0.5 ? a.o : b.o;
      setBlock({ x, z, o, tipFrom: a.o, tipProgress: p });
      if (p >= 1) {
        i++;
        lastT = now;
        setSimStep(i);
        setBlock({ x: b.x, z: b.z, o: b.o });
      }
      simRafRef.current = requestAnimationFrame(tick);
    }
    simRafRef.current = requestAnimationFrame(tick);
  }, [level]);

  useEffect(() => () => cancelAnimationFrame(simRafRef.current), []);

  // ---- Export JSON ----
  const exportJSON = () => {
    if (!level) return;
    const fileLevelNumber = Math.min(1000, Math.max(1, Math.round(Number(exportLevelNumber) || 1)));
    const { _internal, ...clean } = level;
    const blob = new Blob([JSON.stringify(clean, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${fileLevelNumber}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // ---- Import JSON ----
  const importJSON = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        // reconstruct path states for sim if missing
        if (!data._internal) {
          data._internal = { pathStates: reconstructPathStates(data) };
        }
        setLevel(data);
        const s = data.start_state;
        const o = s.orientation === "vertical" ? "V" :
                  s.orientation === "horizontal-x" ? "HX" : "HZ";
        setBlock({ x: s.pos.x, z: s.pos.z, o });
        setHistory([{ t: 0, msg: `[LOAD]   imported ${file.name}` }]);
      } catch (err) {
        alert("Failed to parse JSON: " + err.message);
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  function reconstructPathStates(data) {
    if (!data.solution_data || !data.start_state) return [];
    const states = [];
    let cur = {
      x: data.start_state.pos.x, z: data.start_state.pos.z,
      o: data.start_state.orientation === "vertical" ? "V"
        : data.start_state.orientation === "horizontal-x" ? "HX" : "HZ",
    };
    states.push(cur);
    for (const d of data.solution_data) {
      cur = window.AbyssEngine.rollForward(cur, d);
      states.push(cur);
    }
    return states;
  }

  // ---- Apply preset ----
  const applyPreset = (p) => {
    setActivePreset(p.name);
    setDifficulty(p.difficulty);
    setSeed(p.seed);
    setMech(p.mech);
  };

  const stats = useMemo(() => {
    if (!level) return null;
    const counts = level.tiles.reduce((a, t) => (a[t.type] = (a[t.type] || 0) + 1, a), {});
    const solveSec = (level.solution_data.length * 0.45).toFixed(1);
    let minX=Infinity,maxX=-Infinity,minZ=Infinity,maxZ=-Infinity;
    for (const t of level.tiles) {
      minX=Math.min(minX,t.x);maxX=Math.max(maxX,t.x);
      minZ=Math.min(minZ,t.z);maxZ=Math.max(maxZ,t.z);
    }
    return {
      counts,
      solveSec,
      total: level.tiles.length,
      bbox: `${maxX-minX+1}×${maxZ-minZ+1}`,
      moves: level.solution_data.length,
    };
  }, [level]);

  // first generate on mount
  useEffect(() => { generate(); /* eslint-disable-next-line */ }, []);

  return (
    <div className="abs-app">
      {/* ============ SIDEBAR ============ */}
      <aside className="abs-side">
        <div className="abs-brand">
          <div className="abs-brand-mark">▦</div>
          <div className="abs-brand-text">
            <div className="abs-brand-name">ABYSS BLOCK</div>
            <div className="abs-brand-sub">level architect <span className="abs-ar">مصمم المراحل</span> · v0.4</div>
          </div>
        </div>

        <Section title={<BiText en="01 · GENERATION" ar="التوليد" />}>
          <Field label={<BiText en="DIFFICULTY" ar="الصعوبة" />} value={difficulty}>
            <input
              type="range" min="1" max="10" value={difficulty}
              onChange={(e) => setDifficulty(+e.target.value)}
              className="abs-slider"
            />
            <div className="abs-slider-ticks">
              {Array.from({length:10}).map((_,i)=>(
                <span key={i} className={i+1<=difficulty?"on":""}/>
              ))}
            </div>
          </Field>

          <Field label={<BiText en="SEED" ar="البذرة" />}>
            <div className="abs-row">
              <input
                type="number" value={seed}
                onChange={(e)=>setSeed(+e.target.value || 0)}
                className="abs-input"
              />
              <button className="abs-mini" onClick={()=>setSeed(Math.floor(Math.random()*99999))}>
                ↻
              </button>
            </div>
          </Field>

          <Field label={<BiText en="GRID SIZE" ar="حجم الشبكة" />} value={`${gridSize}²`}>
            <input
              type="range" min="12" max="40" step="2" value={gridSize}
              onChange={(e) => setGridSize(+e.target.value)}
              className="abs-slider"
            />
          </Field>

          <Field label={<BiText en="EXPANSION DIR" ar="اتجاه التوسع" />}
                 value={expansionDirs.length ? expansionDirs.map(d => DIR_LABEL[d]).join("+") : "FREE"}>
            <div className="abs-dir-grid">
              {DIRS.map(d => (
                <button
                  key={d}
                  className={`abs-dir-btn ${expansionDirs.includes(d) ? "active" : ""}`}
                  onClick={() => toggleDir(d)}
                  title={DIR_AR[d]}
                >
                  <span className="abs-dir-en">{DIR_LABEL[d]}</span>
                  <span className="abs-dir-ar">{DIR_AR[d]}</span>
                </button>
              ))}
              <button
                className={`abs-dir-btn abs-dir-clear ${expansionDirs.length === 0 ? "active" : ""}`}
                onClick={() => setExpansionDirs([])}
                title="حر / Free"
              >
                <span className="abs-dir-en">✕</span>
                <span className="abs-dir-ar">حر</span>
              </button>
            </div>
          </Field>

          {expansionDirs.length > 0 && (
            <Field label={<BiText en="SPREAD ANGLE" ar="زاوية الانتشار" />} value={`${spreadDeg}°`}>
              <input
                type="range" min="20" max="180" step="5" value={spreadDeg}
                onChange={(e) => setSpreadDeg(+e.target.value)}
                className="abs-slider"
              />
              <div className="abs-spread-hint abs-mono">
                {spreadDeg <= 40 ? "▸ very narrow" : spreadDeg <= 80 ? "▸ focused" : spreadDeg <= 130 ? "▸ wide" : "▸ open"}
              </div>
            </Field>
          )}
        </Section>

        <Section title={<BiText en="02 · MECHANICS" ar="الميكانيكيات" />}>
          <Toggle
            label="Fragile tiles" labelAr="بلاطات هشة" hint="Break if block stands" hintAr="تتكسر عند الوقوف العمودي"
            checked={mech.fragile}
            onChange={(v)=>setMech({...mech, fragile: v})}
            color="#ff8a3d"
          />
          <Toggle
            label="Crumbling tiles" labelAr="بلاطات متداعية" hint="One-time use" hintAr="استخدام لمرة واحدة"
            checked={mech.crumbling}
            onChange={(v)=>setMech({...mech, crumbling: v})}
            color="#ff5868"
          />
          <Toggle
            label="Moving platforms" labelAr="منصات متحركة" hint="Oscillating tiles" hintAr="بلاطات تتأرجح"
            checked={mech.moving}
            onChange={(v)=>setMech({...mech, moving: v})}
            color="#b380ff"
          />
          <Toggle
            label="Island portals" labelAr="جزر منفصلة" hint="2–4 islands via portals" hintAr="٢–٤ جزر مربوطة بالبوابات"
            checked={mech.portal}
            onChange={(v)=>setMech({...mech, portal: v})}
            color="#66e7f3"
          />
        </Section>

        <Section title={<BiText en="03 · PRESETS" ar="الإعدادات الجاهزة" />}>
          <div className="abs-preset-grid">
            {PRESETS.map((p) => (
              <button
                key={p.name}
                className={`abs-preset ${activePreset===p.name?"active":""}`}
                onClick={() => applyPreset(p)}
              >
                <span className="abs-preset-name">{p.name}</span>
                <span className="abs-preset-meta">D{p.difficulty}</span>
              </button>
            ))}
          </div>
        </Section>

        <div className="abs-actions">
          <button className="abs-btn abs-btn-primary" onClick={generate}>
            <span className="abs-btn-key">⏎</span>
            <BiText en="GENERATE LEVEL" ar="توليد المرحلة" />
          </button>
          <button className="abs-btn" onClick={clearAll}><BiText en="CLEAR GRID" ar="مسح الشبكة" /></button>
        </div>
      </aside>

      {/* ============ MAIN ============ */}
      <main className="abs-main">
        <div className="abs-topbar">
          <div className="abs-topbar-left">
            <span className="abs-crumb">project</span>
            <span className="abs-crumb-sep">/</span>
            <span className="abs-crumb-strong">abyss_block</span>
            <span className="abs-crumb-sep">/</span>
            <span className="abs-crumb-strong">
              {level ? level.level_metadata.id : "untitled"}
            </span>
          </div>
          <div className="abs-topbar-right">
            <span className="abs-pill">
              <span className="abs-dot abs-dot-ok" /> <BiText en="ENGINE READY" ar="المحرك جاهز" />
            </span>
            <span className="abs-pill abs-pill-mono">
              {seed.toString(16).padStart(6,"0").toUpperCase()}
            </span>
          </div>
        </div>

        <div className="abs-canvas-wrap">
          <GridVisualizer
            level={level}
            blockState={block}
            simulating={simulating}
            simStep={simStep}
          />

          {/* legend */}
          <div className="abs-legend">
            <LegendChip color="#52606d" label={<BiText en="NORMAL" ar="عادي" />} />
            <LegendChip color="#ff8a3d" label={<BiText en="FRAGILE" ar="هش" />} />
            <LegendChip color="#ff5868" label={<BiText en="CRUMBLING" ar="متداعي" />} />
            <LegendChip color="#b380ff" label={<BiText en="MOVING" ar="متحرك" />} />
            <LegendChip color="#66e7f3" label={<BiText en="PORTAL" ar="بوابة" />} />
            <LegendChip color="#a6ff8c" label={<BiText en="START" ar="بداية" />} />
            <LegendChip color="#000" border="#66e7f3" label={<BiText en="HOLE" ar="حفرة" />} />
          </div>

          {/* sim progress overlay */}
          {simulating && level && (
            <div className="abs-sim-overlay">
              <span>SIMULATING</span>
              <div className="abs-sim-bar">
                <div
                  className="abs-sim-bar-fill"
                  style={{ width: `${(simStep/level.solution_data.length)*100}%` }}
                />
              </div>
              <span className="abs-mono">{simStep}/{level.solution_data.length}</span>
            </div>
          )}
        </div>

        <footer className="abs-footer">
          <div className="abs-footer-left">
            <div className="abs-export-level">
              <span className="abs-export-level-label abs-mono">
                <BiText en="LEVEL #" ar="رقم المستوى" />
              </span>
              <input
                type="number"
                min="1"
                max="1000"
                value={exportLevelNumber}
                onChange={(e) => {
                  const raw = e.target.value;
                  if (raw === "") {
                    setExportLevelNumber("");
                    return;
                  }
                  const n = Math.min(1000, Math.max(1, Number(raw)));
                  setExportLevelNumber(n);
                }}
                onBlur={() => {
                  const n = Math.min(1000, Math.max(1, Math.round(Number(exportLevelNumber) || 1)));
                  setExportLevelNumber(n);
                }}
                className="abs-input abs-export-level-input"
                aria-label="Export level number"
              />
            </div>
            <button
              className="abs-btn abs-btn-ghost"
              onClick={simulate}
              disabled={!level || simulating}
            >
              ▶ <BiText en="SIMULATE SOLUTION" ar="محاكاة الحل" />
            </button>
            <button
              className="abs-btn abs-btn-ghost"
              onClick={exportJSON}
              disabled={!level}
            >
              ↓ <BiText en="DOWNLOAD level.json" ar="تنزيل الملف" />
            </button>
            <button
              className="abs-btn abs-btn-ghost"
              onClick={() => fileInputRef.current?.click()}
            >
              ↑ <BiText en="IMPORT level.json" ar="استيراد الملف" />
            </button>
            <input
              ref={fileInputRef}
              type="file" accept=".json,application/json"
              style={{display:"none"}} onChange={importJSON}
            />
            <div className="abs-sim-speed">
              <span className="abs-sim-speed-label abs-mono">
                <BiText en={`SPEED ${simSpeed.toFixed(1)}x`} ar="سرعة المحاكاة" />
              </span>
              <input
                type="range"
                min="0.1"
                max="3"
                step="0.1"
                value={simSpeed}
                onChange={(e) => setSimSpeed(+e.target.value)}
                className="abs-slider abs-sim-speed-slider"
                aria-label="Simulation speed"
              />
            </div>
          </div>
          <div className="abs-footer-right abs-mono">
            <BiText en="target:" ar="المنصة:" /> <span className="abs-strong">godot 4.x</span>
          </div>
        </footer>
      </main>

      {/* ============ INSPECTOR (RIGHT) ============ */}
      <aside className="abs-inspector">
        <Section title={<BiText en="STATS" ar="الإحصائيات" />}>
          {stats ? (
            <>
              <Stat k={<BiText en="MOVES TO SOLVE" ar="حركات الحل" />} v={stats.moves} accent />
              <Stat k={<BiText en="EST. SOLVE TIME" ar="زمن الحل التقريبي" />} v={`${stats.solveSec}s`} />
              <Stat k={<BiText en="TOTAL TILES" ar="إجمالي البلاطات" />} v={stats.total} />
              <Stat k={<BiText en="BOUNDING BOX" ar="حدود الخريطة" />} v={stats.bbox} />
              <div className="abs-stat-divider" />
              <Stat k={<BiText en="NORMAL" ar="عادي" />}    v={stats.counts.normal || 0} dotColor="#52606d" />
              <Stat k={<BiText en="FRAGILE" ar="هش" />}   v={stats.counts.fragile || 0} dotColor="#ff8a3d" />
              <Stat k={<BiText en="CRUMBLING" ar="متداعي" />} v={stats.counts.crumbling || 0} dotColor="#ff5868" />
              <Stat k={<BiText en="MOVING" ar="متحرك" />}    v={stats.counts.moving || 0} dotColor="#b380ff" />
              <Stat k={<BiText en="PORTAL" ar="بوابة" />}    v={stats.counts.portal || 0} dotColor="#66e7f3" />
              {level.level_metadata.island_count && (
                <Stat k={<BiText en="ISLANDS" ar="الجزر" />} v={level.level_metadata.island_count} accent />
              )}
            </>
          ) : (
            <div className="abs-empty-line">— no level <span className="abs-ar">لا يوجد مستوى</span> —</div>
          )}
        </Section>

        <Section title={<BiText en="STEP HISTORY" ar="سجل الخطوات" />}>
          <div className="abs-history">
            {history.length === 0 && <div className="abs-empty-line">— idle <span className="abs-ar">خامل</span> —</div>}
            {history.map((h, i) => (
              <div key={i} className="abs-hist-row">
                <span className="abs-hist-t">{String(h.t).padStart(5)}</span>
                <span className="abs-hist-msg">{h.msg}</span>
              </div>
            ))}
          </div>
        </Section>

        <Section title={<BiText en="JSON PREVIEW" ar="معاينة JSON" />}>
          <pre className="abs-jsonprev">
            {level ? JSON.stringify({
              level_metadata: level.level_metadata,
              start_state: level.start_state,
              hole_pos: level.hole_pos,
              tiles: `[${level.tiles.length} entries]`,
              solution_data: `[${level.solution_data.length} moves]`,
            }, null, 2) : "// no level"}
          </pre>
        </Section>
      </aside>
    </div>
  );
}

// ---- helpers --------------------------------------------------------
function Section({ title, children }) {
  return (
    <div className="abs-section">
      <div className="abs-section-title">{title}</div>
      <div className="abs-section-body">{children}</div>
    </div>
  );
}

function Field({ label, value, children }) {
  return (
    <div className="abs-field">
      <div className="abs-field-head">
        <span className="abs-field-label">{label}</span>
        {value !== undefined && <span className="abs-field-value">{value}</span>}
      </div>
      {children}
    </div>
  );
}

function Toggle({ label, labelAr, hint, hintAr, checked, onChange, color }) {
  return (
    <label className={`abs-toggle ${checked?"on":""}`}>
      <span className="abs-toggle-box" style={{borderColor: checked?color:"#2a2f38"}}>
        {checked && <span className="abs-toggle-tick" style={{background:color}} />}
      </span>
      <span className="abs-toggle-text">
        <span className="abs-toggle-label"><BiText en={label} ar={labelAr} /></span>
        <span className="abs-toggle-hint"><BiText en={hint} ar={hintAr} /></span>
      </span>
      <input
        type="checkbox" checked={checked}
        onChange={(e)=>onChange(e.target.checked)}
        style={{display:"none"}}
      />
    </label>
  );
}

function Stat({ k, v, accent, dotColor }) {
  return (
    <div className="abs-stat">
      <span className="abs-stat-k">
        {dotColor && <span className="abs-stat-dot" style={{background: dotColor}}/>}
        {k}
      </span>
      <span className={`abs-stat-v ${accent?"accent":""}`}>{v}</span>
    </div>
  );
}

function LegendChip({ color, border, label }) {
  return (
    <div className="abs-legend-chip">
      <span
        className="abs-legend-sw"
        style={{ background: color, borderColor: border || color }}
      />
      <span>{label}</span>
    </div>
  );
}

function BiText({ en, ar }) {
  return (
    <span className="abs-bilingual">
      <span>{en}</span>
      <span className="abs-ar">{ar}</span>
    </span>
  );
}

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(<App />);
