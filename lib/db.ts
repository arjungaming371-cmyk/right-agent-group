// Local PostgreSQL client - Supabase-compatible wrapper
//
// PRODUCTION HARDENING (staff pass):
//  - Table names, select column lists and LIMIT values are validated/ clamped
//    before they are interpolated into SQL (identifiers were checked before;
//    tables / select lists / limits were not).
//  - Every swallowed builder error is now logged as one structured JSON line
//    (op, table, message) — before, a failing query returned { error } and the
//    only trace was whatever the route happened to print, so 500s that callers
//    ignored were completely silent.
//  - Builders are generic: db.from<Lead>("leads") gives typed rows at call
//    sites. The default keeps the loose shape so existing routes compile.
import { Pool, type QueryResultRow } from "pg"
import { logger } from "@/lib/logger"

const log = logger.child("db")

const pool = new Pool({
  host: process.env.PG_HOST || "localhost",
  port: parseInt(process.env.PG_PORT || "5432"),
  database: process.env.PG_DATABASE || "right_agent_group",
  user: process.env.PG_USER || "postgres",
  password: process.env.PG_PASSWORD || "",
  // Raised from 10 — each WhatsApp/call turn fires 3-5 queries, so with
  // several conversations active at once the old limit queued requests
  // behind each other. Postgres here allows 100 connections total and only
  // ~10 are ever in use at a time, so this has real headroom.
  max: 25,
  idleTimeoutMillis: 30000,
  // FIX (2026-09-20): both were unset → pg waits FOREVER. Under a burst,
  // requests queued indefinitely on pool.connect() (API routes hung, browser
  // polls piled up, the voicebot's 20s /api/calls/turn timeout expired and
  // callers heard the fallback line), and a single stuck query pinned a
  // connection permanently. Fail fast instead of hanging.
  connectionTimeoutMillis: 5000,
  statement_timeout: 15000,
})

pool.on("error", (err) => log.error("pool_error", { error: err.message }))

export async function query(text: string, params?: unknown[]) {
  const client = await pool.connect()
  try {
    return await client.query(text, params)
  } finally {
    client.release()
  }
}

function serialize(val: unknown): unknown {
  if (val !== null && val !== undefined && typeof val === "object" && !(val instanceof Date)) {
    return JSON.stringify(val)
  }
  return val ?? null
}

// ---- Identifier / literal validation ----
// Column/table identifiers get interpolated directly into SQL (Postgres has
// no way to parameterize an identifier). insert()/update() are frequently
// called with `req.json()`'s keys as the values object (e.g. app/api/leads
// POST/PATCH) — without this check, a request body like
// {"status = (SELECT ...), foo": "x"} becomes a real injected column
// expression. Every identifier is validated against a strict pattern before
// it ever reaches a query string.

const SAFE_IDENTIFIER_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/

function assertSafeIdentifier(name: string): string {
  if (!SAFE_IDENTIFIER_RE.test(name)) {
    throw new Error(`Unsafe column name: ${JSON.stringify(name)}`)
  }
  return name
}

function assertSafeTable(name: string): string {
  if (!SAFE_IDENTIFIER_RE.test(name)) {
    // Tables only ever come from string literals in this codebase; rejecting
    // anything that is not a bare identifier closes the last interpolation path.
    throw new Error(`Unsafe table name: ${JSON.stringify(name)}`)
  }
  return name
}

