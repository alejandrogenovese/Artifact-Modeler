// artifact modeler — multi-stage app
const { useState, useEffect, useMemo, useRef } = React;
const H = window.RAW2STG;
const STORAGE_KEY = "artifact_modeler_v2";
const AUTH_KEY = "artifact_modeler_auth_v1";

const STAGES = {
  bronze: { label: "Bronze", subtitle: "Incoming · Raw", schemaHint: "stg_<sigla>_<logical>" },
  silver: { label: "Silver", subtitle: "Intermediate · Clean", schemaHint: "<dp>_inter_<logical>" },
  gold:   { label: "Gold",   subtitle: "Marts · Modelo Estrella", schemaHint: "<dp>_mart_<logical>" },
};
const SOURCE_TYPES_BRONZE = ["NUMERIC","CHARACTER","VARCHAR","DATE","TIMESTAMP","DECIMAL","INTEGER"];
const SOURCE_TYPES_DB = ["VARCHAR","CHAR","INTEGER","DECIMAL","NUMERIC","DATE","TIMESTAMP","BOOLEAN"];

function emptyRow() {
  return {
    id: H.nextId(),
    source_name:"", source_type:"VARCHAR", length:"", pos_desde:"", pos_hasta:"",
    multibyte:false, nullable:true, is_key:false,
    description:"", possible_values:"",
    target_name:"", target_type:"", transformation:"Asignación directa",
    val_formato:false, val_formato_text:"",
    val_vacio_nulo:false, val_vacio_nulo_text:"",
    val_codigo_valido:false, val_codigo_valido_text:"",
  };
}

function defaultStateForStage(stage) {
  const seed = window.SEEDS[stage];
  return JSON.parse(JSON.stringify(seed));
}
function defaultProject() {
  return {
    activeStage: "bronze",
    meta: window.DBT.defaultMeta(),
    stages: {
      bronze: defaultStateForStage("bronze"),
      silver: defaultStateForStage("silver"),
      gold: defaultStateForStage("gold"),
    },
  };
}
function loadProject() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultProject();
    const p = JSON.parse(raw);
    if (!p.stages) return defaultProject();
    // Migración: asegurar p.meta (deducir de schemas legacy si no existe)
    if (!p.meta) {
      p.meta = { ...window.DBT.defaultMeta(), ...window.DBT.inferMetaFromLegacy(p) };
    } else {
      p.meta = { ...window.DBT.defaultMeta(), ...p.meta };
    }
    return p;
  } catch(e){ return defaultProject(); }
}

// =============== Login Portal ===============
function Portal({ onEnter }) {
  const [user, setUser] = useState("");
  const [pwd, setPwd] = useState("");
  const [err, setErr] = useState("");
  const submit = (e) => {
    e.preventDefault();
    if (!user.trim()) { setErr("Ingresá un usuario"); return; }
    onEnter({ user: user.trim(), entered_at: new Date().toISOString() });
  };
  return (
    <div className="portal">
      <div className="portal-art">
        <div>
          <div className="portal-art-mono"><strong>data mesh</strong> · arquitectura medallion</div>
        </div>
        <div>
          <h1 className="portal-art-headline">
            Modelá tu <em>data product</em><br/>de raw a marts.
          </h1>
          <div style={{ marginTop: 28 }} className="portal-art-flow">
            <span className="flow-node">Fuentes</span><span className="flow-arrow">→</span>
            <span className="flow-node">Bronze</span><span className="flow-arrow">→</span>
            <span className="flow-node">Silver</span><span className="flow-arrow">→</span>
            <span className="flow-node gold">Gold</span>
          </div>
        </div>
        <div className="portal-art-mono">
          {STAGES.bronze.schemaHint} → {STAGES.silver.schemaHint} → {STAGES.gold.schemaHint}
        </div>
      </div>
      <form className="portal-form" onSubmit={submit}>
        <div className="portal-brand">
          <div className="portal-brand-mark">⌬</div>
          <div>
            <div className="portal-brand-name">artifact <span>modeler</span></div>
            <div className="portal-brand-meta">célula de diseño y modelado</div>
          </div>
        </div>
        <h2 className="portal-h">Bienvenido</h2>
        <p className="portal-sub">Iniciá sesión para diseñar artefactos de mapeo entre las capas Bronze, Silver y Gold.</p>
        {err && <div className="portal-error">{err}</div>}
        <div className="field">
          <label>Usuario</label>
          <input type="text" value={user} onChange={e=>setUser(e.target.value)} placeholder="m.gomez@empresa.com" autoFocus />
        </div>
        <div className="field">
          <label>Clave</label>
          <input type="password" value={pwd} onChange={e=>setPwd(e.target.value)} placeholder="••••••••" />
        </div>
        <button type="submit" className="portal-submit">Ingresar al modeler</button>
        <div className="portal-foot">
          <span>v0.2 · prototipo</span>
          <a href="#" onClick={e=>{e.preventDefault(); onEnter({user:"invitado", entered_at:new Date().toISOString()});}}>Entrar como invitado</a>
        </div>
      </form>
    </div>
  );
}

// =============== Main App ===============
function App() {
  const [auth, setAuth] = useState(() => {
    try { return JSON.parse(localStorage.getItem(AUTH_KEY)) || null; } catch(e){ return null; }
  });
  if (!auth) {
    return <Portal onEnter={(a)=>{ localStorage.setItem(AUTH_KEY, JSON.stringify(a)); setAuth(a); }} />;
  }
  return <Modeler auth={auth} onLogout={()=>{ localStorage.removeItem(AUTH_KEY); setAuth(null); }} />;
}

