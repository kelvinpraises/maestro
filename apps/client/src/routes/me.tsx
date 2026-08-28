// /me — the Me tab. Placeholder pending Phase 3 port.
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/me')({ component: Me })

function Me() {
  return <div className="py-6"><h1 className="text-3xl font-extrabold">Me</h1></div>
}