/** Validate a select list: "*", or comma-separated bare identifiers. */
function assertSafeSelectList(cols: string): string {
  const parts = cols.split(",").map((s) => s.trim()).filter(Boolean)
  if (parts.length === 0) throw new Error("Empty select list")
  for (const p of parts) {
    if (p === "*") continue
    if (!SAFE_IDENTIFIER_RE.test(p)) {
      throw new Error(`Unsafe select column: ${JSON.stringify(p)}`)
    }
  }
  return parts.join(", ")
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

function logFailure(op: string, table: string, e: unknown): { message: string } {
  const message = errorMessage(e)
  log.warn("query_failed", { op, table, error: message })
  return { message }
}

export type DbError = { message: string }
export type DbResult<Row = any> = { data: Row | null; error: DbError | null; count?: number }

// ---- INSERT builder ----
class InsertBuilder<Row = any> implements PromiseLike<DbResult<Row>> {
  private table: string
  private rows: Record<string, unknown>[]
  private wantSelect = false

  constructor(table: string, values: Record<string, unknown> | Record<string, unknown>[]) {
    this.table = assertSafeTable(table)
    this.rows = Array.isArray(values) ? values : [values]
  }

  select() {
    this.wantSelect = true
    return this
  }

  single(): Promise<DbResult<Row>> {
    return this.exec().then((r) => ({
      data: Array.isArray(r.data) ? ((r.data[0] ?? null) as Row) : (r.data as Row),
      error: r.error,
    }))
  }

  private async exec(): Promise<DbResult<Row>> {
    try {
      if (this.rows.length === 0) return { data: null, error: { message: "No values" } }
      const cols = Object.keys(this.rows[0]).map(assertSafeIdentifier)
      const params: unknown[] = []
      const placeholders = this.rows.map((row, rIdx) => {
        const ph = cols.map((col, cIdx) => {
          params.push(serialize(row[col]))
          return `$${rIdx * cols.length + cIdx + 1}`
        })
        return `(${ph.join(", ")})`
      })
      const sql = `INSERT INTO ${this.table} (${cols.join(", ")}) VALUES ${placeholders.join(", ")} RETURNING *`
      const res = await query(sql, params)
      const rows = res.rows as Row[]
      return { data: (this.rows.length === 1 ? rows[0] : rows) as Row, error: null }
    } catch (e) {
      return { data: null, error: logFailure("insert", this.table, e) }
    }
  }

  then<T1 = DbResult<Row>, T2 = never>(
    onfulfilled?: ((value: DbResult<Row>) => T1 | PromiseLike<T1>) | null,
    onrejected?: ((reason: unknown) => T2 | PromiseLike<T2>) | null
  ): PromiseLike<T1 | T2> {
    return this.exec().then(onfulfilled, onrejected)
  }

  catch<T = never>(onrejected?: ((reason: unknown) => T | PromiseLike<T>) | null) {
    return this.exec().catch(onrejected)
  }
}

type Filter = { column: string; op: "eq" | "ilike" | "like"; value: unknown }

// ---- UPDATE builder (filters applied via .eq() AFTER .update()) ----
class UpdateBuilder<Row = any> implements PromiseLike<DbResult<Row>> {
  private table: string
  private values: Record<string, unknown>
  private filters: Filter[] = []
  private wantSingle = false

  constructor(table: string, values: Record<string, unknown>) {
    this.table = assertSafeTable(table)
    this.values = values
  }

  eq(column: string, value: unknown) {
    this.filters.push({ column: assertSafeIdentifier(column), op: "eq", value })
    return this
  }

  select() {
    return this
  }

  single(): Promise<DbResult<Row>> {
    this.wantSingle = true
    return this.exec().then((r) => ({
      data: Array.isArray(r.data) ? ((r.data[0] ?? null) as Row) : (r.data as Row),
      error: r.error,
    }))
  }

  /** Like single(), but 0 matching rows is data:null with NO error. */
  maybeSingle(): Promise<DbResult<Row>> {
    return this.exec().then((r) => ({
      data: Array.isArray(r.data) ? ((r.data[0] ?? null) as Row) : (r.data as Row),
      error: r.error,
    }))
  }

  private async exec(): Promise<DbResult<Row>> {
    try {
      const cols = Object.keys(this.values).map(assertSafeIdentifier)
      if (cols.length === 0) return { data: null, error: { message: "No values to update" } }

      const setParts = cols.map((c, i) => `${c} = $${i + 1}`)
      const params: unknown[] = cols.map((c) => serialize(this.values[c]))

      let idx = cols.length + 1
      const whereParts: string[] = []
      for (const f of this.filters) {
        if (f.op === "ilike") {
          whereParts.push(`${f.column} ILIKE $${idx}`)
          params.push(`%${String(f.value)}%`)
        } else {
          whereParts.push(`${f.column} = $${idx}`)
          params.push(f.value)
        }
        idx++
      }
      const where = whereParts.length ? `WHERE ${whereParts.join(" AND ")}` : ""
      const sql = `UPDATE ${this.table} SET ${setParts.join(", ")} ${where} RETURNING *`
      const res = await query(sql, params)
      const rows = res.rows as Row[]
      return { data: (this.wantSingle ? rows[0] ?? null : rows) as Row, error: null }
    } catch (e) {
      return { data: null, error: logFailure("update", this.table, e) }
    }
  }

  then<T1 = DbResult<Row>, T2 = never>(
    onfulfilled?: ((value: DbResult<Row>) => T1 | PromiseLike<T1>) | null,
    onrejected?: ((reason: unknown) => T2 | PromiseLike<T2>) | null
  ): PromiseLike<T1 | T2> {
    return this.exec().then(
      (r) => {
        const value: DbResult<Row> = {
          data: (this.wantSingle ? (Array.isArray(r.data) ? r.data[0] ?? null : r.data) : r.data) as Row,
          error: r.error,
        }
        return onfulfilled ? onfulfilled(value) : (undefined as unknown as T1)
      },
      onrejected
    )
  }

  catch<T = never>(onrejected?: ((reason: unknown) => T | PromiseLike<T>) | null) {
    return this.exec().catch(onrejected)
  }
}

// ---- UPSERT builder ----
class UpsertBuilder<Row = any> implements PromiseLike<DbResult<Row>> {
  private table: string
  private values: Record<string, unknown>
  private conflictCol: string

  constructor(table: string, values: Record<string, unknown>, conflictCol: string) {
    this.table = assertSafeTable(table)
    this.values = values
    this.conflictCol = assertSafeIdentifier(conflictCol)
  }

  private async exec(): Promise<DbResult<Row>> {
    try {
      const cols = Object.keys(this.values).map(assertSafeIdentifier)
      const placeholders = cols.map((_, i) => `$${i + 1}`)
      const params = cols.map((c) => serialize(this.values[c]))
      const updateParts = cols.filter((c) => c !== this.conflictCol).map((c) => `${c} = EXCLUDED.${c}`)
      const sql = `INSERT INTO ${this.table} (${cols.join(", ")}) VALUES (${placeholders.join(", ")})
        ON CONFLICT (${this.conflictCol}) DO UPDATE SET ${updateParts.join(", ")} RETURNING *`
      const res = await query(sql, params)
      return { data: res.rows[0] as Row, error: null }
    } catch (e) {
      return { data: null, error: logFailure("upsert", this.table, e) }
    }
  }

  then<T1 = DbResult<Row>, T2 = never>(
    onfulfilled?: ((value: DbResult<Row>) => T1 | PromiseLike<T1>) | null,
    onrejected?: ((reason: unknown) => T2 | PromiseLike<T2>) | null
  ): PromiseLike<T1 | T2> {
    return this.exec().then(onfulfilled, onrejected)
  }

  catch<T = never>(onrejected?: ((reason: unknown) => T | PromiseLike<T>) | null) {
    return this.exec().catch(onrejected)
  }
}

// ---- DELETE builder ----
class DeleteBuilder implements PromiseLike<DbResult<never>> {
  private table: string
  private filters: Filter[] = []

  constructor(table: string) {
    this.table = assertSafeTable(table)
  }

  eq(column: string, value: unknown) {
    this.filters.push({ column: assertSafeIdentifier(column), op: "eq", value })
    return this
  }

  private async exec(): Promise<DbResult<never>> {
    try {
      const params: unknown[] = []
      const whereParts = this.filters.map((f, i) => {
        params.push(f.value)
        return `${f.column} = $${i + 1}`
      })
      const where = whereParts.length ? `WHERE ${whereParts.join(" AND ")}` : ""
      await query(`DELETE FROM ${this.table} ${where}`, params)
      return { data: null, error: null }
    } catch (e) {
      return { data: null, error: logFailure("delete", this.table, e) }
    }
  }

  then<T1 = DbResult<never>, T2 = never>(
    onfulfilled?: ((value: DbResult<never>) => T1 | PromiseLike<T1>) | null,
    onrejected?: ((reason: unknown) => T2 | PromiseLike<T2>) | null
  ): PromiseLike<T1 | T2> {
    return this.exec().then(onfulfilled, onrejected)
  }
}

// ---- SELECT builder ----
class SelectBuilder<Row = any> implements PromiseLike<DbResult<Row>> {
  private table: string
  private cols = "*"
  private filters: Filter[] = []
  private orderCol = ""
  private orderAsc = true
  private limitN: number | null = null
  private wantSingle = false
  private wantCount = false
  private joinLeads = false
  private joinLeadCols: string[] = []

  constructor(table: string) {
    this.table = assertSafeTable(table)
  }

  select(cols = "*", opts?: { count?: "exact"; head?: boolean }) {
    if (cols.includes("leads(")) {
      // Supabase-style embedded relation: select("*, leads(name, phone)") is
      // translated into a LEFT JOIN + lead_ prefixed columns.
      this.cols = "*"
      this.joinLeads = true
      const m = cols.match(/leads\(([^)]+)\)/)
      this.joinLeadCols = (m ? m[1].split(",").map((s) => s.trim()) : ["name", "phone"]).map(assertSafeIdentifier)
    } else {
      this.cols = cols === "*" ? "*" : assertSafeSelectList(cols)
    }
    if (opts?.count === "exact") this.wantCount = true
    return this
  }

  eq(column: string, value: unknown) {
    this.filters.push({ column: assertSafeIdentifier(column), op: "eq", value })
    return this
  }

  ilike(column: string, pattern: string) {
    this.filters.push({ column: assertSafeIdentifier(column), op: "ilike", value: pattern.replace(/%/g, "") })
    return this
  }

  // Exact SQL LIKE — the caller supplies the wildcards (e.g. "wacall-%").
  // Unlike ilike(), the pattern is kept verbatim: partial matches with custom
  // prefixes (voice_calls sid namespaces) need the % where it is, not wrapped
  // around both ends.
  like(column: string, pattern: string) {
    this.filters.push({ column: assertSafeIdentifier(column), op: "like", value: pattern })
    return this
  }

  order(column: string, opts?: { ascending?: boolean }) {
    this.orderCol = assertSafeIdentifier(column)
    this.orderAsc = opts?.ascending ?? true
    return this
  }

  limit(n: number) {
    // LIMIT is interpolated — clamp to a sane integer range so a caller
    // passing req query input can never change the statement shape.
    const num = Math.floor(Number(n))
    this.limitN = Number.isFinite(num) ? Math.min(Math.max(num, 1), 10_000) : 100
    return this
  }

  single(): Promise<DbResult<Row>> {
    this.wantSingle = true
    return this.exec()
  }

  /** Like single(), but 0 matching rows is data:null with NO error. */
  maybeSingle(): Promise<DbResult<Row>> {
    return this.exec().then((r) => ({
      data: Array.isArray(r.data) ? ((r.data[0] ?? null) as Row) : (r.data as Row),
      error: r.error?.message === "No rows found" ? null : r.error,
    }))
  }

  private buildWhere(prefix = ""): { clause: string; params: unknown[] } {
    if (this.filters.length === 0) return { clause: "", params: [] }
    const params: unknown[] = []
    const parts = this.filters.map((f, i) => {
      params.push(f.op === "ilike" ? `%${String(f.value)}%` : f.value)
      const col = prefix ? `${prefix}.${f.column}` : f.column
      return f.op === "ilike"
        ? `${col} ILIKE $${i + 1}`
        : f.op === "like"
          ? `${col} LIKE $${i + 1}`
          : `${col} = $${i + 1}`
    })
    return { clause: "WHERE " + parts.join(" AND "), params }
  }

  private async exec(): Promise<DbResult<Row>> {
    try {
      if (this.wantCount) {
        const { clause, params } = this.buildWhere()
        const res = await query(`SELECT COUNT(*) FROM ${this.table} ${clause}`, params)
        const count = Number.parseInt(String((res.rows[0] as QueryResultRow).count), 10)
        return { data: null, error: null, count: Number.isFinite(count) ? count : 0 }
      }

      let sql: string
      let params: unknown[]

      if (this.joinLeads && this.table !== "leads") {
        const leadCols = this.joinLeadCols.map((c) => `l.${c} as lead_${c}`).join(", ")
        const { clause, params: p } = this.buildWhere("t")
        sql = `SELECT t.*, ${leadCols} FROM ${this.table} t LEFT JOIN leads l ON t.lead_id = l.id ${clause}`
        params = p
        if (this.orderCol) sql += ` ORDER BY t.${this.orderCol} ${this.orderAsc ? "ASC" : "DESC"}`
      } else {
        const { clause, params: p } = this.buildWhere()
        sql = `SELECT ${this.cols} FROM ${this.table} ${clause}`
        params = p
        if (this.orderCol) sql += ` ORDER BY ${this.orderCol} ${this.orderAsc ? "ASC" : "DESC"}`
      }
      if (this.limitN) sql += ` LIMIT ${this.limitN}`

      const res = await query(sql, params)

      const rows = this.joinLeads
        ? (res.rows as QueryResultRow[]).map((row) => {
            const leads: Record<string, unknown> = {}
            const clean: Record<string, unknown> = {}
            for (const k in row) {
              if (k.startsWith("lead_")) leads[k.replace("lead_", "")] = row[k]
              else clean[k] = row[k]
            }
            clean.leads = leads
            return clean
          })
        : (res.rows as QueryResultRow[])

      if (this.wantSingle) {
        return { data: (rows[0] ?? null) as Row, error: rows[0] ? null : { message: "No rows found" } }
      }
      return { data: rows as Row, error: null }
    } catch (e) {
      return { data: (this.wantSingle ? null : []) as Row, error: logFailure("select", this.table, e) }
    }
  }

  then<T1 = DbResult<Row>, T2 = never>(
    onfulfilled?: ((value: DbResult<Row>) => T1 | PromiseLike<T1>) | null,
    onrejected?: ((reason: unknown) => T2 | PromiseLike<T2>) | null
  ): PromiseLike<T1 | T2> {
    return this.exec().then(onfulfilled, onrejected)
  }
}

// ---- Table proxy: routes .insert/.update/.upsert/.delete to right builder, .select starts a SelectBuilder ----
class TableProxy<Row = any> {
  constructor(private table: string) {}

  select(cols = "*", opts?: { count?: "exact"; head?: boolean }) {
    return new SelectBuilder<Row>(this.table).select(cols, opts)
  }

  insert(values: Record<string, unknown> | Record<string, unknown>[]) {
    return new InsertBuilder<Row>(this.table, values)
  }

  update(values: Record<string, unknown>) {
    return new UpdateBuilder<Row>(this.table, values)
  }

  upsert(values: Record<string, unknown>, opts?: { onConflict?: string }) {
    return new UpsertBuilder<Row>(this.table, values, opts?.onConflict || "id")
  }

  delete() {
    return new DeleteBuilder(this.table)
  }
}

export const db = {
  from<Row = any>(table: string) {
    return new TableProxy<Row>(table)
  },
}

export async function checkDbHealth(): Promise<{ ok: boolean; message: string }> {
  try {
    await query("SELECT 1")
    return { ok: true, message: "PostgreSQL connected" }
  } catch (e) {
    return { ok: false, message: `PostgreSQL connection failed: ${errorMessage(e)}` }
  }
}

export default pool