function Modeler({ auth, onLogout }) {
  const [project, setProject] = useState(loadProject);
  const [previewMode, setPreviewMode] = useState("json");
  const [toast, setToast] = useState(null);
  const [metaOpen, setMetaOpen] = useState(false);
  const fileRef = useRef(null);

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(project)); } catch(e){}
  }, [project]);

  const stage = project.activeStage;
  const state = project.stages[stage];
  const meta = project.meta;
  const flashToast = (m) => { setToast(m); setTimeout(()=>setToast(null), 1800); };

  const setStageState = (partial) => setProject(p => ({
    ...p, stages: { ...p.stages, [stage]: typeof partial === "function" ? partial(p.stages[stage]) : { ...p.stages[stage], ...partial } }
  }));
  const switchStage = (s) => setProject(p => ({ ...p, activeStage: s }));
  const setMeta = (partial) => setProject(p => ({
    ...p, meta: typeof partial === "function" ? partial(p.meta) : { ...p.meta, ...partial }
  }));

  const issues = useMemo(() => stage === "bronze" ? H.validatePositions(state.rows) : [], [state.rows, stage]);
  const issuesByRow = useMemo(() => { const m={}; for(const i of issues){(m[i.id]=m[i.id]||[]).push(i);} return m; }, [issues]);
  const artifact = useMemo(() => H.buildArtifact(state), [state]);

  // dbt outputs (siempre frescos sobre el project completo)
  const dbtOutputs = useMemo(() => ({
    "bronze.yml":  window.DBT.buildBronzeYaml(project),
    "silver.yml":  window.DBT.buildSilverYaml(project),
    "silver.sql":  window.DBT.buildSilverSql(project),
    "gold.yml":    window.DBT.buildGoldYaml(project),
    "gold.sql":    window.DBT.buildGoldSql(project),
  }), [project]);

  // Lints
  const lintRows = useMemo(() => window.DBT.lintProject(project), [project]);
  const lintMetaIssues = useMemo(() => window.DBT.lintMeta(meta), [meta]);

  const previewText = useMemo(() => {
    if (previewMode === "json") return JSON.stringify(artifact, null, 2);
    if (previewMode === "yaml") return H.toYaml(artifact);
    return dbtOutputs[previewMode] || "";
  }, [artifact, previewMode, dbtOutputs]);

  const stats = useMemo(() => {
    const total = state.rows.length;
    const filled = state.rows.filter(r => r.target_name && r.target_name.trim()).length;
    const keys = state.rows.filter(r => r.is_key).length;
    const constants = state.rows.filter(r => !r.source_name && r.target_name).length;
    const lastPos = state.rows.reduce((m,r) => Math.max(m, parseInt(r.pos_hasta||-1,10)), -1);
    return { total, filled, keys, constants, lastPos: lastPos < 0 ? "—" : (lastPos+1)+" bytes" };
  }, [state.rows]);

  // Row helpers
  const patchRow = (id, partial) => setStageState(s => ({
    ...s, rows: s.rows.map(r => r.id === id ? autoFill({ ...r, ...partial }) : r)
  }));
  function autoFill(r) {
    if (stage === "bronze" && r.pos_desde !== "" && r.length !== "") {
      const c = H.computePosHasta(r.pos_desde, r.length);
      if (c !== "" && String(c) !== String(r.pos_hasta)) r = { ...r, pos_hasta: String(c) };
    }
    return r;
  }
  const addRow = () => setStageState(s => ({ ...s, rows: [...s.rows, emptyRow()] }));
  const removeRow = (id) => setStageState(s => ({ ...s, rows: s.rows.filter(r => r.id !== id) }));
  const dupRow = (id) => setStageState(s => {
    const i = s.rows.findIndex(r => r.id === id); if (i < 0) return s;
    const copy = { ...s.rows[i], id: H.nextId() };
    const rows = [...s.rows]; rows.splice(i+1, 0, copy);
    return { ...s, rows };
  });
  const suggestTarget = (id) => setStageState(s => ({
    ...s, rows: s.rows.map(r => {
      if (r.id !== id) return r;
      const next = { ...r };
      if (!next.target_name || !next.target_name.trim()) next.target_name = H.suggestTargetName(next.source_name);
      if (!next.target_type || !next.target_type.trim()) next.target_type = H.suggestTargetType(next.source_type, next.length, next.multibyte, s.source && s.source.file_type, stage);
      return next;
    })
  }));
  const autoSuggestAll = () => setStageState(s => ({
    ...s, rows: s.rows.map(r => ({
      ...r,
      target_name: r.target_name && r.target_name.trim() ? r.target_name : H.suggestTargetName(r.source_name),
      target_type: r.target_type && r.target_type.trim() ? r.target_type : H.suggestTargetType(r.source_type, r.length, r.multibyte, s.source && s.source.file_type, stage),
    }))
  }));
  const patchSource = (k, v) => setStageState(s => ({ ...s, source: { ...s.source, [k]: v } }));
  const patchTarget = (k, v) => setStageState(s => ({ ...s, target: { ...s.target, [k]: v } }));

  // Save / load / export
  const downloadProject = () => {
    const blob = new Blob([JSON.stringify({ ...project, _format: "artifact-modeler/v2" }, null, 2)], { type: "application/json" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
    a.download = `artifact_${state.target.schema || "p"}_${state.target.table || "t"}.project.json`;
    a.click(); URL.revokeObjectURL(a.href); flashToast("Proyecto guardado");
  };
  const downloadArtifact = () => {
    const text = previewText;
    let mime = "text/plain", ext = "txt";
    if (previewMode === "json") { mime = "application/json"; ext = "json"; }
    else if (previewMode === "yaml" || previewMode.endsWith(".yml")) { mime = "text/yaml"; ext = "yml"; }
    else if (previewMode.endsWith(".sql")) { mime = "text/plain"; ext = "sql"; }
    const blob = new Blob([text], { type: mime });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
    const dpName = (project.meta && project.meta.logical_name) || state.target.table || "artifact";
    const stagePart = previewMode.includes(".") ? previewMode.replace(".", "_") : `${stage}.${ext}`;
    a.download = `${dpName}__${stagePart.replace(/\./g,"_")}.${ext}`;
    a.click(); URL.revokeObjectURL(a.href); flashToast(`${previewMode} descargado`);
  };
  const downloadDbtZip = async () => {
    try {
      const fname = await window.DBT.downloadZip(project);
      flashToast(`ZIP descargado: ${fname}`);
    } catch(e) {
      flashToast("Error al generar ZIP: " + e.message);
    }
  };
  const copyPreview = async () => { try { await navigator.clipboard.writeText(previewText); flashToast("Copiado"); } catch(e){ flashToast("No se pudo copiar"); } };
  const triggerLoad = () => fileRef.current && fileRef.current.click();
  const onLoadFile = (e) => {
    const f = e.target.files && e.target.files[0]; if (!f) return;
    const r = new FileReader();
    r.onload = () => {
      try {
        const d = JSON.parse(r.result);
        if (d.stages && d.activeStage) setProject(d);
        else if (d.stage && d.rows) setStageState(d);
        else throw new Error("Formato no reconocido");
        flashToast("Cargado");
      } catch(err){ flashToast("Error: " + err.message); }
    };
    r.readAsText(f); e.target.value = "";
  };
  const resetStage = () => {
    if (!confirm(`¿Reiniciar el stage ${stage} al ejemplo?`)) return;
    setStageState(defaultStateForStage(stage)); flashToast("Reiniciado");
  };
  const clearStage = () => {
    if (!confirm(`¿Vaciar el stage ${stage}?`)) return;
    setStageState({
      stage,
      source: stage === "bronze"
        ? { file_type:"TXT", file_format:"Ancho Fijo", has_header:false, separator:"N/A", frequency:"Diaria", description:"" }
        : { schema:"", table:"", where_clause:"", description:"" },
      target: { schema:"", table:"", description:"", dist_key:"", sort_keys:[], encode:"AUTO" },
      process_sql:"", rows:[emptyRow()],
    });
  };

  return (
    <React.Fragment>
      <div className="topbar">
        <div className="brand">
          <div className="brand-mark">⌬</div>
          <div className="brand-text">artifact <span>modeler</span></div>
          <div className="brand-meta">{state.target.schema || "—"}.{state.target.table || "—"}</div>
        </div>
        <div className="actions">
          <button className="btn btn-ghost" onClick={triggerLoad}>📂 Cargar</button>
          <button className="btn btn-ghost" onClick={downloadProject}>💾 Guardar</button>
          <button className="btn btn-ghost" onClick={resetStage}>↺ Ejemplo</button>
          <button className="btn btn-ghost" onClick={clearStage}>🗑 Vaciar</button>
          <button className="btn btn-accent" onClick={downloadDbtZip} title="Descarga ZIP con models/ listo para dbt">📦 ZIP dbt</button>
          <input ref={fileRef} type="file" accept=".json,application/json" className="hidden-file" onChange={onLoadFile} />
          <div className="user-chip">
            <div className="avatar">{(auth.user || "?").substring(0,1).toUpperCase()}</div>
            <span>{auth.user}</span>
            <button className="btn btn-ghost btn-tiny" style={{marginLeft:6}} onClick={onLogout}>salir</button>
          </div>
        </div>
      </div>

      <StageBar active={stage} onSwitch={switchStage} project={project} />

      <ProjectMetaPanel
        meta={meta}
        setMeta={setMeta}
        open={metaOpen}
        setOpen={setMetaOpen}
        issues={lintMetaIssues}
      />

      <div className="app">
        <main className="workspace">
          <SourceConfig stage={stage} state={state} patchSource={patchSource} patchProcess={(v)=>setStageState({process_sql:v})} />
          <TargetConfig stage={stage} state={state} patchTarget={patchTarget} />
          <FieldsTable stage={stage} state={state} stats={stats} issuesByRow={issuesByRow}
            patchRow={patchRow} addRow={addRow} removeRow={removeRow} dupRow={dupRow}
            suggestTarget={suggestTarget} autoSuggestAll={autoSuggestAll} />
          <ProcessSection state={state} setProcess={(v)=>setStageState({process_sql:v})} />
        </main>
        <Preview previewText={previewText} previewMode={previewMode} setPreviewMode={setPreviewMode}
          copy={copyPreview} download={downloadArtifact} downloadZip={downloadDbtZip}
          stats={stats} stage={stage} lintRows={lintRows} />
      </div>
      {toast && <div className="toast">{toast}</div>}
    </React.Fragment>
  );
}

function StageBar({ active, onSwitch, project }) {
  return (
    <div className="stage-bar">
      {Object.keys(STAGES).map((s, i) => (
        <React.Fragment key={s}>
          <button className={`stage-tab ${s} ${active === s ? "active" : ""}`} onClick={()=>onSwitch(s)}>
            <span className="dot"></span>
            <span><b style={{fontWeight:600}}>{STAGES[s].label}</b> <span style={{opacity:0.7,fontSize:11}}>· {STAGES[s].subtitle}</span></span>
            <span style={{fontFamily:"IBM Plex Mono, monospace",fontSize:10,opacity:0.6,marginLeft:6}}>{project.stages[s].rows.length}</span>
          </button>
          {i < 2 && <span className="arrow">→</span>}
        </React.Fragment>
      ))}
      <div className="stage-meta">
        <span>stage <b>{STAGES[active].label.toLowerCase()}</b></span>
        <span>schema <b>{project.stages[active].target.schema || "—"}</b></span>
        <span>table <b>{project.stages[active].target.table || "—"}</b></span>
      </div>
    </div>
  );
}

function Field({ label, children, wide, full }) {
  const cls = ["field"]; if (wide) cls.push("field-wide"); if (full) cls.push("field-full");
  return <div className={cls.join(" ")}><label>{label}</label>{children}</div>;
}

function TagList({ values, onChange, placeholder }) {
  const [d, setD] = useState("");
  const commit = () => { const v = d.trim(); if (!v) return; if (values.includes(v)) { setD(""); return; } onChange([...values, v]); setD(""); };
  return (
    <div className="tag-row">
      {values.map((v, i) => (
        <span key={v+i} className="tag">{v}<span className="x" onClick={()=>onChange(values.filter((_,j)=>j!==i))}>×</span></span>
      ))}
      <input className="tag-input" value={d} placeholder={placeholder}
        onChange={e=>setD(e.target.value)}
        onKeyDown={e=>{ if (e.key === "Enter" || e.key === ",") { e.preventDefault(); commit(); } }}
        onBlur={commit} />
    </div>
  );
}

function SourceConfig({ stage, state, patchSource, patchProcess }) {
  const src = state.source || {};
  if (stage === "bronze") {
    return (
      <section className="section">
        <header className="section-head">
          <div className="section-title">Origen — Archivo / Vista <span className="pill">bronze</span></div>
        </header>
        <div className="section-body">
          <div className="form-grid">
            <Field label="Tipo Archivo">
              <select value={src.file_type || "TXT"} onChange={e=>patchSource("file_type", e.target.value)}>
                <option>TXT</option><option>BINARIO</option><option>DB</option>
              </select>
            </Field>
            <Field label="Frecuencia">
              <select value={src.frequency || "Diaria"} onChange={e=>patchSource("frequency", e.target.value)}>
                <option>Diaria</option><option>Mensual</option><option>Trimestral</option><option>Anual</option><option>Bajo demanda</option>
              </select>
            </Field>
            <Field label="Formato registro" wide>
              <input type="text" value={src.file_format || ""} placeholder="Ancho Fijo (2016 posiciones)" onChange={e=>patchSource("file_format", e.target.value)} />
            </Field>
            <Field label="Separador">
              <input className="mono" type="text" value={src.separator || ""} placeholder="N/A" onChange={e=>patchSource("separator", e.target.value)} />
            </Field>
            <Field label="¿Tiene header?">
              <label style={{display:"flex",gap:6,alignItems:"center",paddingTop:6,fontFamily:"IBM Plex Mono, monospace",fontSize:12}}>
                <input type="checkbox" checked={!!src.has_header} onChange={e=>patchSource("has_header", e.target.checked)} />
                {src.has_header ? "Sí, excluir 1ra línea" : "No posee"}
              </label>
            </Field>
            <Field label="Descripción origen" wide>
              <input type="text" value={src.description || ""} onChange={e=>patchSource("description", e.target.value)} />
            </Field>
          </div>
        </div>
      </section>
    );
  }
  return (
    <section className="section">
      <header className="section-head">
        <div className="section-title">
          Origen — Tabla {stage === "silver" ? "Staging RAW" : "Staging (Intermediate)"}
          <span className={`pill ${stage}`}>{stage}</span>
        </div>
      </header>
      <div className="section-body">
        <div className="form-grid">
          <Field label="Schema origen">
            <input className="mono" type="text" value={src.schema || ""} placeholder={stage === "silver" ? "stg_nv" : "c360_tmp"} onChange={e=>patchSource("schema", e.target.value)} />
          </Field>
          <Field label="Tabla origen">
            <input className="mono" type="text" value={src.table || ""} placeholder={stage === "silver" ? "party_physical_address" : "nv_party_physical_address"} onChange={e=>patchSource("table", e.target.value)} />
          </Field>
          <Field label="WHERE clause" wide>
            <input className="mono" type="text" value={src.where_clause || ""} placeholder="proceso_fc = FechaProceso(ODATE)" onChange={e=>patchSource("where_clause", e.target.value)} />
          </Field>
          <Field label="Descripción" full>
            <input type="text" value={src.description || ""} onChange={e=>patchSource("description", e.target.value)} />
          </Field>
        </div>
      </div>
    </section>
  );
}

function TargetConfig({ stage, state, patchTarget }) {
  const t = state.target || {};
  return (
    <section className="section">
      <header className="section-head">
        <div className="section-title">
          Destino — {stage === "bronze" ? "Incoming" : stage === "silver" ? "Intermediate" : "Marts"}
          <span className={`pill ${stage}`}>{STAGES[stage].schemaHint}</span>
        </div>
      </header>
      <div className="section-body">
        <div className="form-grid">
          <Field label="Schema">
            <input className="mono" type="text" value={t.schema || ""} placeholder={stage==="bronze"?"stg_nv":stage==="silver"?"c360_tmp":"c360_tables"} onChange={e=>patchTarget("schema", e.target.value)} />
          </Field>
          <Field label="Table">
            <input className="mono" type="text" value={t.table || ""} placeholder={stage==="bronze"?"nv_empresas":stage==="silver"?"nv_party_physical_address":"lk_cust_use"} onChange={e=>patchTarget("table", e.target.value)} />
          </Field>
          <Field label="Distribution Key">
            <input className="mono" type="text" value={t.dist_key || ""} onChange={e=>patchTarget("dist_key", e.target.value)} />
          </Field>
          <Field label="Encode">
            <select value={t.encode || "AUTO"} onChange={e=>patchTarget("encode", e.target.value)}>
              <option>AUTO</option><option>RAW</option><option>LZO</option><option>ZSTD</option>
            </select>
          </Field>
          <Field label="Sort Keys" wide>
            <TagList values={t.sort_keys || []} onChange={(v)=>patchTarget("sort_keys", v)} placeholder="añadir y ↵" />
          </Field>
          <Field label="Descripción" wide>
            <input type="text" value={t.description || ""} onChange={e=>patchTarget("description", e.target.value)} />
          </Field>
        </div>
      </div>
    </section>
  );
}

function FieldsTable({ stage, state, stats, issuesByRow, patchRow, addRow, removeRow, dupRow, suggestTarget, autoSuggestAll }) {
  const isBronze = stage === "bronze";
  return (
    <section className="section">
      <header className="section-head">
        <div className="section-title">
          Mapeo de Campos
          <span className="pill">{stats.total} {isBronze ? "campos · " + stats.lastPos : "columnas"}</span>
        </div>
        <div style={{display:"flex",gap:6}}>
          <button className="btn btn-soft btn-tiny" onClick={autoSuggestAll}>↺ Auto-sugerir vacíos</button>
          <button className="btn btn-soft btn-tiny" onClick={addRow}>+ Fila</button>
        </div>
      </header>
      <div className="summary-strip">
        <div className="summary-stat"><span className="num">{stats.total}</span><span className="lbl">campos</span></div>
        <div className="summary-stat"><span className="num">{stats.filled}</span><span className="lbl">mapeados</span></div>
        <div className="summary-stat"><span className="num">{stats.keys}</span><span className="lbl">claves</span></div>
        {!isBronze && <div className="summary-stat"><span className="num">{stats.constants}</span><span className="lbl">constantes</span></div>}
        {isBronze && <div className="summary-stat"><span className="num">{stats.lastPos}</span><span className="lbl">long. total</span></div>}
        {Object.keys(issuesByRow).length > 0 && (
          <div className="summary-stat warn"><span className="num">{Object.keys(issuesByRow).length}</span><span className="lbl">issues</span></div>
        )}
      </div>
      <div className="fields-table-wrap">
        <table className="fields-table">
          <thead>
            <tr>
              <th></th><th></th>
              <th colSpan={isBronze?7:2} className="group origen">{isBronze ? "Sistema de Origen" : "Origen"}</th>
              {!isBronze && <th className="group transf">Transformación</th>}
              <th colSpan={isBronze?3:2} className="group destino">Destino</th>
              <th colSpan="5" className="group valid">Validaciones</th>
              <th></th>
            </tr>
            <tr>
              <th style={{width:28}}></th><th style={{width:28}}></th>
              <th>Campo origen</th>
              <th>Tipo</th>
              {isBronze && <><th>Long.</th><th>Pos. desde</th><th>Pos. hasta</th><th title="Multibyte">Mb</th><th>Descripción</th></>}
              {!isBronze && <th>Transformación SQL</th>}
              <th>Campo destino</th>
              <th>Tipo destino</th>
              {isBronze && <th>Transformación</th>}
              <th title="Nullable">Null</th>
              <th title="Es clave">PK</th>
              <th>Val. formato</th>
              <th>Val. vacío</th>
              <th>Val. cód.</th>
              <th>Issues</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {state.rows.map((r, i) => (
              <FieldRow key={r.id} row={r} idx={i} stage={stage}
                patchRow={patchRow} removeRow={removeRow} dupRow={dupRow}
                suggestTarget={suggestTarget} issues={issuesByRow[r.id]} />
            ))}
          </tbody>
        </table>
      </div>
      <button className="add-row" onClick={addRow}>+ Agregar campo {!isBronze && "(o constante: dejá el origen vacío)"}</button>
    </section>
  );
}

function FieldRow({ row, idx, stage, patchRow, removeRow, dupRow, suggestTarget, issues }) {
  const u = (k, v) => patchRow(row.id, { [k]: v });
  const isBronze = stage === "bronze";
  const types = isBronze ? SOURCE_TYPES_BRONZE : SOURCE_TYPES_DB;
  const isConstant = !isBronze && !row.source_name;
  return (
    <tr className={issues && issues.length ? "error" : ""}>
      <td className="row-handle">{idx+1}</td>
      <td className={`row-handle ${isConstant?"const":""}`} title={isConstant?"Constante / derivado":""}>{isConstant ? "λ" : ""}</td>
      <td className="w-source-name">
        <input className="cell-input" value={row.source_name} placeholder={isBronze?"IF5-...":"col_origen"}
          onChange={e=>u("source_name", e.target.value)} onBlur={()=>suggestTarget(row.id)} />
      </td>
      <td className="w-source-type">
        <select className="cell-select" value={types.includes(row.source_type)?row.source_type:types[0]}
          onChange={e=>{ u("source_type", e.target.value); setTimeout(()=>suggestTarget(row.id),0); }}>
          <option value="">—</option>
          {types.map(t=><option key={t}>{t}</option>)}
        </select>
      </td>
      {isBronze && <>
        <td className="w-num">
          <input className="cell-input cell-num" type="number" value={row.length} onChange={e=>u("length", e.target.value)} onBlur={()=>suggestTarget(row.id)} />
        </td>
        <td className="w-num">
          <input className="cell-input cell-num" type="number" value={row.pos_desde} onChange={e=>u("pos_desde", e.target.value)} />
        </td>
        <td className="w-num">
          <input className="cell-input cell-num" type="number" value={row.pos_hasta} onChange={e=>u("pos_hasta", e.target.value)} />
        </td>
        <td className="w-check"><label className="cell-check"><input type="checkbox" checked={row.multibyte}
          onChange={e=>{u("multibyte", e.target.checked); setTimeout(()=>suggestTarget(row.id),0);}} /></label></td>
        <td className="w-text">
          <input className="cell-input" value={row.description} placeholder="Descripción" onChange={e=>u("description", e.target.value)} />
        </td>
      </>}
      {!isBronze && (
        <td className="w-transformation col-divider">
          <textarea className="cell-textarea" value={row.transformation} rows={Math.max(1, (row.transformation||"").split("\n").length)}
            placeholder="Asignación directa | CASE WHEN ... | CURRENT_DATE | 'constante'"
            onChange={e=>u("transformation", e.target.value)} />
        </td>
      )}
      <td className="w-target-name col-divider-strong">
        <input className="cell-input" value={row.target_name} placeholder="auto" onChange={e=>u("target_name", e.target.value)} />
      </td>
      <td className="w-target-type">
        <input className="cell-input" value={row.target_type} placeholder="VARCHAR(n)" onChange={e=>u("target_type", e.target.value)} />
      </td>
      {isBronze && (
        <td className="w-transformation">
          <input className="cell-input" value={row.transformation} onChange={e=>u("transformation", e.target.value)} />
        </td>
      )}
      <td className="w-check col-divider"><label className="cell-check"><input type="checkbox" checked={row.nullable} onChange={e=>u("nullable", e.target.checked)} /></label></td>
      <td className="w-check"><label className="cell-check"><input type="checkbox" checked={row.is_key} onChange={e=>u("is_key", e.target.checked)} /></label></td>
      <ValidationCell enabled={row.val_formato} text={row.val_formato_text}
        onToggle={v=>u("val_formato", v)} onText={v=>u("val_formato_text", v)} placeholder="regex / regla" />
      <ValidationCell enabled={row.val_vacio_nulo} text={row.val_vacio_nulo_text}
        onToggle={v=>u("val_vacio_nulo", v)} onText={v=>u("val_vacio_nulo_text", v)} placeholder="not_null" />
      <ValidationCell enabled={row.val_codigo_valido} text={row.val_codigo_valido_text}
        onToggle={v=>u("val_codigo_valido", v)} onText={v=>u("val_codigo_valido_text", v)} placeholder="A,B,C" />
      <td style={{minWidth:100, padding:"0 6px"}}>
        {issues && issues.map((i,k) => (
          <span key={k} className={`row-issue ${i.type}`} title={i.msg}>{i.type==="gap"?"gap":i.type==="overlap"?"solapa":"✕"}</span>
        ))}
      </td>
      <td className="row-actions">
        <button className="btn btn-tiny btn-soft" onClick={()=>dupRow(row.id)} title="Duplicar">⎘</button>
        <button className="btn btn-tiny btn-danger" onClick={()=>removeRow(row.id)} title="Eliminar">✕</button>
      </td>
    </tr>
  );
}

function ValidationCell({ enabled, text, onToggle, onText, placeholder }) {
  return (
    <td style={{padding:0}}>
      <div style={{display:"flex",alignItems:"center",gap:4,paddingLeft:6}}>
        <input type="checkbox" checked={enabled} onChange={e=>onToggle(e.target.checked)} />
        {enabled && <input className="cell-input w-validation-text" value={text} placeholder={placeholder} onChange={e=>onText(e.target.value)} />}
      </div>
    </td>
  );
}

function ProcessSection({ state, setProcess }) {
  return (
    <section className="section">
      <header className="section-head">
        <div className="section-title">Características del proceso <span className="pill">SQL · reproceso</span></div>
        <div style={{fontSize:11,color:"var(--muted)"}}>Se incluye en el JSON bajo <span className="mono">meta.process_sql</span></div>
      </header>
      <div className="section-body">
        <textarea className="sql-editor" value={state.process_sql || ""}
          placeholder="-- DELETE FROM ... WHERE proceso_fc = FechaProceso(ODATE) ..."
          onChange={e=>setProcess(e.target.value)} spellCheck={false} />
      </div>
    </section>
  );
}

function Preview({ previewText, previewMode, setPreviewMode, copy, download, downloadZip, stats, stage, lintRows }) {
  const html = useMemo(() => highlight(previewText, previewMode), [previewText, previewMode]);

  // ¿Qué stage corresponde al tab activo (para mostrar lints relevantes)?
  const lintStage = useMemo(() => {
    if (previewMode.startsWith("bronze")) return "bronze";
    if (previewMode.startsWith("silver")) return "silver";
    if (previewMode.startsWith("gold")) return "gold";
    return stage;
  }, [previewMode, stage]);
  const stageLints = (lintRows && lintRows[lintStage]) || [];
  const hasErrors = stageLints.some(l => l.level === "error");

  const TABS = [
    { id: "json", label: "artifact.json", cls: "" },
    { id: "yaml", label: "artifact.yml", cls: "" },
    { id: "bronze.yml", label: "bronze · _sources.yml", cls: "dbt" },
    { id: "silver.yml", label: "silver · _models.yml", cls: "dbt" },
    { id: "silver.sql", label: "silver · .sql", cls: "dbt" },
    { id: "gold.yml", label: "gold · _models.yml", cls: "dbt" },
    { id: "gold.sql", label: "gold · .sql", cls: "dbt" },
  ];

  return (
    <aside className="preview">
      <header className="preview-head">
        <div className="preview-tabs">
          {TABS.map(t => (
            <button key={t.id}
              className={`preview-tab ${t.cls} ${previewMode === t.id ? "active" : ""}`}
              onClick={()=>setPreviewMode(t.id)}>{t.label}</button>
          ))}
        </div>
        <div className="preview-actions">
          <button className="btn btn-ghost btn-tiny" onClick={copy}>⎘ Copiar</button>
          <button className="btn btn-soft btn-tiny" onClick={download}>↓ Archivo</button>
          <button className="btn btn-accent btn-tiny" onClick={downloadZip} title="Descarga ZIP completo con models/ listo para dbt">📦 ZIP</button>
        </div>
      </header>
      {stageLints.length > 0 && (previewMode.includes(".") || lintStage !== "bronze") && (
        <div className={`lint-strip ${hasErrors ? "error-strip" : ""}`}>
          {stageLints.slice(0, 8).map((l, i) => (
            <div key={i} className="lint-line">
              <span>{l.level === "error" ? "✕" : "!"}</span>
              <span className="lint-name">{l.target_name}</span>
              <span>—</span>
              <span>{l.msg}</span>
            </div>
          ))}
          {stageLints.length > 8 && <div className="lint-line">… y {stageLints.length - 8} más</div>}
        </div>
      )}
      <div className="preview-body" dangerouslySetInnerHTML={{__html: html}} />
      <footer className="preview-foot">
        <span>{lintStage} · {stats.filled}/{stats.total} cols{stageLints.length > 0 && ` · ${stageLints.length} lints`}</span>
        <span>{previewText.split("\n").length} líneas</span>
      </footer>
    </aside>
  );
}

function escapeHtml(s){ return s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }
function highlight(text, mode){
  const e = escapeHtml(text);
  if (mode === "json") {
    return e
      .replace(/("(?:[^"\\]|\\.)*")(\s*:)/g, '<span class="k">$1</span>$2')
      .replace(/:\s*("(?:[^"\\]|\\.)*")/g, (m,q)=>`: <span class="s">${q}</span>`)
      .replace(/:\s*(true|false|null)\b/g, (m,b)=>`: <span class="b">${b}</span>`)
      .replace(/:\s*(-?\d+(?:\.\d+)?)/g, (m,n)=>`: <span class="n">${n}</span>`);
  }
  if (mode.endsWith(".sql")) {
    const KW = /\b(select|from|where|with|as|cast|case|when|then|else|end|coalesce|null|and|or|not|join|inner|left|right|on|order|by|group|having|union|all|over|partition|distinct|create|table|view|insert|update|delete|set|in|is|like|between|exists|materialized|config|source|ref|md5|convert_timezone|getdate|to_date|to_timestamp|substring|row_number)\b/gi;
    return e
      .replace(/(--[^\n]*)/g, '<span class="b">$1</span>')
      .replace(/('[^']*')/g, '<span class="s">$1</span>')
      .replace(/(\{\{[^}]+\}\})/g, '<span class="k">$1</span>')
      .replace(KW, '<span class="k">$1</span>')
      .replace(/\b(\d+(?:\.\d+)?)\b/g, '<span class="n">$1</span>');
  }
  // yaml (default + .yml)
  return e
    .replace(/^(\s*-?\s*)([A-Za-z_][\w-]*)(\s*:)/gm, '$1<span class="k">$2</span>$3')
    .replace(/:\s*(true|false|null)\b/g, (m,b)=>`: <span class="b">${b}</span>`)
    .replace(/:\s*(-?\d+(?:\.\d+)?)/gm, (m,n)=>`: <span class="n">${n}</span>`)
    .replace(/:\s*("[^"]*")/g, (m,q)=>`: <span class="s">${q}</span>`);
}

function ProjectMetaPanel({ meta, setMeta, open, setOpen, issues }) {
  const D = window.DBT;
  const completeness = useMemo(() => {
    const required = ["data_product", "sigla_aplicativa", "logical_name",
                      "bronze_interface_name", "silver_table_name",
                      "gold_table_kind", "gold_content_name"];
    const filled = required.filter(k => meta[k] && String(meta[k]).trim()).length;
    return { filled, total: required.length };
  }, [meta]);
  const ok = completeness.filled === completeness.total &&
             !issues.some(i => i.level === "error");

  const u = (k) => (e) => setMeta({ [k]: e.target.value });

  // Computed previews
  const computed = {
    bronzeSchema: D.NAME.bronzeSchema(meta),
    bronzeTable:  D.NAME.bronzeTable(meta),
    silverSchema: D.NAME.silverSchema(meta),
    silverTable:  D.NAME.silverTable(meta),
    goldSchema:   D.NAME.goldSchema(meta),
    goldTable:    D.NAME.goldTable(meta),
    goldViewSchema: D.NAME.goldViewSchema(meta),
  };

  const isFact = meta.gold_table_kind === "fact";
  const needsFreq = isFact && (meta.gold_fact_use === "snap" || meta.gold_fact_use === "agr");

  return (
    <div className={`meta-panel ${open ? "open" : ""}`}>
      <div className="meta-panel-head" onClick={()=>setOpen(!open)}>
        <div className="meta-panel-title">Identidad del Data Product</div>
        <div className="meta-panel-summary">
          <span>dp <b className="mono">{meta.data_product || "—"}</b></span>
          <span>sigla <b className="mono">{meta.sigla_aplicativa || "—"}</b></span>
          <span>logical <b className="mono">{meta.logical_name || "—"}</b></span>
          {ok
            ? <span className="badge-ok">✓ completo</span>
            : <span className="badge-warn">{completeness.filled}/{completeness.total} · revisar</span>}
        </div>
      </div>
      <div className="meta-panel-body">
        <div className="meta-grid">
          <div>
            <label>Data Product</label>
            <input type="text" value={meta.data_product} onChange={u("data_product")}
              placeholder="w001" maxLength={6} />
          </div>
          <div>
            <label>Sigla aplicativa</label>
            <input type="text" value={meta.sigla_aplicativa} onChange={u("sigla_aplicativa")}
              placeholder="nv" />
          </div>
          <div>
            <label>Logical name</label>
            <input type="text" value={meta.logical_name} onChange={u("logical_name")}
              placeholder="cliente" />
          </div>
          <div>
            <label>Dominio (opcional)</label>
            <input type="text" value={meta.domain} onChange={u("domain")}
              placeholder="cliente, cuenta_monetaria, …" />
          </div>

          <div className="field-full" style={{height:1, background:"var(--border)", margin:"4px 0"}} />

          <div>
            <label>Bronze · interface name</label>
            <input className="mono" type="text" value={meta.bronze_interface_name}
              onChange={u("bronze_interface_name")}
              placeholder="pr_nv_intd10_dwho_personas" />
          </div>
          <div>
            <label>Silver · table name</label>
            <input className="mono" type="text" value={meta.silver_table_name}
              onChange={u("silver_table_name")}
              placeholder="cliente_individuo" />
          </div>
          <div>
            <label>Silver · materialización</label>
            <select value={meta.silver_materialization} onChange={u("silver_materialization")}>
              <option value="view">view (efímero)</option>
              <option value="table">table (físico)</option>
              <option value="ephemeral">ephemeral (CTE)</option>
            </select>
          </div>
          <div></div>

          <div>
            <label>Gold · tipo</label>
            <select value={meta.gold_table_kind} onChange={u("gold_table_kind")}>
              <option value="dim">dim (lookup/maestro)</option>
              <option value="fact">fact (hechos)</option>
            </select>
          </div>
          <div className={!isFact ? "field-disabled" : ""}>
            <label>Uso fact</label>
            <select value={meta.gold_fact_use} onChange={u("gold_fact_use")} disabled={!isFact}>
              <option value="">—</option>
              <option value="snap">snap (saldos/snapshot)</option>
              <option value="trx">trx (transacciones/eventos)</option>
              <option value="agr">agr (agregaciones)</option>
            </select>
          </div>
          <div className={!needsFreq ? "field-disabled" : ""}>
            <label>Frecuencia</label>
            <select value={meta.gold_frequency} onChange={u("gold_frequency")} disabled={!needsFreq}>
              <option value="">—</option>
              <option value="dia">dia</option>
              <option value="mes">mes</option>
              <option value="trim">trim</option>
              <option value="anio">anio</option>
            </select>
          </div>
          <div>
            <label>Gold · content name</label>
            <input className="mono" type="text" value={meta.gold_content_name}
              onChange={u("gold_content_name")}
              placeholder="cliente_individuo" />
          </div>
        </div>

        <div className="meta-preview">
          <div className="meta-preview-label">bronze schema.tabla</div>
          <div className="meta-preview-value">{computed.bronzeSchema}.{computed.bronzeTable}</div>
          <div className="meta-preview-label">silver schema.tabla</div>
          <div className="meta-preview-value">{computed.silverSchema}.{computed.silverTable}</div>
          <div className="meta-preview-label">gold schema.tabla</div>
          <div className="meta-preview-value">{computed.goldSchema}.{computed.goldTable}</div>
          <div className="meta-preview-label">gold views schema</div>
          <div className="meta-preview-value">{computed.goldViewSchema}</div>
        </div>

        {issues.length > 0 && (
          <div className="meta-issues">
            {issues.map((i, k) => (
              <div key={k} className={`meta-issue ${i.level}`}>{i.msg}</div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
