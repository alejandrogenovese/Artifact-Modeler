// dbt-generator.js
// Generador de artefactos dbt según nomenclatura oficial Banco Galicia.
// Expone window.DBT con name builders, suffix rules, linter, YAML/SQL generators y ZIP export.

(function () {
  // ============================================================
  //  Suffix Rules — del Anexo del documento de Nomenclatura
  // ============================================================
  const SUFFIX_RULES = {
    _id: {
      desc: "Identificador / clave primaria o subrogada",
      typeRegex: /^(varchar|char|integer|bigint|numeric|decimal)/i,
      autoTests: ["not_null", "unique"],
    },
    _cd: {
      desc: "Código (numérico entero, FK a dimensión)",
      typeRegex: /^(integer|smallint|bigint|varchar|char|numeric)/i,
      autoTests: [],
    },
    _fc: {
      desc: "Fecha",
      typeRegex: /^date/i,
      autoTests: [],
    },
    _fl: {
      desc: "Flag/Indicador (0/1, S/N, Y/N)",
      typeRegex: /^(varchar|char|integer|smallint|boolean|numeric)/i,
      autoTests: [],
    },
    _hr: {
      desc: "Hora",
      typeRegex: /^(time|varchar|char)/i,
      autoTests: [],
    },
    _nu: {
      desc: "Numérico entero",
      typeRegex: /^(integer|smallint|bigint|numeric)/i,
      autoTests: [],
    },
    _pc: {
      desc: "Porcentaje (1 = 100%)",
      typeRegex: /^(numeric|decimal|float|real|double)/i,
      autoTests: [
        { "dbt_utils.expression_is_true": { expression: ">= 0 and <= 1" } },
      ],
    },
    _pr: {
      desc: "Probabilidad (0 a 1)",
      typeRegex: /^(numeric|decimal|float|real|double)/i,
      autoTests: [
        { "dbt_utils.expression_is_true": { expression: ">= 0 and <= 1" } },
      ],
    },
    _rt: {
      desc: "Ratio / tasa",
      typeRegex: /^(numeric|decimal|float|real|double)/i,
      autoTests: [],
    },
    _sc: {
      desc: "Score",
      typeRegex: /^(numeric|decimal|float|integer|real|double)/i,
      autoTests: [],
    },
    _ts: {
      desc: "Timestamp (UTC-3, horario local Argentina)",
      typeRegex: /^timestamp/i,
      autoTests: [],
    },
    _tx: {
      desc: "Texto / descripción",
      typeRegex: /^(varchar|char|text)/i,
      autoTests: [],
    },
    _vl: {
      desc: "Numérico con decimales (importes, valores)",
      typeRegex: /^(numeric|decimal|float|real|double|money)/i,
      autoTests: [],
    },
  };

  function getSuffix(name) {
    if (!name) return null;
    const m = String(name).toLowerCase().match(/(_[a-z]{2})$/);
    return m ? m[1] : null;
  }

  function suffixHint(name) {
    const sx = getSuffix(name);
    if (!sx || !SUFFIX_RULES[sx]) return null;
    return { suffix: sx, ...SUFFIX_RULES[sx] };
  }

  // ============================================================
  //  Linter — valida que target_name use sufijo del Anexo
  //           y que target_type matchee la regla del sufijo
  // ============================================================
  function lintRow(row, stage) {
    const issues = [];
    if (stage === "bronze") return issues;       // bronze mantiene nombres origen
    if (!row.target_name || !row.target_name.trim()) return issues;
    if (row.target_name.startsWith("audit_")) return issues; // campos auditoría

    const name = row.target_name.toLowerCase();
    const sx = getSuffix(name);

    if (!sx) {
      issues.push({
        level: "warn",
        kind: "no-suffix",
        msg: `'${row.target_name}' no termina en sufijo del Anexo (_id, _cd, _fc, _fl, _hr, _nu, _pc, _pr, _rt, _sc, _ts, _tx, _vl)`,
      });
      return issues;
    }
    const rule = SUFFIX_RULES[sx];
    if (!rule) {
      issues.push({
        level: "error",
        kind: "unknown-suffix",
        msg: `Sufijo '${sx}' en '${row.target_name}' no pertenece al Anexo`,
      });
      return issues;
    }
    if (rule.typeRegex && row.target_type && !rule.typeRegex.test(row.target_type)) {
      issues.push({
        level: "error",
        kind: "type-mismatch",
        msg: `Sufijo '${sx}' (${rule.desc}) no matchea tipo '${row.target_type}'`,
      });
    }
    return issues;
  }

  function lintProject(project) {
    const out = { bronze: [], silver: [], gold: [] };
    for (const stage of ["bronze", "silver", "gold"]) {
      const st = project.stages && project.stages[stage];
      if (!st || !st.rows) continue;
      for (const row of st.rows) {
        const issues = lintRow(row, stage);
        for (const issue of issues) {
          out[stage].push({ row_id: row.id, target_name: row.target_name, ...issue });
        }
      }
    }
    return out;
  }

  function lintMeta(meta) {
    const issues = [];
    if (!meta) {
      issues.push({ level: "error", kind: "no-meta", msg: "Falta configurar metadatos del Data Product" });
      return issues;
    }
    if (!meta.data_product || !/^w\d{3}$/i.test(meta.data_product)) {
      issues.push({ level: "error", kind: "bad-dp", msg: "data_product debe matchear w<NNN> (ej: w001)" });
    }
    if (!meta.sigla_aplicativa) {
      issues.push({ level: "error", kind: "no-sigla", msg: "Falta sigla aplicativa" });
    }
    if (!meta.logical_name) {
      issues.push({ level: "error", kind: "no-logical", msg: "Falta logical_name" });
    }
    if (!meta.bronze_interface_name) {
      issues.push({ level: "warn", kind: "no-iface", msg: "Falta nombre de interfaz Bronze" });
    }
    if (meta.gold_table_kind === "fact" && !meta.gold_fact_use) {
      issues.push({ level: "error", kind: "no-fact-use", msg: "Una fact requiere uso (snap/trx/agr)" });
    }
    if (meta.gold_table_kind === "fact" &&
        (meta.gold_fact_use === "snap" || meta.gold_fact_use === "agr") &&
        !meta.gold_frequency) {
      issues.push({ level: "warn", kind: "no-freq", msg: "Snap/agr requieren frecuencia (dia/mes/trim/anio)" });
    }
    return issues;
  }

  // ============================================================
  //  Name Builders — schemas y tablas según convención Galicia
  // ============================================================
  const NAME = {
    bronzeSchema: (m) =>
      m && m.sigla_aplicativa && m.logical_name
        ? `stg_${m.sigla_aplicativa}_${m.logical_name}`.toLowerCase()
        : "stg_<sigla>_<logical>",

    silverSchema: (m) =>
      m && m.data_product && m.logical_name
        ? `${m.data_product}_inter_${m.logical_name}`.toLowerCase()
        : "<dp>_inter_<logical>",

    goldSchema: (m) =>
      m && m.data_product && m.logical_name
        ? `${m.data_product}_mart_${m.logical_name}`.toLowerCase()
        : "<dp>_mart_<logical>",

    goldViewSchema: (m) =>
      m && m.data_product && m.logical_name
        ? `${m.data_product}_martviews_${m.logical_name}`.toLowerCase()
        : "<dp>_martviews_<logical>",

    bronzeTable: (m) => (m && m.bronze_interface_name ? m.bronze_interface_name : "<interface>"),

    silverTable: (m) => (m && m.silver_table_name ? m.silver_table_name : (m && m.logical_name) || "<silver>"),

    goldTable: (m) => {
      if (!m) return "<gold>";
      const kind = m.gold_table_kind || "dim";
      const content = m.gold_content_name || m.logical_name || "<content>";
      const parts = [kind];
      if (kind === "fact" && m.gold_fact_use) parts.push(m.gold_fact_use);
      parts.push(content);
      if (kind === "fact" && (m.gold_fact_use === "snap" || m.gold_fact_use === "agr") && m.gold_frequency) {
        parts.push(m.gold_frequency);
      }
      return parts.join("_").toLowerCase();
    },
  };

  function fqName(stage, meta) {
    if (stage === "bronze") return `${NAME.bronzeSchema(meta)}.${NAME.bronzeTable(meta)}`;
    if (stage === "silver") return `${NAME.silverSchema(meta)}.${NAME.silverTable(meta)}`;
    return `${NAME.goldSchema(meta)}.${NAME.goldTable(meta)}`;
  }

  // ============================================================
  //  Tests — aplica reglas: is_key, nullable, val_codigo_valido,
  //          y agrega autoTests del sufijo
  // ============================================================
  function buildTests(row, stage) {
    const tests = [];
    if (row.is_key) {
      tests.push("not_null");
      tests.push("unique");
    } else if (row.nullable === false) {
      tests.push("not_null");
    }
    if (row.val_codigo_valido && row.val_codigo_valido_text) {
      const vals = row.val_codigo_valido_text.split(",").map(s => s.trim()).filter(Boolean);
      if (vals.length) tests.push({ accepted_values: { values: vals } });
    }
    if (stage !== "bronze") {
      const sx = getSuffix(row.target_name);
      if (sx && SUFFIX_RULES[sx]) {
        for (const t of SUFFIX_RULES[sx].autoTests) {
          // dedupe por nombre simple (string vs object con clave única)
          const key = typeof t === "string" ? t : Object.keys(t)[0];
          const exists = tests.some(x => (typeof x === "string" ? x : Object.keys(x)[0]) === key);
          if (!exists) tests.push(t);
        }
      }
    }
    return tests;
  }

  // ============================================================
  //  Column builders — construyen el objeto column para YAML
  // ============================================================
  function bronzeColumn(row) {
    const name = (row.source_name || "").toLowerCase().replace(/-/g, "_");
    const col = { name };
    if (row.description) col.description = row.description;
    if (row.target_type) col.data_type = row.target_type.toLowerCase();
    const tests = buildTests(row, "bronze");
    if (tests.length) col.tests = tests;
    const meta = {};
    if (row.source_type) meta.source_type = row.source_type;
    if (row.length) meta.length = Number(row.length);
    if (row.multibyte) meta.multibyte = true;
    if (row.pos_desde !== "" && row.pos_hasta !== "") {
      meta.position = [Number(row.pos_desde), Number(row.pos_hasta)];
    }
    if (row.possible_values) meta.possible_values = row.possible_values;
    if (Object.keys(meta).length) col.meta = meta;
    return col;
  }

  function modelColumn(row, stage) {
    const col = { name: row.target_name };
    if (row.description) col.description = row.description;
    if (row.target_type) col.data_type = row.target_type.toLowerCase();
    const tests = buildTests(row, stage);
    if (tests.length) col.tests = tests;
    const meta = {};
    if (row.source_name) meta.source_field = row.source_name;
    if (row.transformation && row.transformation.trim() &&
        !/^(asignación directa|mapeo directo)$/i.test(row.transformation.trim())) {
      meta.transformation = row.transformation.trim();
    }
    if (Object.keys(meta).length) col.meta = meta;
    return col;
  }

  // ============================================================
  //  YAML generators
  // ============================================================
  function buildBronzeYaml(project) {
    const meta = project.meta || {};
    const state = project.stages.bronze || {};
    const cols = (state.rows || [])
      .filter(r => r.source_name && r.source_name.trim())
      .map(bronzeColumn);
    cols.push({
      name: "audit_created_ts_local",
      description: "Auditoría — fecha/hora de carga (UTC-3, horario local Argentina)",
      data_type: "timestamp without time zone",
    });
    const yaml = {
      version: 2,
      sources: [{
        name: NAME.bronzeSchema(meta),
        schema: NAME.bronzeSchema(meta),
        description: (state.source && state.source.description) ||
                     `Bronze — espejo fiel de ${NAME.bronzeTable(meta)}, inmutable, no consumible`,
        tables: [{
          name: NAME.bronzeTable(meta),
          description: (state.target && state.target.description) ||
                       `Tabla raw de ${meta.logical_name || "—"} desde ${meta.sigla_aplicativa || "origen"}`,
          columns: cols,
        }],
      }],
    };
    return window.RAW2STG.toYaml(yaml);
  }

  function buildSilverYaml(project) {
    const meta = project.meta || {};
    const state = project.stages.silver || {};
    const cols = (state.rows || [])
      .filter(r => r.target_name && r.target_name.trim())
      .map(r => modelColumn(r, "silver"));
    cols.push({
      name: "audit_created_ts",
      description: "Auditoría — fecha/hora de carga en Silver (UTC-3, horario local Argentina)",
      data_type: "timestamp without time zone",
    });
    cols.push({
      name: "audit_data_source_tx",
      description: "Auditoría — origen del dato",
      data_type: "varchar(100)",
    });
    const yaml = {
      version: 2,
      models: [{
        name: NAME.silverTable(meta),
        description: (state.target && state.target.description) ||
                     `Silver — ${NAME.silverTable(meta)} tipado y deduplicado`,
        config: {
          schema: `inter_${meta.logical_name || ""}`,
          materialized: meta.silver_materialization || "view",
          "persist_docs": { relation: true, columns: true },
        },
        columns: cols,
      }],
    };
    return window.RAW2STG.toYaml(yaml);
  }

  function buildGoldYaml(project) {
    const meta = project.meta || {};
    const state = project.stages.gold || {};
    const cols = (state.rows || [])
      .filter(r => r.target_name && r.target_name.trim())
      .map(r => modelColumn(r, "gold"));

    // Surrogate key cuando hay PK compuesta (más de un is_key)
    const keys = (state.rows || []).filter(r => r.is_key && r.target_name);
    if (keys.length > 1) {
      const skName = keys.map(k => k.target_name.replace(/_(id|cd|nu)$/i, "")).join("_") + "_id";
      cols.unshift({
        name: skName,
        description: `Clave subrogada (hash de ${keys.map(k => k.target_name).join(" + ")})`,
        data_type: "varchar(100)",
        tests: ["not_null", "unique"],
      });
    }

    cols.push({
      name: "audit_created_ts",
      description: "Auditoría — fecha/hora de carga en Gold (UTC-3, horario local Argentina)",
      data_type: "timestamp without time zone",
    });
    cols.push({
      name: "audit_data_source_tx",
      description: "Auditoría — origen del dato",
      data_type: "varchar(100)",
    });

    const target = state.target || {};
    const config = {
      schema: `mart_${meta.logical_name || ""}`,
      materialized: "table",
      "persist_docs": { relation: true, columns: true },
    };
    if (target.dist_key) config.dist = target.dist_key;
    if (target.sort_keys && target.sort_keys.length) config.sort = target.sort_keys;

    const yaml = {
      version: 2,
      models: [{
        name: NAME.goldTable(meta),
        description: (state.target && state.target.description) ||
                     `Gold — ${NAME.goldTable(meta)} (${meta.gold_table_kind || "—"})`,
        config,
        columns: cols,
      }],
    };
    return window.RAW2STG.toYaml(yaml);
  }

  // ============================================================
  //  SQL helpers
  // ============================================================
  function indent(s, n) {
    const pad = " ".repeat(n);
    return s.split("\n").map(l => pad + l).join("\n");
  }
  function sqlQuote(s) {
    if (s == null) return "''";
    return "'" + String(s).replace(/'/g, "''") + "'";
  }
  function commentOnTable(fq, desc) {
    return `COMMENT ON TABLE ${fq} IS ${sqlQuote(desc)};`;
  }
  function commentOnColumn(fq, col, desc) {
    return `COMMENT ON COLUMN ${fq}.${col} IS ${sqlQuote(desc)};`;
  }

  function buildSilverSql(project) {
    const meta = project.meta || {};
    const state = project.stages.silver || {};
    const rows = (state.rows || []).filter(r => r.target_name && r.target_name.trim());
    const keys = rows.filter(r => r.is_key);

    const lines = [];
    lines.push(`{{ config(`);
    lines.push(`    materialized='${meta.silver_materialization || "view"}',`);
    lines.push(`    schema='inter_${meta.logical_name || ""}',`);
    lines.push(`    persist_docs={'relation': True, 'columns': True}`);
    lines.push(`) }}`);
    lines.push("");
    lines.push("with raw as (");
    lines.push(`    select * from {{ source('${NAME.bronzeSchema(meta)}', '${NAME.bronzeTable(meta)}') }}`);
    lines.push("),");
    lines.push("");
    lines.push("typed as (");
    lines.push("    select");

    rows.forEach((r, i) => {
      const isLast = i === rows.length - 1;
      const transform = (r.transformation || "").trim();
      const direct = !transform || /^(asignación directa|mapeo directo)$/i.test(transform);
      const src = r.source_name;
      const t = r.target_type ? r.target_type.toLowerCase() : "";
      let expr;
      if (!src) {
        // constante / derivado
        expr = transform || "null";
      } else if (direct) {
        expr = t ? `cast(${src} as ${t})` : src;
      } else {
        expr = transform.replace(/\n/g, "\n            ");
      }
      const sep = isLast ? "" : ",";
      const padded = expr.length <= 60 ? expr.padEnd(60) : expr;
      lines.push(`        ${padded} as ${r.target_name}${sep}`);
    });
    lines.push("    from raw");
    lines.push(")");
    lines.push("");

    if (keys.length > 0) {
      lines.push("-- Deduplicación por clave natural");
      lines.push(", deduped as (");
      lines.push("    select * from (");
      lines.push("        select *,");
      lines.push(`            row_number() over (partition by ${keys.map(k => k.target_name).join(", ")} order by 1 desc) as rn`);
      lines.push("        from typed");
      lines.push("    ) where rn = 1");
      lines.push(")");
      lines.push("");
      lines.push("select");
      lines.push("    *,");
      lines.push("    convert_timezone('America/Argentina/Buenos_Aires', getdate())::timestamp");
      lines.push("        as audit_created_ts,");
      lines.push(`    '${meta.sigla_aplicativa || "source"}.${meta.bronze_interface_name || ""}'::varchar(100)`);
      lines.push("        as audit_data_source_tx");
      lines.push("from deduped");
    } else {
      lines.push("select");
      lines.push("    *,");
      lines.push("    convert_timezone('America/Argentina/Buenos_Aires', getdate())::timestamp");
      lines.push("        as audit_created_ts,");
      lines.push(`    '${meta.sigla_aplicativa || "source"}.${meta.bronze_interface_name || ""}'::varchar(100)`);
      lines.push("        as audit_data_source_tx");
      lines.push("from typed");
    }
    return lines.join("\n");
  }

  function buildGoldSql(project) {
    const meta = project.meta || {};
    const state = project.stages.gold || {};
    const rows = (state.rows || []).filter(r => r.target_name && r.target_name.trim());
    const keys = rows.filter(r => r.is_key);
    const target = state.target || {};

    const lines = [];
    lines.push(`{{ config(`);
    lines.push(`    materialized='table',`);
    lines.push(`    schema='mart_${meta.logical_name || ""}',`);
    lines.push(`    persist_docs={'relation': True, 'columns': True}${target.dist_key ? "," : ""}`);
    if (target.dist_key) lines.push(`    dist='${target.dist_key}'${target.sort_keys && target.sort_keys.length ? "," : ""}`);
    if (target.sort_keys && target.sort_keys.length) lines.push(`    sort=[${target.sort_keys.map(k => `'${k}'`).join(", ")}]`);
    lines.push(`) }}`);
    lines.push("");
    lines.push("select");

    // Surrogate key si PK compuesta
    if (keys.length > 1) {
      const skName = keys.map(k => k.target_name.replace(/_(id|cd|nu)$/i, "")).join("_") + "_id";
      lines.push("    -- Clave subrogada (PK compuesta, según convención Galicia)");
      lines.push("    md5(");
      keys.forEach((k, i) => {
        const isLast = i === keys.length - 1;
        const cast = /^varchar/i.test(k.target_type) ? "" : "::varchar";
        const sep = isLast ? "" : " || '-' ||";
        lines.push(`        coalesce(${k.target_name}${cast}, '')${sep}`);
      });
      lines.push(`    )::varchar(100)                    as ${skName},`);
      lines.push("");
    }

    rows.forEach((r, i) => {
      const isLast = i === rows.length - 1;
      const transform = (r.transformation || "").trim();
      const direct = !transform || /^(asignación directa|mapeo directo)$/i.test(transform);
      const src = r.source_name;
      const t = r.target_type ? r.target_type.toLowerCase() : "";
      let expr;
      if (!src) {
        expr = transform || "null";
      } else if (direct) {
        expr = src;
      } else {
        expr = transform.replace(/\n/g, "\n        ");
      }
      const padded = expr.length <= 40 ? expr.padEnd(40) : expr;
      lines.push(`    ${padded} as ${r.target_name},`);
    });

    lines.push("");
    lines.push("    convert_timezone('America/Argentina/Buenos_Aires', getdate())::timestamp");
    lines.push("        as audit_created_ts,");
    lines.push(`    '${NAME.silverSchema(meta)}.${NAME.silverTable(meta)}'::varchar(100)`);
    lines.push("        as audit_data_source_tx");
    lines.push("");
    lines.push(`from {{ ref('${NAME.silverTable(meta)}') }}`);

    return lines.join("\n");
  }

  // ============================================================
  //  Redshift COMMENTs — SQL ejecutable directo
  //  Para Silver/Gold también va `persist_docs` en el model config,
  //  pero estos archivos sirven como fallback idempotente y para Bronze
  //  (que es source, no model — persist_docs no aplica).
  // ============================================================
  function buildCommentsHeader(stage, fq, lastPart) {
    return [
      `-- Comentarios Redshift — ${stage}`,
      `-- Tabla: ${fq}`,
      `-- Generado por artifact modeler según Nomenclatura Galicia`,
      `-- Idempotente: COMMENT ON sobreescribe valor anterior`,
      ``,
    ].join("\n");
  }

  function buildBronzeComments(project) {
    const meta = project.meta || {};
    const state = project.stages.bronze || {};
    const fq = `${NAME.bronzeSchema(meta)}.${NAME.bronzeTable(meta)}`;
    const lines = [buildCommentsHeader("Bronze", fq)];

    const tableDesc = (state.target && state.target.description) ||
                      (state.source && state.source.description) ||
                      `Bronze — espejo fiel de ${NAME.bronzeTable(meta)}, inmutable, no consumible`;
    lines.push(commentOnTable(fq, tableDesc));
    lines.push("");

    for (const r of (state.rows || [])) {
      if (!r.source_name || !r.source_name.trim()) continue;
      if (!r.description || !r.description.trim()) continue;
      const colName = r.source_name.toLowerCase().replace(/-/g, "_");
      lines.push(commentOnColumn(fq, colName, r.description.trim()));
    }
    lines.push(commentOnColumn(fq, "audit_created_ts_local",
      "Auditoría — fecha/hora de carga (UTC-3, horario local Argentina)"));
    return lines.join("\n") + "\n";
  }

  function buildSilverComments(project) {
    const meta = project.meta || {};
    const state = project.stages.silver || {};
    const fq = `${NAME.silverSchema(meta)}.${NAME.silverTable(meta)}`;
    const lines = [buildCommentsHeader("Silver", fq)];

    const tableDesc = (state.target && state.target.description) ||
                      `Silver — ${NAME.silverTable(meta)} tipado y deduplicado`;
    lines.push(commentOnTable(fq, tableDesc));
    lines.push("");

    for (const r of (state.rows || [])) {
      if (!r.target_name || !r.target_name.trim()) continue;
      if (!r.description || !r.description.trim()) continue;
      lines.push(commentOnColumn(fq, r.target_name, r.description.trim()));
    }
    lines.push(commentOnColumn(fq, "audit_created_ts",
      "Auditoría — fecha/hora de carga en Silver (UTC-3, horario local Argentina)"));
    lines.push(commentOnColumn(fq, "audit_data_source_tx",
      "Auditoría — origen del dato"));
    return lines.join("\n") + "\n";
  }

  function buildGoldComments(project) {
    const meta = project.meta || {};
    const state = project.stages.gold || {};
    const fq = `${NAME.goldSchema(meta)}.${NAME.goldTable(meta)}`;
    const lines = [buildCommentsHeader("Gold", fq)];

    const tableDesc = (state.target && state.target.description) ||
                      `Gold — ${NAME.goldTable(meta)} (${meta.gold_table_kind || "—"})`;
    lines.push(commentOnTable(fq, tableDesc));
    lines.push("");

    // Surrogate key si PK compuesta
    const keys = (state.rows || []).filter(r => r.is_key && r.target_name);
    if (keys.length > 1) {
      const skName = keys.map(k => k.target_name.replace(/_(id|cd|nu)$/i, "")).join("_") + "_id";
      lines.push(commentOnColumn(fq, skName,
        `Clave subrogada — hash de ${keys.map(k => k.target_name).join(" + ")}`));
    }

    for (const r of (state.rows || [])) {
      if (!r.target_name || !r.target_name.trim()) continue;
      if (!r.description || !r.description.trim()) continue;
      lines.push(commentOnColumn(fq, r.target_name, r.description.trim()));
    }
    lines.push(commentOnColumn(fq, "audit_created_ts",
      "Auditoría — fecha/hora de carga en Gold (UTC-3, horario local Argentina)"));
    lines.push(commentOnColumn(fq, "audit_data_source_tx",
      "Auditoría — origen del dato"));
    return lines.join("\n") + "\n";
  }

  // ============================================================
  //  README — para incluir en el ZIP como contexto
  // ============================================================
  function buildReadme(project) {
    const meta = project.meta || {};
    return [
      `# ${NAME.silverTable(meta)} — Artefactos dbt`,
      ``,
      `Generado por **artifact modeler** según _Nomenclatura de Objetos – Data Mesh_ (Banco Galicia).`,
      ``,
      `## Identidad del Data Product`,
      ``,
      `| Atributo | Valor |`,
      `|---|---|`,
      `| Data Product | \`${meta.data_product || "—"}\` |`,
      `| Sigla aplicativa | \`${meta.sigla_aplicativa || "—"}\` |`,
      `| Logical name | \`${meta.logical_name || "—"}\` |`,
      `| Dominio | \`${meta.domain || "—"}\` |`,
      ``,
      `## Objetos generados`,
      ``,
      `| Capa | Schema | Tabla | Materialización |`,
      `|---|---|---|---|`,
      `| Bronze | \`${NAME.bronzeSchema(meta)}\` | \`${NAME.bronzeTable(meta)}\` | source |`,
      `| Silver | \`${NAME.silverSchema(meta)}\` | \`${NAME.silverTable(meta)}\` | ${meta.silver_materialization || "view"} |`,
      `| Gold | \`${NAME.goldSchema(meta)}\` | \`${NAME.goldTable(meta)}\` | table |`,
      ``,
      `## Estructura del paquete`,
      ``,
      `\`\`\``,
      `models/`,
      `├── bronze/`,
      `│   ├── _sources.yml`,
      `│   └── _comments.sql      ← COMMENT ON TABLE/COLUMN para Redshift`,
      `├── silver/`,
      `│   ├── _silver__models.yml`,
      `│   ├── ${NAME.silverTable(meta)}.sql`,
      `│   └── _comments.sql      ← fallback ejecutable`,
      `└── gold/`,
      `    ├── _gold__models.yml`,
      `    ├── ${NAME.goldTable(meta)}.sql`,
      `    └── _comments.sql      ← fallback ejecutable`,
      `\`\`\``,
      ``,
      `## Cómo integrar en tu proyecto dbt`,
      ``,
      `1. Copiar la carpeta \`models/\` al directorio \`models/\` de tu proyecto dbt (o mergear si ya existe).`,
      `2. Asegurarte de que \`dbt_utils\` esté en \`packages.yml\` (algunos tests lo requieren).`,
      `3. Correr \`dbt parse\` para validar la estructura.`,
      `4. Completar los \`-- TODO\` que pueda haber en los \`.sql\` (transformaciones complejas, dedup logic).`,
      ``,
      `## COMMENTs de Redshift`,
      ``,
      `Los descriptions del modelado se persisten en el catálogo de Redshift por dos vías complementarias:`,
      ``,
      `- **Silver y Gold**: vía \`persist_docs={'relation': True, 'columns': True}\` en el \`{{ config() }}\` del modelo. Cada \`dbt run\` reemite los \`COMMENT ON\`. No requiere acción manual.`,
      `- **Bronze**: como source no se ejecuta vía dbt, así que generamos \`_comments.sql\` ejecutable manualmente contra Redshift (o desde el job de ingesta una vez creada la tabla).`,
      `- Los \`_comments.sql\` de Silver y Gold se incluyen como **fallback idempotente** — útiles para correr en entornos donde \`persist_docs\` esté deshabilitado o para repoblar comentarios sin un \`dbt run\` completo.`,
      ``,
      `Para ejecutar los comments manualmente:`,
      ``,
      `\`\`\`bash`,
      `psql -h <redshift-host> -d <db> -U <user> -f models/bronze/_comments.sql`,
      `\`\`\``,
      ``,
      `## Notas`,
      ``,
      `- Todos los timestamps están en horario local Argentina (UTC-3) según el documento de Nomenclatura.`,
      `- Los campos de auditoría (\`audit_created_ts_local\`, \`audit_created_ts\`, \`audit_data_source_tx\`) se inyectan automáticamente.`,
      `- La clave subrogada en Gold se genera con \`md5(...)\` cuando hay PK compuesta (más de una columna marcada como \`is_key\`).`,
    ].join("\n");
  }

  // ============================================================
  //  ZIP builder — empaqueta todo en estructura dbt-compatible
  // ============================================================
  async function buildZip(project) {
    if (typeof JSZip === "undefined") {
      throw new Error("JSZip no está cargado");
    }
    const meta = project.meta || {};
    const zip = new JSZip();

    // Bronze
    zip.file("models/bronze/_sources.yml", buildBronzeYaml(project));
    zip.file("models/bronze/_comments.sql", buildBronzeComments(project));

    // Silver
    zip.file("models/silver/_silver__models.yml", buildSilverYaml(project));
    zip.file(`models/silver/${NAME.silverTable(meta)}.sql`, buildSilverSql(project));
    zip.file("models/silver/_comments.sql", buildSilverComments(project));

    // Gold
    zip.file("models/gold/_gold__models.yml", buildGoldYaml(project));
    zip.file(`models/gold/${NAME.goldTable(meta)}.sql`, buildGoldSql(project));
    zip.file("models/gold/_comments.sql", buildGoldComments(project));

    // README
    zip.file("README.md", buildReadme(project));

    // Backup del estado del modeler (para reabrir después)
    zip.file("_meta/modeler_state.json", JSON.stringify(project, null, 2));

    return zip.generateAsync({ type: "blob" });
  }

  function downloadZip(project) {
    const meta = project.meta || {};
    const fname = `dbt_${meta.data_product || "dp"}_${meta.logical_name || "model"}.zip`;
    return buildZip(project).then(blob => {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = fname;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      return fname;
    });
  }

  // ============================================================
  //  Default meta + migration helpers
  // ============================================================
  function defaultMeta() {
    return {
      data_product: "",
      sigla_aplicativa: "",
      logical_name: "",
      domain: "",
      bronze_interface_name: "",
      silver_table_name: "",
      silver_materialization: "view",
      gold_table_kind: "dim",        // dim | fact
      gold_fact_use: "",             // "" | snap | trx | agr
      gold_frequency: "",            // "" | dia | mes | trim | anio
      gold_content_name: "",
    };
  }

  // intenta deducir meta desde un project legacy parsing target.schema
  function inferMetaFromLegacy(project) {
    const m = defaultMeta();
    try {
      const bSchema = project && project.stages && project.stages.bronze
                    && project.stages.bronze.target && project.stages.bronze.target.schema;
      if (bSchema) {
        const parts = bSchema.split("_");
        if (parts[0] === "stg" && parts.length >= 3) {
          m.sigla_aplicativa = parts[1];
          m.logical_name = parts.slice(2).join("_");
        } else if (parts[0] === "stg" && parts.length === 2) {
          m.sigla_aplicativa = parts[1];
        }
      }
      const sSchema = project && project.stages && project.stages.silver
                    && project.stages.silver.target && project.stages.silver.target.schema;
      if (sSchema) {
        const m2 = sSchema.match(/^(w\d{3})_inter_(.+)$/i);
        if (m2) { m.data_product = m2[1].toLowerCase(); m.logical_name = m.logical_name || m2[2]; }
      }
      const bTable = project && project.stages && project.stages.bronze
                   && project.stages.bronze.target && project.stages.bronze.target.table;
      if (bTable) m.bronze_interface_name = bTable;
      const sTable = project && project.stages && project.stages.silver
                   && project.stages.silver.target && project.stages.silver.target.table;
      if (sTable) m.silver_table_name = sTable;
      const gTable = project && project.stages && project.stages.gold
                   && project.stages.gold.target && project.stages.gold.target.table;
      if (gTable) {
        m.gold_content_name = gTable.replace(/^(dim|fact)_/, "")
                                    .replace(/^(snap|trx|agr)_/, "")
                                    .replace(/_(dia|mes|trim|anio)$/, "");
        if (/^fact_/.test(gTable)) m.gold_table_kind = "fact";
        const useM = gTable.match(/^fact_(snap|trx|agr)_/);
        if (useM) m.gold_fact_use = useM[1];
        const freqM = gTable.match(/_(dia|mes|trim|anio)$/);
        if (freqM) m.gold_frequency = freqM[1];
      }
    } catch (e) { /* ignore */ }
    return m;
  }

  // ============================================================
  //  Public API
  // ============================================================
  window.DBT = {
    SUFFIX_RULES,
    NAME,
    fqName,
    getSuffix,
    suffixHint,
    lintRow,
    lintProject,
    lintMeta,
    buildBronzeYaml,
    buildSilverYaml,
    buildGoldYaml,
    buildSilverSql,
    buildGoldSql,
    buildBronzeComments,
    buildSilverComments,
    buildGoldComments,
    buildReadme,
    buildZip,
    downloadZip,
    defaultMeta,
    inferMetaFromLegacy,
  };
})();
