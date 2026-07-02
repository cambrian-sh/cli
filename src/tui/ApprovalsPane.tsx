// ApprovalsPane: Live stream of dangerous-tool approval requests.

import React, { useState, useEffect, useCallback } from "react";
import { Box, Text, useInput } from "ink";
import type { CambrianClient } from "../grpc/client";
import { openApprovalStream } from "../grpc/streams";
import type * as T from "../cambrian-types";

interface ApprovalsPaneProps {
  client: CambrianClient;
  operatorId: string;
  focused: boolean;
  onConnectionChange: (status: "connected" | "connecting" | "disconnected" | "error") => void;
}

interface ApprovalItem extends T.ApprovalRequest {
  status: "pending" | "approved" | "denied";
}

export function ApprovalsPane({
  client,
  operatorId,
  focused,
  onConnectionChange,
}: ApprovalsPaneProps) {
  const [approvals, setApprovals] = useState<ApprovalItem[]>([]);
  const [selectedIdx, setSelectedIdx] = useState(0);

  // Connect to approval stream
  useEffect(() => {
    const cleanup = openApprovalStream(client, {
      onData: (msg) => {
        setApprovals((prev) => [
          ...prev,
          { ...msg, status: "pending" },
        ]);
      },
      onError: () => onConnectionChange("error"),
      onStateChange: (state) => {
        onConnectionChange(state === "connected" ? "connected" : state === "connecting" ? "connecting" : "disconnected");
        if (state === "connected") onConnectionChange("connected");
      },
    });
    return cleanup;
  }, [client]);

  // Reset selection when list changes
  useEffect(() => {
    if (selectedIdx >= approvals.length) {
      setSelectedIdx(Math.max(0, approvals.length - 1));
    }
  }, [approvals.length]);

  // Keyboard handling
  useInput(
    useCallback(
      (input, key) => {
        if (!focused) return;

        if (key.upArrow) {
          setSelectedIdx((i) => Math.max(0, i - 1));
        } else if (key.downArrow) {
          setSelectedIdx((i) => Math.min(approvals.length - 1, i + 1));
        } else if (input === "y" || input === "Y") {
          const item = approvals[selectedIdx];
          if (item && item.status === "pending") {
            client.submitApprovalDecision({
              id: item.id,
              approve: true,
              approver_id: operatorId,
            }).then((res) => {
              if (res.ok) {
                setApprovals((prev) =>
                  prev.map((a) =>
                    a.id === item.id ? { ...a, status: "approved" } : a
                  )
                );
              }
            });
          }
        } else if (input === "n" || input === "N") {
          const item = approvals[selectedIdx];
          if (item && item.status === "pending") {
            client.submitApprovalDecision({
              id: item.id,
              approve: false,
              approver_id: operatorId,
            }).then((res) => {
              if (res.ok) {
                setApprovals((prev) =>
                  prev.map((a) =>
                    a.id === item.id ? { ...a, status: "denied" } : a
                  )
                );
              }
            });
          }
        }
      },
      [focused, selectedIdx, approvals, client, operatorId]
    )
  );

  // Auto-remove stale items after 30s
  useEffect(() => {
    if (approvals.length === 0) return;
    const timer = setTimeout(() => {
      const cutoff = Date.now() - 30_000;
      setApprovals((prev) => prev.filter((a) => a.status === "pending"));
    }, 30_000);
    return () => clearTimeout(timer);
  }, [approvals]);

  // Approve/deny keyboard hint
  const pendingCount = approvals.filter((a) => a.status === "pending").length;

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Text bold color="cyan">
        APPROVALS LIVE  ({pendingCount} pending)
      </Text>
      <Text dimColor>Pending dangerous-tool approval requests</Text>
      <Box flexGrow={1} flexDirection="column" marginTop={1}>
        {approvals.length === 0 ? (
          <Text dimColor>No pending approvals. Waiting for stream...</Text>
        ) : (
          approvals.map((item, idx) => {
            const sel = selectedIdx === idx && focused;
            return (
              <Box
                key={item.id}
                flexDirection="column"
                paddingX={1}
                backgroundColor={sel ? "cyan" : undefined}
              >
                <Box gap={1}>
                  <Text bold color={sel ? "black" : undefined}>
                    {item.status === "pending"
                      ? "⚠ PENDING"
                      : item.status === "approved"
                      ? "✓ APPROVED"
                      : "✗ DENIED"}{" "}
                    {item.tool_name}
                  </Text>
                </Box>
                <Text dimColor color={sel ? "black" : undefined}>
                  Agent: {item.agent_id}
                </Text>
                <Text dimColor color={sel ? "black" : undefined}>
                  Args: {item.args_preview}
                </Text>
                {sel && item.status === "pending" && (
                  <Text color="green">[y] approve  [n] deny</Text>
                )}
              </Box>
            );
          })
        )}
      </Box>
    </Box>
  );
}
