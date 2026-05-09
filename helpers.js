// Helpers for artifact modeler — multi-stage (bronze/silver/gold)

const SUFFIX_HINTS = {
  _id: "Identificador / clave primaria",
  _cd: "Código (numérico entero, FK a dimensión)",
  _fc: "Fecha", _fl: "Flag (0/1, S/N)", _hr: "Hora",
  _nu: "Numérico entero", _pc: "Porcentaje (1=100%)",
  _pr: "Probabilidad (0–1)", _rt: "Ratio / tasa",
  _sc: "Score", _ts: "Timestamp (UTC-3)",
  _tx: "Texto / descripción", _vl: "Numérico con decimales",
};

// Bronze: text-files → all VARCHAR(longitud), multibyte duplica
// Silver: typed properly (NUMERIC/DATE/TIMESTAMP)
// Gold: same as silver
function suggestTargetType(srcType, length, multibyte, fileType, stage) {
  const len = parseInt(length, 10) || 0;
  const t = (srcType || "").toUpperCase();
  if (stage === "bronze") {
    const isText = (fileType || "TXT").toUpperCase() !== "DB";
    if (isText) {
      const finalLen = multibyte ? len * 2 : len;
      return finalLen > 0 ? `VARCHAR(${finalLen})` : "VARCHAR";
    }
  }
  if (t === "NUMERIC") return len ? `NUMERIC(${len})` : "NUMERIC";
  if (t === "VARCHAR" || t === "CHARACTER") return len ? `VARCHAR(${len})` : "VARCHAR";
  if (t === "INTEGER") return "INTEGER";
  if (t === "DECIMAL") return len ? `DECIMAL(${len},0)` : "DECIMAL";
  if (t === "DATE") return "DATE";
  if (t === "TIMESTAMP") return "TIMESTAMP";
  if (t === "CHAR") return len ? `CHAR(${len})` : "CHAR";
  return t || "VARCHAR";
}

function suggestTargetName(sourceName) {
  if (!sourceName) return "";
  let s = String(sourceName).trim();
  s = s.replace(/^IF\d+[-_]/i, "");
  s = s.replace(/-/g, "_");
  s = s.toLowerCase();
  s = s.replace(/_+/g, "_");
  return s;
}

function computePosHasta(desde, longitud) {
  const d = parseInt(desde, 10), l = parseInt(longitud, 10);
  if (!isFinite(d) || !isFinite(l) || l <= 0) return "";
  return d + l - 1;
}

function validatePositions(rows) {
  const issues = [];
  const sorted = rows
    .filter(r => r.pos_desde !== "" && r.pos_hasta !== "")
    .map(r => ({ ...r, _d: +r.pos_desde, _h: +r.pos_hasta }))
    .sort((a, b) => a._d - b._d);
  for (let i = 0; i < sorted.length; i++) {
    const cur = sorted[i];
    if (cur._h < cur._d) issues.push({ id: cur.id, type: "invalid", msg: "Hasta < Desde" });
    if (i > 0) {
      const prev = sorted[i - 1];
      if (cur._d <= prev._h) issues.push({ id: cur.id, type: "overlap", msg: `Solapa con ${prev.source_name}` });
      else if (cur._d > prev._h + 1) issues.push({ id: cur.id, type: "gap", msg: `Gap de ${cur._d - prev._h - 1} bytes antes` });
    }
  }
  return issues;
}

