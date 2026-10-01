import type {
  SchemaIntelCheckId,
  SchemaIntelFinding,
  SchemaIntelReport,
  SchemaIntelSeverity
} from '@shared/index'
import { ALL_CHECK_IDS } from './args'

const SEVERITY_RANK: Record<SchemaIntelSeverity, number> = { info: 0, warning: 1, critical: 2 }

export interface Palette {
  bold: (s: string) => string
  dim: (s: string) => string
  red: (s: string) => string
  yellow: (s: string) => string
  blue: (s: string) => string
  green: (s: string) => string
  cyan: (s: string) => string
}

export const PLAIN: Palette = {
  bold: (s) => s,
  dim: (s) => s,
  red: (s) => s,
  yellow: (s) => s,
  blue: (s) => s,
  green: (s) => s,
  cyan: (s) => s
}

export function atOrAbove(severity: SchemaIntelSeverity, threshold: SchemaIntelSeverity): boolean {
  return SEVERITY_RANK[severity] >= SEVERITY_RANK[threshold]
}

/**
 * Exit code for a report. 1 when a finding meets the --fail-on threshold.
 * 2 when gating and any check was skipped: a gate that passes because the
 * checks couldn't run is worse than one that fails loudly.
 */
export function exitCodeFor(
  report: Pick<SchemaIntelReport, 'findings' | 'skipped'>,
  failOn: SchemaIntelSeverity | undefined
): 0 | 1 | 2 {
  if (failOn === undefined) return 0
  if (report.findings.some((f) => atOrAbove(f.severity, failOn))) return 1
  if (report.skipped.length > 0) return 2
  return 0
}

export function countBySeverity(
  findings: readonly SchemaIntelFinding[]
): Record<SchemaIntelSeverity, number> {
  const counts: Record<SchemaIntelSeverity, number> = { critical: 0, warning: 0, info: 0 }
  for (const f of findings) counts[f.severity]++
  return counts
}

/**
 * One line of copy per check, said once per group rather than once per row.
 * `noun` is pluralised with the count; `why` is the one sentence that earns
 * the finding its place.
 */
const CHECK_COPY: Record<SchemaIntelCheckId, { noun: [string, string]; why: string }> = {
  invalid_indexes: {
    noun: ['invalid index', 'invalid indexes'],
    why: 'The planner ignores these. Drop, then rebuild with CREATE INDEX CONCURRENTLY.'
  },
  tables_without_pk: {
    noun: ['table without a primary key', 'tables without a primary key'],
    why: 'Rows cannot be uniquely addressed for edits, replication, or tooling.'
  },
  missing_fk_indexes: {
    noun: ['foreign key without a supporting index', 'foreign keys without a supporting index'],
    why: 'Deletes on the parent and joins over the key scan the whole child table.'
  },
  duplicate_indexes: {
    noun: ['duplicate index', 'duplicate indexes'],
    why: 'Same definition twice. The extra copy only slows writes.'
  },
  unused_indexes: {
    noun: ['index never read', 'indexes never read'],
    why: 'idx_scan is 0 since the last stats reset. Safe to drop if uptime is long.'
  },
  bloated_tables: {
    noun: ['bloated table', 'bloated tables'],
    why: 'Over a fifth of the rows are dead tuples. VACUUM reclaims them.'
  },
  never_vacuumed: {
    noun: ['table never vacuumed or analysed', 'tables never vacuumed or analysed'],
    why: 'The planner has no statistics for these, so its row estimates are guesses.'
  },
  nullable_fks: {
    noun: ['nullable foreign key', 'nullable foreign keys'],
    why: 'Fine when NULL means "no reference". Otherwise add NOT NULL to keep out orphans.'
  }
}

