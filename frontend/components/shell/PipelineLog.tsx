"use client"

import { useState } from "react"
import { ObservabilityPanel } from "@/components/shell/ObservabilityPanel"
import { Terminal } from "@/components/shell/Terminal"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { runner } from "@/lib/sim/runner"

export function PipelineLog() {
  const [tab, setTab] = useState("terminal")

  return (
    <div className="flex h-full flex-col gap-2 p-3">
      <div className="flex items-center gap-2">
        <span className="text-[10px] tracking-[0.16em] text-white/50 uppercase">Pipeline log</span>
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
      <Tabs value={tab} onValueChange={setTab} className="min-h-0 flex-1">
        <TabsList variant="line" className="bg-transparent">
          <TabsTrigger value="terminal">Terminal</TabsTrigger>
          <TabsTrigger value="obs">Observability</TabsTrigger>
        </TabsList>
        <TabsContent value="terminal" className="min-h-0">
          <Terminal />
        </TabsContent>
        <TabsContent value="obs" className="min-h-0 overflow-auto">
          <ObservabilityPanel />
        </TabsContent>
      </Tabs>
    </div>
  )
}