// ===== Build dbt-shaped JSON per stage =====
function buildArtifact(state) {
  const stage = state.stage || "bronze";
  const tgt = state.target || {};
  const src = state.source || {};

  const columns = (state.rows || [])
    .filter(r => r.target_name && r.target_name.trim())
    .map(r => {
      const tests = [];
      if (r.is_key) tests.push("unique");
      if (!r.nullable) tests.push("not_null");
      if (r.val_codigo_valido && r.val_codigo_valido_text) {
        const vals = r.val_codigo_valido_text.split(",").map(s => s.trim()).filter(Boolean);
        if (vals.length) tests.push({ accepted_values: { values: vals } });
      }
      const col = { name: r.target_name, data_type: r.target_type };
      if (r.description && r.description.trim()) col.description = r.description.trim();
      if (tests.length) col.tests = tests;

      const meta = {};
      if (r.source_name) meta.source_field = r.source_name;
      if (r.source_type) meta.source_type = r.source_type;
      if (stage === "bronze") {
        if (r.length !== "") meta.length = Number(r.length);
        if (r.pos_desde !== "" && r.pos_hasta !== "") meta.position = [Number(r.pos_desde), Number(r.pos_hasta)];
        if (r.multibyte) meta.multibyte = true;
      }
      if (r.transformation && r.transformation.trim()) meta.transformation = r.transformation.trim();
      if (r.is_key) meta.is_key = true;
      if (r.possible_values && r.possible_values.trim()) meta.possible_values = r.possible_values.trim();
      if (!r.source_name && stage !== "bronze") meta.is_constant = true;
      const v = {};
      if (r.val_formato) v.formato = r.val_formato_text || true;
      if (r.val_vacio_nulo) v.vacio_nulo = r.val_vacio_nulo_text || true;
      if (r.val_codigo_valido) v.codigo_valido = r.val_codigo_valido_text || true;
      if (Object.keys(v).length) meta.validations = v;
      if (Object.keys(meta).length) col.meta = meta;
      return col;
    });

  const tableObj = {
    name: tgt.table || "",
    description: tgt.description || undefined,
    config: {
      dist_key: tgt.dist_key || undefined,
      sort_keys: (tgt.sort_keys || []).filter(Boolean),
      encode: tgt.encode || "AUTO",
    },
    columns,
  };
  if (!tableObj.config.sort_keys.length) delete tableObj.config.sort_keys;
  if (!tableObj.config.dist_key) delete tableObj.config.dist_key;
  if (!tableObj.description) delete tableObj.description;

  const sourceMeta = {};
  if (stage === "bronze") {
    sourceMeta.kind = "file";
    if (src.file_type) sourceMeta.file_type = src.file_type;
    if (src.file_format) sourceMeta.file_format = src.file_format;
    if (src.frequency) sourceMeta.frequency = src.frequency;
    if (src.has_header) sourceMeta.has_header = true;
    if (src.separator) sourceMeta.separator = src.separator;
    if (src.description) sourceMeta.description = src.description;
  } else {
    sourceMeta.kind = stage === "silver" ? "stg_table" : "intermediate_table";
    if (src.schema) sourceMeta.schema = src.schema;
    if (src.table) sourceMeta.table = src.table;
    if (src.where_clause) sourceMeta.where = src.where_clause;
  }

  return {
    version: 2,
    artifact: {
      stage,
      layer: stage === "bronze" ? "bronze (incoming/raw)" : stage === "silver" ? "silver (intermediate)" : "gold (marts)",
    },
    sources: [
      {
        name: tgt.schema || "",
        schema: tgt.schema || "",
        meta: { source: sourceMeta, process_sql: state.process_sql || undefined },
        tables: [tableObj],
      },
    ],
  };
}

function toYaml(obj, indent = 0) {
  const pad = (n) => "  ".repeat(n);
  if (obj === null || obj === undefined) return "null";
  if (typeof obj === "string") {
    if (obj.includes("\n")) {
      const lines = obj.split("\n");
      return "|\n" + lines.map(l => pad(indent + 1) + l).join("\n");
    }
    if (/[:#\-?&*!|>'"%@`]/.test(obj) || /^\s|\s$/.test(obj)) return JSON.stringify(obj);
    return obj;
  }
  if (typeof obj === "number" || typeof obj === "boolean") return String(obj);
  if (Array.isArray(obj)) {
    if (!obj.length) return "[]";
    return obj.map(item => {
      if (item && typeof item === "object" && !Array.isArray(item)) {
        const entries = Object.entries(item);
        if (!entries.length) return `${pad(indent)}- {}`;
        const [first, ...rest] = entries;
        let out;
        if (first[1] && typeof first[1] === "object") {
          out = `${pad(indent)}- ${first[0]}:\n${toYaml(first[1], indent + 2)}`;
        } else {
          out = `${pad(indent)}- ${first[0]}: ${formatScalar(first[1])}`;
        }
        for (const [k, v] of rest) {
          if (v && typeof v === "object") out += `\n${pad(indent + 1)}${k}:\n${toYaml(v, indent + 2)}`;
          else out += `\n${pad(indent + 1)}${k}: ${formatScalar(v)}`;
        }
        return out;
      }
      return `${pad(indent)}- ${formatScalar(item)}`;
    }).join("\n");
  }
  const entries = Object.entries(obj);
  if (!entries.length) return "{}";
  return entries.map(([k, v]) => {
    if (v && typeof v === "object") {
      if (Array.isArray(v) && !v.length) return `${pad(indent)}${k}: []`;
      if (!Array.isArray(v) && !Object.keys(v).length) return `${pad(indent)}${k}: {}`;
      return `${pad(indent)}${k}:\n${toYaml(v, indent + 1)}`;
    }
    return `${pad(indent)}${k}: ${formatScalar(v)}`;
  }).join("\n");
}
function formatScalar(v) {
  if (v === null || v === undefined) return "null";
  if (typeof v === "string") {
    if (v === "") return '""';
    if (v.includes("\n")) return JSON.stringify(v);
    if (/[:#\-?&*!|>%@`]/.test(v)) return JSON.stringify(v);
    return v;
  }
  return String(v);
}

let _idCounter = 0;
function nextId() { _idCounter++; return `r${Date.now().toString(36)}_${_idCounter}`; }

window.RAW2STG = {
  SUFFIX_HINTS, suggestTargetType, suggestTargetName, computePosHasta,
  validatePositions, buildArtifact, toYaml, nextId,
};
