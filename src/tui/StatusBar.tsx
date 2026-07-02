import { Box, Text } from "ink";
import type { PaneId } from "./App";

interface StatusBarProps {
  connectionStatus: "connected" | "connecting" | "disconnected" | "error";
  operatorId: string;
  focusedPane: PaneId;
}

export function StatusBar({ connectionStatus, operatorId, focusedPane }: StatusBarProps) {
  const dotColor = (() => {
    switch (connectionStatus) {
      case "connected":
        return "green";
      case "connecting":
        return "yellow";
      case "error":
        return "red";
      default:
        return "gray";
    }
  })();

  const dotLabel = (() => {
    switch (connectionStatus) {
      case "connected":
        return "Connected";
      case "connecting":
        return "Connecting";
      case "error":
        return "Error";
      default:
        return "Disconnected";
    }
  })();

  return (
    <Box
      borderStyle="single"
      borderTop={true}
      paddingX={1}
      paddingY={0}
      justifyContent="space-between"
    >
      <Box gap={2}>
        <Box gap={1}>
          <Text color={dotColor}>●</Text>
          <Text>{dotLabel}</Text>
        </Box>
        <Text dimColor>Operator: {operatorId}</Text>
      </Box>
      <Box gap={2}>
        <Text dimColor>
          Focus: {focusedPane.charAt(0).toUpperCase() + focusedPane.slice(1)}
        </Text>
        <Text dimColor>[Tab] Cycle</Text>
        <Text dimColor>[1-3] Jump</Text>
        <Text dimColor>[q] Quit</Text>
      </Box>
    </Box>
  );
}