const CHECK_LABEL: Record<SchemaIntelCheckId, string> = {
  invalid_indexes: 'invalid indexes',
  tables_without_pk: 'primary keys',
  missing_fk_indexes: 'FK indexes',
  duplicate_indexes: 'duplicate indexes',
  unused_indexes: 'unused indexes',
  bloated_tables: 'bloat',
  never_vacuumed: 'vacuum',
  nullable_fks: 'nullable FKs'
}

function noun(checkId: SchemaIntelCheckId, count: number): string {
  const [one, many] = CHECK_COPY[checkId].noun
  return `${count} ${count === 1 ? one : many}`
}

/** `public.` is the default and carries no information; other schemas are kept. */
function entityName(schema: string | undefined, name: string): string {
  return schema && schema !== 'public' ? `${schema}.${name}` : name
}

function formatBytes(bytes: number): string {
  if (bytes >= 1 << 30) return `${(bytes / (1 << 30)).toFixed(1)} GB`
  if (bytes >= 1 << 20) return `${(bytes / (1 << 20)).toFixed(0)} MB`
  if (bytes >= 1 << 10) return `${(bytes / (1 << 10)).toFixed(0)} kB`
  return `${bytes} B`
}

function formatRows(rows: number): string {
  if (rows >= 1_000_000) return `${(rows / 1_000_000).toFixed(1)}M rows`
  if (rows >= 1_000) return `${(rows / 1_000).toFixed(0)}k rows`
  return `${rows} rows`
}

/**
 * The dense, per-row label: what it is and the one number that matters.
 * Built from entity + metadata so the group heading can carry the prose.
 */
export function entityLabel(f: SchemaIntelFinding): { name: string; note?: string } {
  const m = f.metadata ?? {}
  const schema = f.entity?.schema
  const name = f.entity?.name ?? f.title
  const cols = Array.isArray(m.columns) ? (m.columns as string[]).join(', ') : undefined
  switch (f.checkId) {
    case 'missing_fk_indexes':
    case 'nullable_fks':
      return { name: `${entityName(schema, name)}(${cols ?? '?'})` }
    case 'tables_without_pk': {
      const rows = Number(m.estimatedRows ?? 0)
      return { name: entityName(schema, name), note: rows > 0 ? `~${formatRows(rows)}` : undefined }
    }
    case 'duplicate_indexes': {
      const dups = Array.isArray(m.duplicates) ? (m.duplicates as string[]) : []
      return {
        name: entityName(schema, name),
        note: `${dups.join(', ')} duplicates ${m.keptIndex}`
      }
    }
    case 'unused_indexes':
      return {
        name: entityName(schema, name),
        note: `${formatBytes(Number(m.sizeBytes ?? 0))} on ${m.table}`
      }
    case 'invalid_indexes':
      return { name: entityName(schema, name), note: `on ${m.table}` }
    case 'bloated_tables':
      return {
        name: entityName(schema, name),
        note: `${m.deadPct}% dead · ${m.sizePretty}`
      }
    case 'never_vacuumed':
      return { name: entityName(schema, name), note: formatRows(Number(m.liveRows ?? 0)) }
  }
}

function severityMark(severity: SchemaIntelSeverity, p: Palette): string {
  switch (severity) {
    case 'critical':
      return p.red('✖')
    case 'warning':
      return p.yellow('▲')
    case 'info':
      return p.blue('●')
  }
}

/** Greedy word wrap that is aware of nothing but spaces. Good enough for prose. */
export function wrap(text: string, width: number, indent = ''): string[] {
  const words = text.split(' ')
  const lines: string[] = []
  let line = ''
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word
    if (indent.length + candidate.length > width && line) {
      lines.push(indent + line)
      line = word
    } else {
      line = candidate
    }
  }
  if (line) lines.push(indent + line)
  return lines
}

export interface FormatContext {
  database: string
  host: string
  palette: Palette
  /** Checks that were requested, so the clean ones can be named. */
  ran: readonly SchemaIntelCheckId[]
  serverVersion?: string
  width?: number
}

const INDENT = '  '
const SQL_INDENT = '    '

