// Onboarding wizard — first-run setup flow.
// Steps: Welcome → Server address → Operator name → Test connection → Save & launch.

import { useState, useCallback } from "react";
import { Box, Text, useInput } from "ink";
import TextInput from "ink-text-input";
import type { Config } from "../config";
import { createClient } from "../grpc/client";

type Step = "welcome" | "server" | "operator" | "test" | "complete";

interface OnboardingProps {
  onComplete: (cfg: Config) => void;
  initialConfig?: Partial<Config>;
}

export function Onboarding({ onComplete, initialConfig }: OnboardingProps) {
  const [step, setStep] = useState<Step>("welcome");
  const [server, setServer] = useState(initialConfig?.server ?? "localhost:50051");
  const [operatorId, setOperatorId] = useState(initialConfig?.operatorId ?? "");
  const [testStatus, setTestStatus] = useState<"idle" | "testing" | "success" | "error">("idle");
  const [testMessage, setTestMessage] = useState("");

  const goNext = useCallback(() => {
    const order: Step[] = ["welcome", "server", "operator", "test", "complete"];
    const idx = order.indexOf(step);
    if (idx < order.length - 1) setStep(order[idx + 1]!);
  }, [step]);

  const goPrev = useCallback(() => {
    const order: Step[] = ["welcome", "server", "operator", "test", "complete"];
    const idx = order.indexOf(step);
    if (idx > 0) setStep(order[idx - 1]!);
  }, [step]);

  const runTest = useCallback(async () => {
    setTestStatus("testing");
    setTestMessage("Connecting...");

    const testClient = createClient({ server, operatorId: operatorId || "test" });
    try {
      await testClient.listTools({});
      setTestStatus("success");
      setTestMessage("✓ Connected successfully!");
    } catch (err: any) {
      setTestStatus("error");
      setTestMessage(`✗ Connection failed: ${err.message}`);
    } finally {
      testClient.close();
    }
  }, [server, operatorId]);

  // Global keys
  useInput(
    useCallback(
      (input, key) => {
        if (key.escape) goPrev();
        if (key.return && step === "complete") {
          onComplete({ server, operatorId: operatorId || "operator" });
        } else if (key.return && step !== "test") {
          goNext();
        }
        if (input === " " && step === "test" && testStatus === "idle") runTest();
      },
      [step, testStatus, goPrev, goNext, runTest, server, operatorId, onComplete]
    )
  );

  const renderStep = () => {
    switch (step) {
      case "welcome":
        return (
          <Box flexDirection="column" justifyContent="center" alignItems="center" height="100%">
            <Text bold color="cyan">
              Cambrian CLI
            </Text>
            <Box marginTop={1}>
              <Text dimColor>
                Admin dashboard for the Cambrian multi-agent orchestrator
              </Text>
            </Box>
            <Box marginTop={2} flexDirection="row" gap={1}>
              <Text color="green">[Enter]</Text>
              <Text>Get started</Text>
            </Box>
          </Box>
        );

      case "server":
        return (
          <Box flexDirection="column" justifyContent="center" alignItems="center" height="100%">
            <Text bold color="cyan">Step 1/4: Server Address</Text>
            <Box marginTop={1}>
              <Text dimColor>
                Where is your Cambrian runtime running?
              </Text>
            </Box>
            <Box marginTop={2} width={50}>
              <TextInput
                value={server}
                onChange={setServer}
                placeholder="localhost:50051"
              />
            </Box>
            <Box marginTop={2} flexDirection="row" gap={2}>
              <Text dimColor>[Esc] Back</Text>
              <Text color="green">[Enter] Next</Text>
            </Box>
          </Box>
        );

      case "operator":
        return (
          <Box flexDirection="column" justifyContent="center" alignItems="center" height="100%">
            <Text bold color="cyan">Step 2/4: Your Identity</Text>
            <Box marginTop={1}>
              <Text dimColor>
                What name should appear in approval requests?
              </Text>
            </Box>
            <Box marginTop={2} width={50}>
              <TextInput
                value={operatorId}
                onChange={setOperatorId}
                placeholder="your-name"
              />
            </Box>
            <Box marginTop={2} flexDirection="row" gap={2}>
              <Text dimColor>[Esc] Back</Text>
              <Text color="green">[Enter] Next</Text>
            </Box>
          </Box>
        );

      case "test": {
        const statusColor = testStatus === "success" ? "green" : testStatus === "error" ? "red" : "yellow";
        return (
          <Box flexDirection="column" justifyContent="center" alignItems="center" height="100%">
            <Text bold color="cyan">Step 3/4: Test Connection</Text>
            <Box marginTop={1}>
              <Text dimColor>Testing {server}...</Text>
            </Box>
            <Box marginTop={2}>
              <Text color={statusColor}>{testMessage || "Press Space to test"}</Text>
            </Box>
            <Box marginTop={2} flexDirection="row" gap={2}>
              <Text dimColor>[Esc] Back</Text>
              {testStatus === "idle" && <Text color="yellow">[Space] Test</Text>}
              {testStatus === "success" && <Text color="green">[Enter] Next</Text>}
            </Box>
          </Box>
        );
      }

      case "complete":
        return (
          <Box flexDirection="column" justifyContent="center" alignItems="center" height="100%">
            <Text bold color="green">✓ All Set!</Text>
            <Box marginTop={1}>
              <Text dimColor>
                Configuration saved to ~/.config/cambrian/config.json
              </Text>
            </Box>
            <Box marginTop={2} flexDirection="column" alignItems="flex-start" gap={1}>
              <Text><Text bold>Server:</Text> {server}</Text>
              <Text><Text bold>Operator:</Text> {operatorId}</Text>
            </Box>
            <Box marginTop={2} flexDirection="row" gap={2}>
              <Text dimColor>[Esc] Back</Text>
              <Text color="green">[Enter] Launch Dashboard</Text>
            </Box>
          </Box>
        );
    }
  };

  const stepLabels: Record<Step, string> = {
    welcome: "Welcome",
    server: "Step 1/4",
    operator: "Step 2/4",
    test: "Step 3/4",
    complete: "All Set",
  };

  return (
    <Box flexDirection="column" height="100%" width="100%">
      <Box marginBottom={1} flexDirection="row" justifyContent="space-between">
        <Text color="cyan">Cambrian CLI Setup</Text>
        <Text dimColor>{stepLabels[step]}</Text>
      </Box>
      {renderStep()}
    </Box>
  );
}