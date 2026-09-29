// Vertical icon bar on the far left: sidebar views and global actions.
import { Activity, Bookmark, Database, History, Moon, Settings, Sun, SquarePen } from 'lucide-react'
import { useState } from 'react'
import { IconButton } from '../../components/ui'
import { openQueryTab, openTab, setTheme, useApp, type SidebarView } from '../../store'
import { SettingsDialog } from './SettingsDialog'

export function ActivityRail() {
  const session = useApp((s) => s.session)
  const sidebarView = useApp((s) => s.sidebarView)
  const theme = useApp((s) => s.theme)
  const [settings, setSettings] = useState(false)

  const view = (id: SidebarView, label: string, icon: React.ReactNode) => (
    <IconButton
      label={label}
      active={sidebarView === id}
      disabled={!session}
      onClick={() => useApp.setState({ sidebarView: id })}
      className="size-9"
    >
      {icon}
    </IconButton>
  )

  return (
    <div className="flex w-12 shrink-0 flex-col items-center gap-1 border-r border-border bg-panel py-2">
      {view('explorer', 'Explorer', <Database className="size-[18px]" />)}
      {view('saved', 'Saved queries', <Bookmark className="size-[18px]" />)}
      {view('history', 'History', <History className="size-[18px]" />)}
      <div className="my-1 h-px w-6 bg-border" />
      <IconButton label="New query (Ctrl+T)" disabled={!session} onClick={() => openQueryTab()} className="size-9">
        <SquarePen className="size-[18px]" />
      </IconButton>
      <IconButton
        label="Server"
        disabled={!session}
        onClick={() => openTab({ kind: 'admin', section: 'processes' })}
        className="size-9"
      >
        <Activity className="size-[18px]" />
      </IconButton>
      <div className="flex-1" />
      <IconButton
        label={theme === 'dark' ? 'Light theme' : 'Dark theme'}
        onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
        className="size-9"
      >
        {theme === 'dark' ? <Sun className="size-[18px]" /> : <Moon className="size-[18px]" />}
      </IconButton>
      <IconButton label="Settings" onClick={() => setSettings(true)} className="size-9">
        <Settings className="size-[18px]" />
      </IconButton>
      <SettingsDialog open={settings} onOpenChange={setSettings} />
    </div>
  )
}
