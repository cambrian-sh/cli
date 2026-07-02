import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

export interface ResolveReasonOptions {
  required: boolean;
  reasonFlag?: string;
}

export async function resolveReason(
  args: string[],
  opts: ResolveReasonOptions
): Promise<string> {
  const idx = args.indexOf("--reason");
  if (idx >= 0 && idx + 1 < args.length) {
    return args[idx + 1] ?? "";
  }
  if (opts.reasonFlag) {
    return opts.reasonFlag;
  }
  if (!opts.required) {
    return "";
  }
  if (!stdout.isTTY) {
    throw new Error(
      "--reason is required for this command. Pass --reason \"<your justification>\"."
    );
  }
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    const answer = await rl.question("Reason: ");
    return answer.trim();
  } finally {
    rl.close();
  }
}
