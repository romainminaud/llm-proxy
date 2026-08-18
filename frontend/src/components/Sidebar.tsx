import { NavLink } from 'react-router-dom'
import { Columns2, CornerDownLeft, ScrollText, Settings, Waypoints } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAppContext } from '../context/AppContext'

const NAV = [
  { to: '/logs', label: 'Logs', icon: ScrollText },
  { to: '/sessions', label: 'Sessions', icon: Waypoints },
  { to: '/turns', label: 'Turns', icon: CornerDownLeft },
  { to: '/compare', label: 'Compare', icon: Columns2 },
]

const linkClass = ({ isActive }: { isActive: boolean }) =>
  cn(
    'flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13px] font-medium transition-colors',
    isActive
      ? 'bg-accent-muted text-accent'
      : 'text-ink-secondary hover:bg-elevated hover:text-ink'
  )

export default function Sidebar() {
  const { setShowSettingsModal } = useAppContext()

  return (
    <aside className="fixed left-0 top-0 z-20 flex h-screen w-[220px] flex-col border-r border-line-subtle bg-surface">
      <div className="px-4 pb-2 pt-4">
        <div className="text-[15px] font-semibold tracking-tight text-ink">LLM Proxy</div>
        <div className="microlabel mt-0.5">observability</div>
      </div>
      <nav className="flex flex-col gap-0.5 px-2 pt-2">
        {NAV.map(({ to, label, icon: Icon }) => (
          <NavLink key={to} to={to} className={linkClass}>
            <Icon size={15} strokeWidth={1.75} />
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>
      <div className="mt-auto border-t border-line-subtle p-2">
        <button
          type="button"
          className="flex w-full cursor-pointer items-center gap-2.5 rounded-md border-0 bg-transparent px-2.5 py-1.5 text-[13px] font-medium text-ink-secondary transition-colors hover:bg-elevated hover:text-ink"
          onClick={() => setShowSettingsModal(true)}
        >
          <Settings size={15} strokeWidth={1.75} />
          <span>Settings</span>
        </button>
      </div>
    </aside>
  )
}
