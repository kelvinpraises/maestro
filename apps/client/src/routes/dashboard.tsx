// /dashboard — the Home tab. Placeholder pending Phase 3 port; exists so the
// BottomNav has a valid target.
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/dashboard')({ component: Dashboard })

function Dashboard() {
  return <div className="py-6"><h1 className="text-3xl font-extrabold">Home</h1></div>
}
