// SkillsPane: Registry of available system skills with tool grants.

import React, { useState, useEffect, useCallback } from "react";
import { Box, Text, useInput } from "ink";
import type { CambrianClient } from "../grpc/client";
import type * as T from "../cambrian-types";

interface SkillsPaneProps {
  client: CambrianClient;
  focused: boolean;
}

export function SkillsPane({ client, focused }: SkillsPaneProps) {
  const [skills, setSkills] = useState<T.SkillDescriptor[]>([]);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadSkills = useCallback(async () => {
    try {
      const res = await client.listSkills({});
      setSkills(res.skills);
      setError(null);
    } catch (err: any) {
      setError(err.message || "Failed to load skills");
    }
  }, [client]);

  useEffect(() => {
    loadSkills();
    const interval = setInterval(loadSkills, 10_000);
    return () => clearInterval(interval);
  }, [loadSkills]);

  useInput(
    useCallback(
      (input, key) => {
        if (!focused) return;
        if (key.upArrow) {
          setSelectedIdx((i) => Math.max(0, i - 1));
        } else if (key.downArrow) {
          setSelectedIdx((i) => Math.min(skills.length - 1, i + 1));
        } else if (input === "r" || input === "R") {
          loadSkills();
        } else if (key.return) {
          setExpanded((e) => !e);
        }
      },
      [focused, skills.length, loadSkills]
    )
  );

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Text bold color="cyan">
        SKILLS REGISTRY
      </Text>
      <Text dimColor>Available system skills  [r] refresh  [enter] view instructions</Text>
      <Box flexGrow={1} flexDirection="column" marginTop={1}>
        {error ? (
          <Text color="red">Error: {error}</Text>
        ) : skills.length === 0 ? (
          <Text dimColor>Loading skills...</Text>
        ) : (
          skills.map((skill, idx) => {
            const sel = selectedIdx === idx && focused;
            const grants = skill.tool_grants.length;
            return (
              <Box
                key={skill.name}
                flexDirection="column"
                paddingX={1}
                backgroundColor={sel ? "cyan" : undefined}
              >
                <Box gap={1}>
                  <Text bold color={sel ? "black" : undefined}>
                    {skill.name}
                  </Text>
                  {grants > 0 ? (
                    <Text color={sel ? "black" : "yellow"}>
                      {grants} grant{grants === 1 ? "" : "s"}
                    </Text>
                  ) : (
                    <Text dimColor color={sel ? "black" : undefined}>
                      no grants
                    </Text>
                  )}
                </Box>
                <Text dimColor color={sel ? "black" : undefined}>
                  {skill.description}
                </Text>
                {expanded && sel && (
                  <Box marginTop={1} marginBottom={1} flexDirection="column">
                    {skill.tool_grants.length > 0 && (
                      <Text color={sel ? "black" : undefined}>
                        <Text bold>Tool grants:</Text> {skill.tool_grants.join(", ")}
                      </Text>
                    )}
                    <Text dimColor color={sel ? "black" : undefined}>
                      {skill.instructions || "(no instructions)"}
                    </Text>
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