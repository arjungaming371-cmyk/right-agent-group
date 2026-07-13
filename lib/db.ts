// Local PostgreSQL client - Supabase-compatible wrapper
import { Pool } from "pg"

const pool = new Pool({
  host: process.env.PG_HOST || "localhost",
  port: parseInt(process.env.PG_PORT || "5432"),
  database: process.env.PG_DATABASE || "right_agent_group",
  user: process.env.PG_USER || "postgres",
  password: process.env.PG_PASSWORD || "",
  max: 10,
  idleTimeoutMillis: 30000,
})

pool.on("error", (err) => console.error("Unexpected PostgreSQL error:", err))

export async function query(text: string, params?: any[]) {
  const client = await pool.connect()
  try {
    return await client.query(text, params)
  } finally {
    client.release()
  }
}

function serialize(val: any): any {
  if (val !== null && typeof val === "object" && !(val instanceof Date)) {
    return JSON.stringify(val)
  }
  return val
}

// Column/table identifiers get interpolated directly into SQL (Postgres has
// no way to parameterize an identifier). insert()/update() are frequently
// called with `req.json()`'s keys as the values object (e.g. app/api/leads
// POST/PATCH) — without this check, a request body like
// {"status = (SELECT ...), foo": "x"} becomes a real injected column
// expression. Every column name is validated against a strict identifier
// pattern before it ever reaches a query string.
const SAFE_IDENTIFIER_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/
function assertSafeIdentifier(name: string): string {
  if (!SAFE_IDENTIFIER_RE.test(name)) {
    throw new Error(`Unsafe column name: ${JSON.stringify(name)}`)
  }
  return name
}

type Filter = { column: string; op: "eq" | "ilike"; value: any }

// ---- INSERT builder ----
class InsertBuilder implements PromiseLike<{ data: any; error: any }> {
  private table: string
  private rows: Record<string, any>[]
  private wantSelect = false

  constructor(table: string, values: Record<string, any> | Record<string, any>[]) {
    this.table = table
    this.rows = Array.isArray(values) ? values : [values]
  }

  select() {
    this.wantSelect = true
    return this
  }

  single() {
    return this.exec().then((r) => ({
      data: Array.isArray(r.data) ? r.data[0] ?? null : r.data,
      error: r.error,
    }))
  }

  private async exec(): Promise<{ data: any; error: any }> {
    try {
      if (this.rows.length === 0) return { data: null, error: { message: "No values" } }
      const cols = Object.keys(this.rows[0]).map(assertSafeIdentifier)
      const params: any[] = []
      const placeholders = this.rows.map((row, rIdx) => {
        const ph = cols.map((col, cIdx) => {
          params.push(serialize(row[col] ?? null))
          return `$${rIdx * cols.length + cIdx + 1}`
        })
        return `(${ph.join(", ")})`
      })
      const sql = `INSERT INTO ${this.table} (${cols.join(", ")}) VALUES ${placeholders.join(", ")} RETURNING *`
      const res = await query(sql, params)
      return { data: this.rows.length === 1 ? res.rows[0] : res.rows, error: null }
    } catch (e: any) {
      return { data: null, error: { message: e.message } }
    }
  }

  then<T1 = { data: any; error: any }, T2 = never>(
    onfulfilled?: ((value: { data: any; error: any }) => T1 | PromiseLike<T1>) | null,
    onrejected?: ((reason: any) => T2 | PromiseLike<T2>) | null
  ): PromiseLike<T1 | T2> {
    return this.exec().then(onfulfilled, onrejected)
  }

  catch<T = never>(onrejected?: ((reason: any) => T | PromiseLike<T>) | null) {
    return this.exec().catch(onrejected)
  }
}

// ---- UPDATE builder (filters applied via .eq() AFTER .update()) ----
class UpdateBuilder implements PromiseLike<{ data: any; error: any }> {
  private table: string
  private values: Record<string, any>
  private filters: Filter[] = []
  private wantSingle = false

  constructor(table: string, values: Record<string, any>) {
    this.table = table
    this.values = values
  }

  eq(column: string, value: any) {
    this.filters.push({ column, op: "eq", value })
    return this
  }

  select() {
    return this
  }

  single() {
    this.wantSingle = true
    return this.exec().then((r) => ({
      data: Array.isArray(r.data) ? r.data[0] ?? null : r.data,
      error: r.error,
    }))
  }