/**
 * Render a report as terminal text.
 *
 * Grouped by check, most severe first, with the explanation said once per
 * group and the entities listed densely beneath it. Ends with the checks that
 * came back clean, because what passed is part of the answer.
 */
export function formatReport(report: SchemaIntelReport, ctx: FormatContext): string {
  const p = ctx.palette
  const width = Math.min(Math.max(ctx.width ?? 80, 60), 110)
  const out: string[] = []

  const head = [
    p.bold('data-peek doctor'),
    `${ctx.database} @ ${ctx.host}`,
    ctx.serverVersion,
    `${ctx.ran.length} check${ctx.ran.length === 1 ? '' : 's'} in ${report.durationMs} ms`
  ].filter((s): s is string => Boolean(s))
  out.push(head.join(p.dim(' · ')))
  out.push('')

  const byCheck = new Map<SchemaIntelCheckId, SchemaIntelFinding[]>()
  for (const f of report.findings) byCheck.set(f.checkId, [...(byCheck.get(f.checkId) ?? []), f])

  const groups = [...byCheck.entries()].sort(([a, fa], [b, fb]) => {
    const bySeverity = SEVERITY_RANK[fb[0].severity] - SEVERITY_RANK[fa[0].severity]
    return bySeverity !== 0 ? bySeverity : ALL_CHECK_IDS.indexOf(a) - ALL_CHECK_IDS.indexOf(b)
  })

  for (const [checkId, findings] of groups) {
    const severity = findings[0].severity
    out.push(`${severityMark(severity, p)} ${p.bold(noun(checkId, findings.length))}`)
    out.push(...wrap(CHECK_COPY[checkId].why, width, INDENT).map((l) => p.dim(l)))
    out.push('')

    const hasSql = findings.some((f) => f.suggestedSql)
    if (!hasSql) {
      const names = findings.map((f) => entityLabel(f).name).join(', ')
      out.push(...wrap(names, width, INDENT))
    } else {
      for (const f of findings) {
        const { name, note } = entityLabel(f)
        out.push(INDENT + name + (note ? p.dim(`  ${note}`) : ''))
        if (f.suggestedSql) {
          for (const line of f.suggestedSql.split('\n')) out.push(SQL_INDENT + p.cyan(line))
        }
      }
    }
    out.push('')
  }

  const clean = ctx.ran.filter(
    (id) => !byCheck.has(id) && !report.skipped.some((s) => s.checkId === id)
  )
  const cleanNames = clean.map((id) => CHECK_LABEL[id]).join(', ')
  if (clean.length > 0 && report.findings.length > 0) {
    out.push(`${p.green('✔')} ${p.bold('clean')}  ${p.dim(cleanNames)}`)
  }
  for (const s of report.skipped) {
    out.push(
      `${p.dim('–')} ${p.bold('skipped')}  ${CHECK_LABEL[s.checkId]}${p.dim(`: ${s.reason}`)}`
    )
  }
  if ((clean.length > 0 && report.findings.length > 0) || report.skipped.length > 0) out.push('')

  const counts = countBySeverity(report.findings)
  const summary = [
    counts.critical ? p.red(`${counts.critical} critical`) : null,
    counts.warning ? p.yellow(`${counts.warning} warning${counts.warning === 1 ? '' : 's'}`) : null,
    counts.info ? p.blue(`${counts.info} info`) : null
  ].filter((s): s is string => s !== null)

  if (report.findings.length === 0) {
    out.push(`${p.green('✔')} ${p.bold('No findings.')} ${p.dim(`${cleanNames} all clean.`)}`)
  } else {
    out.push(
      `${summary.join(p.dim(' · '))}${p.dim(` · ${report.findings.length} finding${report.findings.length === 1 ? '' : 's'}`)}`
    )
    out.push(p.dim(`Fix with a click: open ${ctx.database} in data-peek → https://datapeek.dev`))
  }

  return out.join('\n')
}
