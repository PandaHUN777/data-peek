import type { SchemaIntelFinding, SchemaIntelReport, SchemaIntelSeverity } from '@shared/index'

const SEVERITY_RANK: Record<SchemaIntelSeverity, number> = {
  info: 0,
  warning: 1,
  critical: 2
}

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
  const counts: Record<SchemaIntelSeverity, number> = {
    critical: 0,
    warning: 0,
    info: 0
  }
  for (const f of findings) counts[f.severity]++
  return counts
}

function severityLabel(severity: SchemaIntelSeverity, p: Palette): string {
  switch (severity) {
    case 'critical':
      return p.red('✖ critical')
    case 'warning':
      return p.yellow('▲ warning ')
    case 'info':
      return p.blue('● info    ')
  }
}

function indent(text: string, prefix: string): string {
  return text
    .split('\n')
    .map((line) => prefix + line)
    .join('\n')
}

export interface FormatContext {
  database: string
  host: string
  palette: Palette
}

/**
 * Render a report as terminal text. Findings are grouped by severity, most
 * severe first, so the thing to fix now is at the top. Pure: no I/O.
 */
export function formatReport(report: SchemaIntelReport, ctx: FormatContext): string {
  const p = ctx.palette
  const lines: string[] = []
  const counts = countBySeverity(report.findings)

  lines.push(p.bold(`data-peek doctor`) + p.dim(`  ${ctx.database} @ ${ctx.host}`))
  lines.push('')

  if (report.findings.length === 0) {
    lines.push(p.green('✔ No findings.') + p.dim(' Every check came back clean.'))
  }

  const ordered: SchemaIntelSeverity[] = ['critical', 'warning', 'info']
  for (const severity of ordered) {
    const group = report.findings.filter((f) => f.severity === severity)
    if (group.length === 0) continue
    for (const finding of group) {
      lines.push(`${severityLabel(severity, p)}  ${p.bold(finding.title)}`)
      if (finding.detail) lines.push(indent(finding.detail, '            '))
      if (finding.suggestedSql) {
        lines.push(indent(p.cyan(finding.suggestedSql), '            '))
      }
      lines.push('')
    }
  }

  if (report.skipped.length > 0) {
    for (const s of report.skipped) {
      lines.push(p.dim(`– skipped ${s.checkId}: ${s.reason}`))
    }
    lines.push('')
  }

  const summary = [
    counts.critical ? p.red(`${counts.critical} critical`) : null,
    counts.warning ? p.yellow(`${counts.warning} warning${counts.warning === 1 ? '' : 's'}`) : null,
    counts.info ? p.blue(`${counts.info} info`) : null
  ].filter((s): s is string => s !== null)

  lines.push(
    p.dim(
      `${report.findings.length} finding${report.findings.length === 1 ? '' : 's'}` +
        (summary.length ? ` (${summary.join(', ')})` : '') +
        ` · ${report.findings.length === 0 ? 'checks' : 'ran'} in ${report.durationMs} ms`
    )
  )
  lines.push(
    p.dim('Open this connection in data-peek to apply fixes with a click → https://datapeek.dev')
  )

  return lines.join('\n')
}