  private async exec(): Promise<{ data: any; error: any }> {
    try {
      const cols = Object.keys(this.values).map(assertSafeIdentifier)
      if (cols.length === 0) return { data: null, error: { message: "No values to update" } }

      const setParts = cols.map((c, i) => `${c} = $${i + 1}`)
      const params: any[] = cols.map((c) => serialize(this.values[c]))

      let idx = cols.length + 1
      const whereParts: string[] = []
      for (const f of this.filters) {
        if (f.op === "ilike") {
          whereParts.push(`${f.column} ILIKE $${idx}`)
          params.push(`%${f.value}%`)
        } else {
          whereParts.push(`${f.column} = $${idx}`)
          params.push(f.value)
        }
        idx++
      }
      const where = whereParts.length ? `WHERE ${whereParts.join(" AND ")}` : ""
      const sql = `UPDATE ${this.table} SET ${setParts.join(", ")} ${where} RETURNING *`
      const res = await query(sql, params)
      return { data: res.rows, error: null }
    } catch (e: any) {
      return { data: null, error: { message: e.message } }
    }
  }

  then<T1 = { data: any; error: any }, T2 = never>(
    onfulfilled?: ((value: { data: any; error: any }) => T1 | PromiseLike<T1>) | null,
    onrejected?: ((reason: any) => T2 | PromiseLike<T2>) | null
  ): PromiseLike<T1 | T2> {
    return this.exec().then(
      (r) => onfulfilled?.({ data: this.wantSingle ? (Array.isArray(r.data) ? r.data[0] ?? null : r.data) : r.data, error: r.error }) as any,
      onrejected
    )
  }

  catch<T = never>(onrejected?: ((reason: any) => T | PromiseLike<T>) | null) {
    return this.exec().catch(onrejected)
  }
}

// ---- UPSERT builder ----
class UpsertBuilder implements PromiseLike<{ data: any; error: any }> {
  private table: string
  private values: Record<string, any>
  private conflictCol: string

  constructor(table: string, values: Record<string, any>, conflictCol: string) {
    this.table = table
    this.values = values
    this.conflictCol = conflictCol
  }

  private async exec(): Promise<{ data: any; error: any }> {
    try {
      const cols = Object.keys(this.values).map(assertSafeIdentifier)
      const placeholders = cols.map((_, i) => `$${i + 1}`)
      const params = cols.map((c) => serialize(this.values[c]))
      const updateParts = cols.filter((c) => c !== this.conflictCol).map((c) => `${c} = EXCLUDED.${c}`)
      const sql = `INSERT INTO ${this.table} (${cols.join(", ")}) VALUES (${placeholders.join(", ")})
        ON CONFLICT (${this.conflictCol}) DO UPDATE SET ${updateParts.join(", ")} RETURNING *`
      const res = await query(sql, params)
      return { data: res.rows[0], error: null }
    } catch (e: any) {
      return { data: null, error: { message: e.message } }
    }
  }

  then<T1 = { data: any; error: any }, T2 = never>(
    onfulfilled?: ((value: { data: any; error: any }) => T1 | PromiseLike<T1>) | null,
    onrejected?: ((reason: any) => T2 | PromiseLike<T2>) | null
  ): PromiseLike<T1 | T2> {
    return this.exec().then(onfulfilled, onrejected)
  }

  catch<T = never>(onrejected?: ((reason: any) => T | PromiseLike<T>) | null) {
    return this.exec().catch(onrejected)
  }
}

// ---- DELETE builder ----
class DeleteBuilder implements PromiseLike<{ data: any; error: any }> {
  private table: string
  private filters: Filter[] = []

  constructor(table: string) {
    this.table = table
  }

  eq(column: string, value: any) {
    this.filters.push({ column, op: "eq", value })
    return this
  }

  private async exec(): Promise<{ data: any; error: any }> {
    try {
      const params: any[] = []
      const whereParts = this.filters.map((f, i) => {
        params.push(f.value)
        return `${f.column} = $${i + 1}`
      })
      const where = whereParts.length ? `WHERE ${whereParts.join(" AND ")}` : ""
      await query(`DELETE FROM ${this.table} ${where}`, params)
      return { data: null, error: null }
    } catch (e: any) {
      return { data: null, error: { message: e.message } }
    }
  }

  then<T1 = { data: any; error: any }, T2 = never>(
    onfulfilled?: ((value: { data: any; error: any }) => T1 | PromiseLike<T1>) | null,
    onrejected?: ((reason: any) => T2 | PromiseLike<T2>) | null
  ): PromiseLike<T1 | T2> {
    return this.exec().then(onfulfilled, onrejected)
  }
}

