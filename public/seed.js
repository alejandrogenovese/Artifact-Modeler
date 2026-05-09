// Seeds for the 3 stages
const N = () => window.RAW2STG.nextId();

function rowBronze(src, type, len, desde, hasta, multibyte, nullable, isKey, desc, possibleVals, dst, dstType) {
  return {
    id: N(),
    source_name: src, source_type: type, length: String(len),
    pos_desde: String(desde), pos_hasta: String(hasta),
    multibyte: !!multibyte, nullable: !!nullable, is_key: !!isKey,
    description: desc || "", possible_values: possibleVals || "",
    target_name: dst, target_type: dstType, transformation: "Mapeo Directo",
    val_formato: false, val_formato_text: "",
    val_vacio_nulo: false, val_vacio_nulo_text: "",
    val_codigo_valido: false, val_codigo_valido_text: "",
  };
}
function rowMap(src, srcType, transformation, dst, dstType, isKey, nullable, description) {
  return {
    id: N(),
    source_name: src || "", source_type: srcType || "", length: "", pos_desde: "", pos_hasta: "",
    multibyte: false, nullable: nullable !== false, is_key: !!isKey,
    description: description || "", possible_values: "",
    target_name: dst, target_type: dstType, transformation: transformation || "Asignación directa",
    val_formato: false, val_formato_text: "",
    val_vacio_nulo: false, val_vacio_nulo_text: "",
    val_codigo_valido: false, val_codigo_valido_text: "",
  };
}

