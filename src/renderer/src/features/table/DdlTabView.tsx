// CREATE statement of a table, view, routine, trigger or event.
import { useQuery } from '@tanstack/react-query'
import { Copy, FileCode } from 'lucide-react'
import { api, errorMessage } from '../../lib/bridge'
import { SqlEditor } from '../../components/SqlEditor'
import { Button, ErrorBox, Spinner } from '../../components/ui'
import { openQueryTab, useApp, type DdlTab } from '../../store'

export function DdlView({ database, name, kind }: { database: string; name: string; kind: DdlTab['objectKind'] }) {
  const session = useApp((s) => s.session)!
  const sessionId = session.info.sessionId
  const { data, error, isLoading } = useQuery({
    queryKey: ['ddl', sessionId, database, name, kind],
    queryFn: () => api.schema.createStatement({ sessionId, database, name, kind }),
    staleTime: 0
  })

  if (isLoading) return <Spinner className="m-6" />
  if (error)
    return (
      <div className="p-4">
        <ErrorBox>{errorMessage(error)}</ErrorBox>
      </div>
    )

  const editable = ['procedure', 'function', 'trigger', 'event', 'view'].includes(kind)
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-3">
        <Button size="sm" icon={<Copy className="size-3.5" />} onClick={() => void navigator.clipboard.writeText(data ?? '')}>
          Copy
        </Button>
        {editable && (
          <Button
            size="sm"
            icon={<FileCode className="size-3.5" />}
            onClick={() =>
              openQueryTab({
                database,
                title: `Edit ${name}`,
                // Routines are replaced by DROP + CREATE, wrapped in DELIMITER for the splitter.
                sql:
                  kind === 'view'
                    ? `${(data ?? '').replace(/^CREATE\s+/i, 'CREATE OR REPLACE ')};`
                    : `DELIMITER ;;\nDROP ${kind.toUpperCase()} IF EXISTS \`${name.replace(/`/g, '``')}\`;;\n${data};;\nDELIMITER ;\n`
              })
            }
          >
            Edit in a query tab
          </Button>
        )}
      </div>
      <div className="min-h-0 flex-1">
        <SqlEditor value={data ?? ''} readOnly />
      </div>
    </div>
  )
}

export function DdlTabView({ tab }: { tab: DdlTab }) {
  return <DdlView database={tab.database} name={tab.name} kind={tab.objectKind} />
}