// ---- SELECT builder ----
class SelectBuilder implements PromiseLike<{ data: any; error: any; count?: number }> {
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
    this.table = table
  }

  select(cols = "*", opts?: { count?: "exact"; head?: boolean }) {
    if (cols.includes("leads(")) {
      this.cols = "*"
      this.joinLeads = true
      const m = cols.match(/leads\(([^)]+)\)/)
      this.joinLeadCols = m ? m[1].split(",").map((s) => s.trim()) : ["name", "phone"]
    } else {
      this.cols = cols
    }
    if (opts?.count === "exact") this.wantCount = true
    return this
  }

  eq(column: string, value: any) {
    this.filters.push({ column, op: "eq", value })
    return this
  }

  ilike(column: string, pattern: string) {
    this.filters.push({ column, op: "ilike", value: pattern.replace(/%/g, "") })
    return this
  }

  order(column: string, opts?: { ascending?: boolean }) {
    this.orderCol = column
    this.orderAsc = opts?.ascending ?? true
    return this
  }

  limit(n: number) {
    this.limitN = n
    return this
  }

  single() {
    this.wantSingle = true
    return this.exec()
  }

  private buildWhere(prefix = ""): { clause: string; params: any[] } {
    if (this.filters.length === 0) return { clause: "", params: [] }
    const params: any[] = []
    const parts = this.filters.map((f, i) => {
      params.push(f.op === "ilike" ? `%${f.value}%` : f.value)
      const col = prefix ? `${prefix}.${f.column}` : f.column
      return f.op === "ilike" ? `${col} ILIKE $${i + 1}` : `${col} = $${i + 1}`
    })
    return { clause: "WHERE " + parts.join(" AND "), params }
  }

  private async exec(): Promise<{ data: any; error: any; count?: number }> {
    try {
      if (this.wantCount) {
        const { clause, params } = this.buildWhere()
        const res = await query(`SELECT COUNT(*) FROM ${this.table} ${clause}`, params)
        return { data: null, error: null, count: parseInt(res.rows[0].count) }
      }

      let sql: string
      let params: any[]

      if (this.joinLeads && this.table !== "leads") {
        const leadCols = this.joinLeadCols.map((c) => `l.${c} as lead_${c}`).join(", ")
        const { clause, params: p } = this.buildWhere("t")
        sql = `SELECT t.*, ${leadCols} FROM ${this.table} t LEFT JOIN leads l ON t.lead_id = l.id ${clause}`
        params = p
        if (this.orderCol) sql += ` ORDER BY t.${this.orderCol} ${this.orderAsc ? "ASC" : "DESC"}`
      } else {
        const { clause, params: p } = this.buildWhere()
        sql = `SELECT ${this.cols === "*" ? "*" : this.cols} FROM ${this.table} ${clause}`
        params = p
        if (this.orderCol) sql += ` ORDER BY ${this.orderCol} ${this.orderAsc ? "ASC" : "DESC"}`
      }
      if (this.limitN) sql += ` LIMIT ${this.limitN}`

      const res = await query(sql, params)

      const rows = this.joinLeads
        ? res.rows.map((row: any) => {
            const leads: any = {}
            const clean: any = {}
            for (const k in row) {
              if (k.startsWith("lead_")) leads[k.replace("lead_", "")] = row[k]
              else clean[k] = row[k]
            }
            clean.leads = leads
            return clean
          })
        : res.rows

      if (this.wantSingle) {
        return { data: rows[0] ?? null, error: rows[0] ? null : { message: "No rows found" } }
      }
      return { data: rows, error: null }
    } catch (e: any) {
      return { data: this.wantSingle ? null : [], error: { message: e.message } }
    }
  }

  then<T1 = { data: any; error: any; count?: number }, T2 = never>(
    onfulfilled?: ((value: { data: any; error: any; count?: number }) => T1 | PromiseLike<T1>) | null,
    onrejected?: ((reason: any) => T2 | PromiseLike<T2>) | null
  ): PromiseLike<T1 | T2> {
    return this.exec().then(onfulfilled, onrejected)
  }
}

// ---- Table proxy: routes .insert/.update/.upsert/.delete to right builder, .select starts a SelectBuilder ----
class TableProxy {
  constructor(private table: string) {}

  select(cols = "*", opts?: { count?: "exact"; head?: boolean }) {
    return new SelectBuilder(this.table).select(cols, opts)
  }

  insert(values: Record<string, any> | Record<string, any>[]) {
    return new InsertBuilder(this.table, values)
  }

  update(values: Record<string, any>) {
    return new UpdateBuilder(this.table, values)
  }

  upsert(values: Record<string, any>, opts?: { onConflict?: string }) {
    return new UpsertBuilder(this.table, values, opts?.onConflict || "id")
  }

  delete() {
    return new DeleteBuilder(this.table)
  }
}

export const db = {
  from(table: string) {
    return new TableProxy(table)
  },
}

export async function checkDbHealth(): Promise<{ ok: boolean; message: string }> {
  try {
    await query("SELECT 1")
    return { ok: true, message: "PostgreSQL connected" }
  } catch (e: any) {
    return { ok: false, message: `PostgreSQL connection failed: ${e.message}` }
  }
}

export default pool