window.SEEDS = {
  bronze: {
    stage: "bronze",
    source: {
      file_type: "TXT", file_format: "Ancho Fijo (2016 posiciones)",
      has_header: false, separator: "N/A", frequency: "Diaria",
      description: "Novedades de Clientes Empresas",
    },
    target: {
      schema: "stg_nv", table: "nv_empresas",
      description: "Novedades de Clientes Empresas",
      dist_key: "num_clie", sort_keys: ["num_clie", "proceso_fc"], encode: "AUTO",
    },
    process_sql: `-- 1) Borrar registros para soportar reproceso
DELETE FROM stg_nv.nv_empresas
WHERE proceso_fc = FechaProceso (ODATE)
   OR proceso_fc < FechaProceso (ODATE) - "ParametroCantDiasResguardo";

-- 2) Cargar el total de los registros de la interfaz en la tabla RAW`,
    rows: [
      rowBronze("IF5-NUM-CLIE", "NUMERIC", 10, 0, 9, false, false, true, "Número de Cliente", "2,050,356", "num_clie", "VARCHAR(10)"),
      rowBronze("IF5-CLAVE-CLAVE_1", "CHARACTER", 26, 10, 35, true, false, false, "", "", "clave_clave_1", "VARCHAR(52)"),
      rowBronze("IF5-CLAVE-PALABRAS_1", "CHARACTER", 18, 36, 53, true, false, false, "", "", "clave_palabras_1", "VARCHAR(36)"),
      rowBronze("IF5-DENOMINACION_1", "CHARACTER", 90, 230, 319, true, false, false, "", "", "denominacion_1", "VARCHAR(180)"),
      rowBronze("IF5-FECHA-DE-CAMBIO_1", "NUMERIC", 8, 680, 687, false, false, false, "", "", "fecha_de_cambio_1", "VARCHAR(8)"),
      rowBronze("IF5-CUIT", "NUMERIC", 11, 738, 748, false, false, false, "", "", "cuit", "VARCHAR(11)"),
      rowBronze("IF5-NATJ-C", "NUMERIC", 2, 720, 721, false, false, false, "", "", "natj_c", "VARCHAR(2)"),
    ],
  },

  silver: {
    stage: "silver",
    source: {
      schema: "stg_nv", table: "party_physical_address",
      where_clause: "proceso_fc = FechaProceso(ODATE)",
      description: "Domicilios físicos de personas",
    },
    target: {
      schema: "c360_tmp", table: "nv_party_physical_address",
      description: "Domicilios físicos — capa intermediate (clean)",
      dist_key: "party_id", sort_keys: ["party_id", "addr_seq_num"], encode: "AUTO",
    },
    process_sql: "",
    rows: [
      rowMap("id_persona", "VARCHAR(10)", "CAST(id_persona AS DECIMAL(18,0))", "party_id", "DECIMAL(18,0)", true, false, "Identificador único del cliente / persona"),
      rowMap("nro_ord_prioridad", "VARCHAR(4)",
        "CASE WHEN nro_ord_prioridad ~ '^[0-9]+$'\n  THEN CAST(nro_ord_prioridad AS INTEGER)\n  ELSE NULL\nEND",
        "seq_num", "INTEGER", true, false, "Número de orden de prioridad del domicilio"),
      rowMap("cod_uso_dir_pers", "VARCHAR(2)", "Asignación directa", "cust_use_cd", "VARCHAR(2)", false, true, "Código de uso del domicilio (FK a lk_cust_use)"),
      rowMap("cod_uso_dir_bco", "VARCHAR(2)", "Asignación directa", "bank_use_cd", "VARCHAR(2)", false, true, "Código de uso del domicilio para el banco"),
      rowMap("cod_domi_err", "VARCHAR(2)", "Asignación directa", "addr_err_cd", "VARCHAR(2)", false, true, "Código de error del domicilio"),
      rowMap("txt_calle_domi", "VARCHAR(100)", "Asignación directa", "street", "VARCHAR(100)", false, true, "Nombre de la calle del domicilio"),
      rowMap("txt_nro_calle_domi", "VARCHAR(6)", "Asignación directa", "door", "VARCHAR(30)", false, true, "Número de puerta / altura de calle"),
      rowMap("txt_piso_domi", "VARCHAR(6)", "Asignación directa", "floor", "VARCHAR(6)", false, true, "Piso del domicilio"),
      rowMap("txt_depto_domi", "VARCHAR(6)", "Asignación directa", "apartment", "VARCHAR(6)", false, true, "Departamento del domicilio"),
      rowMap("txt_calle_comple", "VARCHAR(60)", "Asignación directa", "addr_complement", "VARCHAR(60)", false, true, "Complemento del domicilio (manzana, lote, etc.)"),
      rowMap("txt_entre_calle_1", "VARCHAR(60)", "Asignación directa", "between_street_1", "VARCHAR(60)", false, true, "Primera calle de referencia (entre calles)"),
      rowMap("txt_entre_calle_2", "VARCHAR(60)", "Asignación directa", "between_street_2", "VARCHAR(60)", false, true, "Segunda calle de referencia (entre calles)"),
      rowMap("cod_postal", "VARCHAR(4)",
        "CASE WHEN cod_postal ~ '^[0-9]+$'\n  THEN CAST(cod_postal AS INTEGER)\n  ELSE NULL\nEND",
        "postal_code_num", "INTEGER", false, true, "Código postal numérico de 4 dígitos"),
      rowMap("cod_postal_argentino", "VARCHAR(8)", "Asignación directa", "arg_postal_code_txt", "VARCHAR(8)", false, true, "Código postal argentino completo (CPA)"),
    ],
  },

  gold: {
    stage: "gold",
    source: {
      schema: "c360_tmp", table: "nv_party_physical_address",
      description: "Lookup de uso de dirección del cliente",
    },
    target: {
      schema: "c360_tables", table: "lk_cust_use",
      description: "Lookup de uso de dirección — capa marts",
      dist_key: "cust_use_cd", sort_keys: ["cust_use_cd"], encode: "AUTO",
    },
    process_sql: "",
    rows: [
      rowMap("cust_use_cd", "VARCHAR(2)", "Asignación directa", "cust_use_cd", "CHAR(2)", true, false, "Código de uso del domicilio del cliente (PK)"),
      rowMap("cust_use_cd", "VARCHAR(2)", "'Desc. ' || cust_use_cd", "cust_use_tx", "VARCHAR(100)", false, true, "Descripción del código de uso del domicilio"),
      rowMap("", "", "CURRENT_DATE", "vigencia_desde_fc", "DATE", false, false, "Fecha desde la cual el registro está vigente"),
      rowMap("", "", "Constante = 'S'", "mantenimiento_fl", "CHAR(1)", false, false, "Indica si el código admite mantenimiento manual (S/N)"),
      rowMap("", "", "Constante = 'N'", "default_fl", "CHAR(1)", false, false, "Indica si es el código por defecto (S/N)"),
    ],
  },
};
