import { describe, expect, it } from 'vitest'
import type { SchemaIntelReport } from '@shared/index'
import { ALL_CHECK_IDS } from '../args'
import {
  atOrAbove,
  countBySeverity,
  entityLabel,
  exitCodeFor,
  formatReport,
  PLAIN,
  wrap
} from '../format'

const report: SchemaIntelReport = {
  findings: [
    {
      checkId: 'unused_indexes',
      severity: 'info',
      title: 'public.idx_orders_old (14 MB) has never been used',
      entity: { schema: 'public', name: 'idx_orders_old', kind: 'index' },
      metadata: { table: 'orders', sizeBytes: 14 * 1024 * 1024 },
      suggestedSql: 'DROP INDEX "public"."idx_orders_old";'
    },
    {
      checkId: 'invalid_indexes',
      severity: 'critical',
      title: 'public.idx_broken is invalid',
      entity: { schema: 'public', name: 'idx_broken', kind: 'index' },
      metadata: { table: 'orders' },
      suggestedSql: 'DROP INDEX "public"."idx_broken";\n-- Then rebuild'
    },
    {
      checkId: 'missing_fk_indexes',
      severity: 'warning',
      title: 'public.orders(customer_id) is a FK without a supporting index',
      entity: { schema: 'public', name: 'orders', kind: 'foreign_key' },
      metadata: { columns: ['customer_id'] },
      suggestedSql: 'CREATE INDEX "idx_orders_customer_id" ON "public"."orders" ("customer_id");'
    },
    {
      checkId: 'nullable_fks',
      severity: 'info',
      title: 'public.orders(customer_id) is a nullable foreign key',
      entity: { schema: 'public', name: 'orders', kind: 'foreign_key' },
      metadata: { columns: ['customer_id'] }
    },
    {
      checkId: 'nullable_fks',
      severity: 'info',
      title: 'billing.invoices(payer_id) is a nullable foreign key',
      entity: { schema: 'billing', name: 'invoices', kind: 'foreign_key' },
      metadata: { columns: ['payer_id'] }
    }
  ],
  skipped: [{ checkId: 'bloated_tables', reason: 'permission denied for pg_stat_user_tables' }],
  durationMs: 42,
  ranAt: 0
}

const ctx = {
  database: 'acme',
  host: 'localhost:5432',
  palette: PLAIN,
  ran: ALL_CHECK_IDS,
  serverVersion: 'PostgreSQL 16.4',
  width: 80
}

describe('formatReport', () => {
  const out = formatReport(report, ctx)

  it('leads with the target, version, and check count on one line', () => {
    expect(out.split('\n')[0]).toBe(
      'data-peek doctor · acme @ localhost:5432 · PostgreSQL 16.4 · 8 checks in 42 ms'
    )
  })

  it('groups by check, most severe first, and says the why once per group', () => {
    const critical = out.indexOf('1 invalid index')
    const warning = out.indexOf('1 foreign key without a supporting index')
    const info = out.indexOf('1 index never read')
    const nullable = out.indexOf('2 nullable foreign keys')
    expect(critical).toBeGreaterThan(-1)
    expect(critical).toBeLessThan(warning)
    expect(warning).toBeLessThan(info)
    expect(info).toBeLessThan(nullable)
    expect(out.match(/Fine when NULL means/g)).toHaveLength(1)
  })

  it('lists entities densely when a group has no SQL', () => {
    expect(out).toContain('  orders(customer_id), billing.invoices(payer_id)')
  })

  it('drops the public schema prefix and keeps others', () => {
    expect(out).not.toContain('public.orders')
    expect(out).toContain('billing.invoices')
  })

  it('prints suggested SQL under its entity, multi-line SQL kept', () => {
    expect(out).toContain(
      '  idx_broken  on orders\n    DROP INDEX "public"."idx_broken";\n    -- Then rebuild'
    )
    expect(out).toContain('  idx_orders_old  14 MB on orders')
  })

  it('names the clean checks and the skipped ones', () => {
    expect(out).toContain('✔ clean  primary keys, duplicate indexes, vacuum')
    expect(out).toContain('– skipped  bloat: permission denied')
  })

  it('summarises counts and points at the app', () => {
    expect(out).toContain('1 critical · 1 warning · 3 info · 5 findings')
    expect(out).toContain('open acme in data-peek')
  })

  it('celebrates an empty report and still names the clean checks', () => {
    const clean = formatReport({ findings: [], skipped: [], durationMs: 5, ranAt: 0 }, ctx)
    expect(clean).toContain('No findings')
    expect(clean).toContain('No findings. primary keys, FK indexes')
    expect(clean).not.toContain('✔ clean ')
    expect(clean).not.toContain('datapeek.dev')
  })
})

describe('entityLabel', () => {
  it('shows the one number that matters per check', () => {
    expect(
      entityLabel({
        checkId: 'bloated_tables',
        severity: 'info',
        title: '',
        entity: { schema: 'public', name: 'churn', kind: 'table' },
        metadata: { deadPct: 66.67, sizePretty: '5 MB' }
      })
    ).toEqual({ name: 'churn', note: '66.67% dead · 5 MB' })
    expect(
      entityLabel({
        checkId: 'tables_without_pk',
        severity: 'warning',
        title: '',
        entity: { schema: 'public', name: 'audit_events', kind: 'table' },
        metadata: { estimatedRows: 1_250_000 }
      })
    ).toEqual({ name: 'audit_events', note: '~1.3M rows' })
  })
})

describe('wrap', () => {
  it('wraps at the width with the indent counted', () => {
    const lines = wrap('one two three four five six', 14, '  ')
    expect(lines).toEqual(['  one two', '  three four', '  five six'])
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

describe('severity helpers', () => {
  it('counts by severity', () => {
    expect(countBySeverity(report.findings)).toEqual({ critical: 1, warning: 1, info: 3 })
  })

  it('compares thresholds', () => {
    expect(atOrAbove('critical', 'warning')).toBe(true)
    expect(atOrAbove('warning', 'warning')).toBe(true)
    expect(atOrAbove('info', 'warning')).toBe(false)
  })
})
