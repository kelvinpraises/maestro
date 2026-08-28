// /family — the Family tab. Placeholder pending Phase 3 port.
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/family')({ component: Family })

function Family() {
  return <div className="py-6"><h1 className="text-3xl font-extrabold">Family</h1></div>
}
