// ToolsPane: Registry of available system tools with dangerous flags.

import React, { useState, useEffect, useCallback } from "react";
import { Box, Text, useInput } from "ink";
import type { CambrianClient } from "../grpc/client";
import type * as T from "../cambrian-types";

interface ToolsPaneProps {
  client: CambrianClient;
  focused: boolean;
}

export function ToolsPane({ client, focused }: ToolsPaneProps) {
  const [tools, setTools] = useState<T.ToolDescriptor[]>([]);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadTools = useCallback(async () => {
    try {
      const res = await client.listTools({});
      setTools(res.tools);
      setError(null);
    } catch (err: any) {
      setError(err.message || "Failed to load tools");
    }
  }, [client]);

  useEffect(() => {
    loadTools();
    const interval = setInterval(loadTools, 10_000);
    return () => clearInterval(interval);
  }, [loadTools]);

  useInput(
    useCallback(
      (input, key) => {
        if (!focused) return;
        if (key.upArrow) {
          setSelectedIdx((i) => Math.max(0, i - 1));
        } else if (key.downArrow) {
          setSelectedIdx((i) => Math.min(tools.length - 1, i + 1));
        } else if (input === "r" || input === "R") {
          loadTools();
        } else if (key.return) {
          setExpanded((e) => !e);
        }
      },
      [focused, tools.length, loadTools]
    )
  );

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Text bold color="magenta">
        TOOLS REGISTRY
      </Text>
      <Text dimColor>Available system tools  [r] refresh  [enter] view schema</Text>
      <Box flexGrow={1} flexDirection="column" marginTop={1}>
        {error ? (
          <Text color="red">Error: {error}</Text>
        ) : tools.length === 0 ? (
          <Text dimColor>Loading tools...</Text>
        ) : (
          tools.map((tool, idx) => {
            const sel = selectedIdx === idx && focused;
            return (
              <Box
                key={tool.name}
                flexDirection="column"
                paddingX={1}
                backgroundColor={sel ? "magenta" : undefined}
              >
                <Box gap={1}>
                  <Text bold color={sel ? "black" : undefined}>
                    {tool.name}
                  </Text>
                  <Text
                    color={tool.dangerous ? "yellow" : "green"}
                  >
                    {tool.dangerous ? "⚠ DANGEROUS" : "✓ safe"}
                  </Text>
                </Box>
                <Text dimColor color={sel ? "black" : undefined}>
                  {tool.description}
                </Text>
                {expanded && sel && (
                  <Box marginTop={1} marginBottom={1}>
                    <Text dimColor>{tool.schema_json}</Text>
                  </Box>
                )}
              </Box>
            );
          })
        )}
      </Box>
    </Box>
  );
}
