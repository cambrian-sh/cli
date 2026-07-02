// 4-pane dashboard with focus management and global keyboard bindings.

import { useState, useCallback, useEffect } from "react";
import { Box, Text, useInput } from "ink";
import type { CambrianClient } from "../grpc/client";
import { StatusBar } from "./StatusBar";
import { ApprovalsPane } from "./ApprovalsPane";
import { ToolsPane } from "./ToolsPane";
import { WatchesPane } from "./WatchesPane";
import { SkillsPane } from "./SkillsPane";

export type PaneId = "approvals" | "tools" | "watches" | "skills";

type ConnStatus = "connected" | "connecting" | "disconnected" | "error";

interface AppProps {
  client: CambrianClient;
  operatorId: string;
}

export function App({ client, operatorId }: AppProps) {
  const [focusedPane, setFocusedPane] = useState<PaneId>("approvals");
  const [connectionStatus, setConnectionStatus] = useState<ConnStatus>("connecting");
  const [showHelp, setShowHelp] = useState(false);
  const [quitting, setQuitting] = useState(false);

  const panes: PaneId[] = ["approvals", "tools", "watches", "skills"];

  useEffect(() => {
    const channel = client.getChannel();
    const cs = channel.getConnectivityState(false);
    if (cs === 0 || cs === 1) { // gRPC IDLE or CONNECTING
      channel.watchConnectivityState(cs, Infinity, (err) => {
        setConnectionStatus(err ? "error" : "connected");
      });
    } else if (cs === 2) { // READY
      setConnectionStatus("connected");
    } else {
      setConnectionStatus("disconnected");
    }
  }, [client]);

  useInput(useCallback((input, key) => {
    if (showHelp) {
      if (input === "?" || key.escape) setShowHelp(false);
      return;
    }
    if (quitting) {
      if (input === "y" || input === "Y") process.exit(0);
      if (input === "n" || input === "N") setQuitting(false);
      return;
    }
    if (key.tab) {
      const idx = panes.indexOf(focusedPane);
      setFocusedPane(panes[(idx + 1) % panes.length]!);
    } else if (input === "1") {
      setFocusedPane("approvals");
    } else if (input === "2") {
      setFocusedPane("tools");
    } else if (input === "3") {
      setFocusedPane("watches");
    } else if (input === "4") {
      setFocusedPane("skills");
    } else if (input === "q" || input === "Q") {
      setQuitting(true);
    } else if (input === "?") {
      setShowHelp(true);
    }
  }, [focusedPane, showHelp, quitting]));

  return (
    <Box flexDirection="column" height="100%">
      {showHelp && <HelpOverlay onClose={() => setShowHelp(false)} />}
      {quitting && (
        <Box paddingX={1}>
          <Text backgroundColor="red" bold color="white">Quit? (y/n)</Text>
        </Box>
      )}

      <Box flexGrow={1} flexDirection="row">
        <Box
          flexBasis="40%"
          borderStyle="round"
          borderColor={
            focusedPane === "approvals" ? "cyan" : "gray"
          }
        >
          <ApprovalsPane
            client={client}
            operatorId={operatorId}
            focused={focusedPane === "approvals"}
            onConnectionChange={setConnectionStatus}
          />
        </Box>

        <Box
          flexBasis="60%" flexDirection="column">
          <Box
            flexGrow={1}
            borderStyle="round"
            borderColor={focusedPane === "tools" ? "cyan" : "gray"}
          >
            <ToolsPane
              client={client}
              focused={focusedPane === "tools"}
            />
          </Box>
          <Box
            flexGrow={1}
            borderStyle="round"
            borderColor={focusedPane === "watches" ? "cyan" : "gray"}
          >
            <WatchesPane
              client={client}
              focused={focusedPane === "watches"}
            />
          </Box>
          <Box
            flexGrow={1}
            borderStyle="round"
            borderColor={focusedPane === "skills" ? "cyan" : "gray"}
          >
            <SkillsPane
              client={client}
              focused={focusedPane === "skills"}
            />
          </Box>
        </Box>
      </Box>

      {/* Status bar */}
      <StatusBar
        connectionStatus={connectionStatus}
        operatorId={operatorId}
        focusedPane={focusedPane}
      />
    </Box>
  );
}

// ── Help overlay ─────────────────────────────────────────────────

function HelpOverlay({ onClose }: { onClose: () => void }) {
  useInput(
    useCallback((_input, key) => {
      if (key.escape) onClose();
    }, [])
  );

  const keys: [string, string][] = [
    ["Tab", "Cycle focus between panes"],
    ["1 2 3 4", "Jump to Approvals / Tools / Watches / Skills"],
    ["↑ ↓", "Navigate items in pane"],
    ["y / n", "Approve / deny tool request"],
    ["Space", "Toggle watch active state"],
    ["d", "Delete selected watch"],
    ["r", "Refresh pane data"],
    ["Enter", "Expand/collapse tool/skill detail"],
    ["q", "Quit with confirmation"],
    ["?", "Toggle this help"],
  ];

  return (
    <Box
      position="absolute"
      width="100%"
      height="100%"
      justifyContent="center"
      alignItems="center"
      flexDirection="column"
    >
      <Box
        flexDirection="column"
        paddingX={3}
        paddingY={1}
        borderStyle="double"
        borderColor="cyan"
        backgroundColor="black"
      >
        <Text bold color="cyan" underline>
          KEYBOARD SHORTCUTS
        </Text>
        {keys.map(([k, desc]) => (
          <Box key={k} gap={2}>
            <Text bold color="yellow">
              {k.padEnd(10)}
            </Text>
            <Text>{desc}</Text>
          </Box>
        ))}
        <Box marginTop={1}>
          <Text dimColor>Press ESC or ? to close</Text>
        </Box>
      </Box>
    </Box>
  );
}
