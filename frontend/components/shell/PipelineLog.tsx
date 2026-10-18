"use client"

import { useState } from "react"
import { BackendPanel } from "@/components/shell/BackendPanel"
import { Terminal } from "@/components/shell/Terminal"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { runner } from "@/lib/sim/runner"

/** `compact`: the log is collapsed to a strip with just the tabs; picking one calls `onExpand`. */
export function PipelineLog({ compact = false, onExpand }: { compact?: boolean; onExpand?: () => void }) {
  const [tab, setTab] = useState("terminal")

  if (compact) {
    return (
      <div className="px-3 py-2">
        <Tabs
          value={tab}
          onValueChange={setTab}
        >
          <TabsList variant="line" className="bg-transparent">
            <TabsTrigger value="terminal" onClick={() => onExpand?.()}>Terminal</TabsTrigger>
            <TabsTrigger value="backend" onClick={() => onExpand?.()}>Backend</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col px-3 py-2">
      <Tabs value={tab} onValueChange={setTab} className="min-h-0 flex-1 gap-1">
        <div className="flex items-center gap-2">
          <TabsList variant="line" className="bg-transparent">
            <TabsTrigger value="terminal">Terminal</TabsTrigger>
            <TabsTrigger value="backend">Backend</TabsTrigger>
          </TabsList>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="ml-auto text-foreground"
            title="Empties the bag and wishlist, closes checkout, and clears this log."
            onClick={() => runner.reset()}
          >
            Clear session
          </Button>
        </div>
        <TabsContent value="terminal" className="min-h-0">
          <Terminal />
        </TabsContent>
        <TabsContent value="backend" className="min-h-0 overflow-auto">
          <BackendPanel />
        </TabsContent>
      </Tabs>
    </div>
  )
}
