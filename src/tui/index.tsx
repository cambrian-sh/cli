// TUI entry point. First run → onboarding wizard. Subsequent runs → dashboard.

import React from "react";
import { render } from "ink";
import { loadConfig, saveConfig } from "../config";
import { createClient, CambrianClient } from "../grpc/client";
import { App } from "./App";
import { Onboarding } from "./Onboarding";

export async function launchTui(): Promise<void> {
  const cfg = loadConfig();
  const isFirstRun = !cfg.operatorId || cfg.server === "localhost:50051";

  let client: CambrianClient | null = null;

  const { waitUntilExit } = render(
    <RootShell
      isFirstRun={isFirstRun}
      initialConfig={cfg}
      onOnboardingComplete={(saved) => {
        client = createClient(saved);
      }}
    />
  );

  process.on("exit", () => client?.close());
  process.on("SIGINT", () => { client?.close(); process.exit(0); });

  await waitUntilExit();
}

function RootShell({
  isFirstRun,
  initialConfig,
  onOnboardingComplete,
}: {
  isFirstRun: boolean;
  initialConfig: ReturnType<typeof loadConfig>;
  onOnboardingComplete: (cfg: ReturnType<typeof loadConfig>) => void;
}) {
  const skipOnboarding = isFirstRun && !!process.env.CAMBRIAN_OPERATOR_ID;
  const [stage, setStage] = React.useState<"onboarding" | "dashboard">(
    skipOnboarding || !isFirstRun ? "dashboard" : "onboarding"
  );
  const clientRef = React.useRef<CambrianClient | null>(null);

  React.useEffect(() => {
    if (stage === "dashboard" && !clientRef.current) {
      clientRef.current = createClient(initialConfig);
    }
  }, [stage, initialConfig]);

  const handleComplete = (cfg: ReturnType<typeof loadConfig>) => {
    saveConfig(cfg);
    clientRef.current = createClient(cfg);
    onOnboardingComplete(cfg);
    setStage("dashboard");
  };

  if (stage === "onboarding") {
    return <Onboarding onComplete={handleComplete} initialConfig={initialConfig} />;
  }

  if (!clientRef.current) return null;
  return <App client={clientRef.current} operatorId={initialConfig.operatorId} />;
}
