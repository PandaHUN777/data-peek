import { describe, expect, it } from 'vitest'
import type { SchemaIntelReport } from '@shared/index'
import { atOrAbove, countBySeverity, exitCodeFor, formatReport, PLAIN } from '../format'

const report: SchemaIntelReport = {
  findings: [
    {
      checkId: 'unused_indexes',
      severity: 'info',
      title: 'public.idx_orders_old (14 MB) has never been used',
      detail: 'No reads have hit this index since the stats were reset.',
      suggestedSql: 'DROP INDEX "public"."idx_orders_old";'
    },
    {
      checkId: 'invalid_indexes',
      severity: 'critical',
      title: 'public.idx_broken is invalid',
      suggestedSql: 'DROP INDEX "public"."idx_broken";\n-- Then rebuild'
    },
    {
      checkId: 'missing_fk_indexes',
      severity: 'warning',
      title: 'public.orders(customer_id) is a FK without a supporting index'
    }
  ],
  skipped: [
    {
      checkId: 'bloated_tables',
      reason: 'permission denied for pg_stat_user_tables'
    }
  ],
  durationMs: 42,
  ranAt: 0
}

const ctx = { database: 'acme', host: 'localhost:5432', palette: PLAIN }

describe('formatReport', () => {
  it('orders findings most severe first', () => {
    const out = formatReport(report, ctx)
    const critical = out.indexOf('idx_broken')
    const warning = out.indexOf('orders(customer_id)')
    const info = out.indexOf('idx_orders_old')
    expect(critical).toBeGreaterThan(-1)
    expect(critical).toBeLessThan(warning)
    expect(warning).toBeLessThan(info)
  })

  it('prints suggested SQL and multi-line SQL stays indented', () => {
    const out = formatReport(report, ctx)
    expect(out).toContain('DROP INDEX "public"."idx_orders_old";')
    expect(out).toContain('            -- Then rebuild')
  })

  it('lists skipped checks with their reason', () => {
    expect(formatReport(report, ctx)).toContain('skipped bloated_tables: permission denied')
  })

  it('summarises counts', () => {
    expect(formatReport(report, ctx)).toContain('3 findings (1 critical, 1 warning, 1 info)')
  })

  it('celebrates an empty report', () => {
    const out = formatReport({ findings: [], skipped: [], durationMs: 5, ranAt: 0 }, ctx)
    expect(out).toContain('No findings')
    expect(out).toContain('0 findings')
  })
})

describe('severity helpers', () => {
  it('counts by severity', () => {
    expect(countBySeverity(report.findings)).toEqual({
      critical: 1,
      warning: 1,
      info: 1
    })
  })

  it('compares thresholds', () => {
    expect(atOrAbove('critical', 'warning')).toBe(true)
    expect(atOrAbove('warning', 'warning')).toBe(true)
    expect(atOrAbove('info', 'warning')).toBe(false)
  })
})

describe('exitCodeFor', () => {
  const finding = { checkId: 'bloated_tables', severity: 'info', title: 't' } as const
  const skipped = { checkId: 'unused_indexes', reason: 'permission denied' } as const

  it('is 0 without a gate, whatever happened', () => {
    expect(exitCodeFor({ findings: [finding], skipped: [skipped] }, undefined)).toBe(0)
  })

  it('is 1 when a finding meets the threshold', () => {
    expect(exitCodeFor({ findings: [finding], skipped: [] }, 'info')).toBe(1)
    expect(exitCodeFor({ findings: [finding], skipped: [skipped] }, 'info')).toBe(1)
  })

  it('is 2 when gating and a check was skipped, even with findings below the threshold', () => {
    expect(exitCodeFor({ findings: [finding], skipped: [skipped] }, 'warning')).toBe(2)
    expect(exitCodeFor({ findings: [], skipped: [skipped] }, 'warning')).toBe(2)
  })

  it('is 0 when gating, clean, and nothing skipped', () => {
    expect(exitCodeFor({ findings: [finding], skipped: [] }, 'warning')).toBe(0)
  })
})
