import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ConnectionConfig, CsvImportProgress, CsvImportRequest } from '@shared/index'

type Handler = (event: unknown, ...args: unknown[]) => unknown

const { handlers, adapter } = vi.hoisted(() => ({
  handlers: new Map<string, Handler>(),
  adapter: { dbType: 'mssql', execute: vi.fn(async () => ({ rowCount: null })) }
}))

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn((channel: string, handler: Handler) => handlers.set(channel, handler)) }
}))
vi.mock('../db-adapter', () => ({ getAdapter: () => adapter }))
vi.mock('../lib/logger', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() })
}))

import { registerImportHandlers } from '../ipc/import-handlers'

const config = {
  id: 'c1',
  name: 'db',
  dbType: 'mssql'
} as unknown as ConnectionConfig

beforeEach(() => {
  handlers.clear()
  adapter.execute.mockReset()
  registerImportHandlers()
})

describe('registerImportHandlers progress totals', () => {
  it('computes totalBatches matching the effective clamped batch size for MSSQL import', async () => {
    const columns = Array.from({ length: 20 }, (_, i) => `col_${i}`)
    const rows = Array.from({ length: 5000 }, (_, rowIndex) =>
      columns.map((_, colIndex) => `val_${rowIndex}_${colIndex}`)
    )

    const request: CsvImportRequest = {
      schema: 'dbo',
      table: 'items',
      columns,
      mappings: columns.map((col) => ({ csvColumn: col, tableColumn: col })),
      options: {
        batchSize: 500,
        onConflict: 'error',
        truncateFirst: false,
        useTransaction: false,
        useCopy: false
      },
      createTable: false
    }

    const progressUpdates: CsvImportProgress[] = []
    const event = {
      sender: {
        isDestroyed: () => false,
        send: vi.fn((channel: string, progress: CsvImportProgress) => {
          if (channel === 'db:import-progress') {
            progressUpdates.push(progress)
          }
        })
      }
    }

    const handler = handlers.get('db:import-csv')
    expect(handler).toBeDefined()

    const result = await (handler!(event, config, request, rows) as Promise<{
      success: boolean
      data?: { rowsImported: number }
    }>)

    expect(result.success).toBe(true)
    expect(result.data?.rowsImported).toBe(5000)

    // Clamped effective batch size: floor(2098 / 20) = 104 rows
    // Total batches: ceil(5000 / 104) = 49 batches
    const importingUpdates = progressUpdates.filter((p) => p.phase === 'importing')
    expect(importingUpdates.length).toBeGreaterThanOrEqual(1)

    // Initial importing event must report totalBatches = 49 (not unclamped 10)
    expect(importingUpdates[0]).toEqual({
      phase: 'importing',
      rowsImported: 0,
      totalRows: 5000,
      currentBatch: 0,
      totalBatches: 49
    })

    // Completion event must report currentBatch = 49 and totalBatches = 49
    const completeUpdate = progressUpdates.find((p) => p.phase === 'complete')
    expect(completeUpdate).toBeDefined()
    expect(completeUpdate).toEqual({
      phase: 'complete',
      rowsImported: 5000,
      totalRows: 5000,
      currentBatch: 49,
      totalBatches: 49
    })

    // All progress updates in importing phase must agree on totalBatches = 49
    expect(importingUpdates.every((p) => p.totalBatches === 49)).toBe(true)
  })
})
