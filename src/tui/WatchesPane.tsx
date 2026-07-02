// WatchesPane: CRUD for reactive watch configurations.

import React, { useState, useEffect, useCallback } from "react";
import { Box, Text, useInput } from "ink";
import type { CambrianClient } from "../grpc/client";
import type * as T from "../cambrian-types";

interface WatchesPaneProps {
  client: CambrianClient;
  focused: boolean;
}

export function WatchesPane({ client, focused }: WatchesPaneProps) {
  const [watches, setWatches] = useState<T.WatchConfigProto[]>([]);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const loadWatches = useCallback(async () => {
    try {
      const res = await client.listWatches({});
      setWatches(res.configs);
      setError(null);
    } catch (err: any) {
      setError(err.message || "Failed to load watches");
    }
  }, [client]);

  useEffect(() => {
    loadWatches();
    const interval = setInterval(loadWatches, 10_000);
    return () => clearInterval(interval);
  }, [loadWatches]);

  const selectedWatch = watches[selectedIdx];

  useInput(
    useCallback(
      (input, key) => {
        if (!focused) return;

        if (key.upArrow) {
          setSelectedIdx((i) => Math.max(0, i - 1));
        } else if (key.downArrow) {
          setSelectedIdx((i) => Math.min(watches.length - 1, i + 1));
        } else if (input === " ") {
          // Toggle active
          const watch = watches[selectedIdx];
          if (watch) {
            client
              .setWatchActive({ id: watch.id, active: !watch.active })
              .then(() => loadWatches());
          }
        } else if (input === "d" || input === "D") {
          const watch = watches[selectedIdx];
          if (watch) {
            client.deleteWatch({ id: watch.id }).then(() => loadWatches());
          }
        } else if (input === "r" || input === "R") {
          loadWatches();
        }
      },
      [focused, selectedIdx, watches, client, loadWatches]
    )
  );

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Text bold color="yellow">
        WATCHES
      </Text>
      <Text dimColor>
        Reactive watch configs  [space] toggle  [d] delete  [r] refresh
      </Text>
      <Box flexGrow={1} flexDirection="column" marginTop={1}>
        {error ? (
          <Text color="red">Error: {error}</Text>
        ) : watches.length === 0 ? (
          <Text dimColor>No watches registered.</Text>
        ) : (
          watches.map((watch, idx) => {
            const sel = selectedIdx === idx && focused;
            return (
              <Box
                key={watch.id}
                flexDirection="column"
                paddingX={1}
                backgroundColor={sel ? "yellow" : undefined}
              >
                <Box gap={1}>
                  <Text bold color={sel ? "black" : undefined}>
                    {watch.active ? "●" : "○"} {watch.name || watch.id}
                  </Text>
                  <Text dimColor color={sel ? "black" : undefined}>
                    {watch.source_type || "-"}
                  </Text>
                </Box>
                <Text dimColor color={sel ? "black" : undefined}>
                  Action: {watch.action?.type ?? "-"}  |  Condition:{" "}
                  {watch.condition_type ?? "-"}
                </Text>
              </Box>
            );
          })
        )}
      </Box>
    </Box>
  );
}
