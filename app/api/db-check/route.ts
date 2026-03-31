import { NextResponse } from 'next/server'
import { getDB } from '@/lib/db'

export const revalidate = 0

export async function GET() {
  const db = getDB()

  // Clean up stale/empty records
  const deleted = db.prepare(`
    DELETE FROM store_daily_sales WHERE sales = 0 AND customers <= 1
  `).run()

  return NextResponse.json({
    message: 'Cleanup done',
    deletedRows: deleted.changes,
  })
}
