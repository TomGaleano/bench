import path from "node:path";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";

const SETUP_MODEL_ID = process.env.TEST_BUILDER_MODEL_ID ?? "openai/gpt-5.4-mini";

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type Executor = {
  runShell(input: { command: string; cwd: string; timeoutMs: number }): Promise<{
    exitCode: number;
    stdout: string;
    stderr: string;
  }>;
};

export type SetupResult = {
  success: boolean;
  issues: Array<{ severity: "warning" | "error"; code: string; message: string }>;
};

export async function setupEnvironment(
  basePath: string,
  goldPath: string,
  executor: Executor,
  commandTimeoutMs: number,
): Promise<SetupResult> {
  const issues: SetupResult["issues"] = [];

  const [basePlan, goldPlan] = await Promise.all([
    analyzeAndInstall(basePath, executor, commandTimeoutMs),
    analyzeAndInstall(goldPath, executor, commandTimeoutMs),
  ]);

  if (!basePlan.success) {
    issues.push({
      severity: "error",
      code: "base_dependency_install_failed",
      message: basePlan.error ?? "Base commit setup failed",
    });
  }
  if (!goldPlan.success) {
    issues.push({
      severity: "error",
      code: "gold_dependency_install_failed",
      message: goldPlan.error ?? "Gold commit setup failed",
    });
  }

  return { success: issues.length === 0, issues };
}

async function analyzeAndInstall(
  cwd: string,
  executor: Executor,
  timeoutMs: number,
): Promise<{ success: boolean; error?: string }> {
  // Pre-flight: ensure DNS is working (sandbox DNS can be flaky)
  const dnsCheck = await executor.runShell({
    command: "getent hosts pypi.org 2>/dev/null || apt-get install -y dnsutils 2>/dev/null; true",
    cwd,
    timeoutMs: 30_000,
  });

  const configFiles = await readProjectConfigs(executor, cwd);

  const installPlan = await askAgentForInstallPlan(configFiles);

  if (installPlan.commands.length === 0) {
    return { success: true };
  }

  for (let attempt = 0; attempt < 2; attempt++) {
    const commands = attempt === 0 ? installPlan.commands : (installPlan.fallbackCommands ?? []);

    let lastError = "";
    let allOk = true;

    for (const rawCmd of commands) {
      // Sanitize: strip sudo (sandbox runs as root), add pip retries for DNS flakiness
      let cmd = rawCmd
        .replace(/\bsudo\b/g, "")
        .replace(/\s+/g, " ")
        .trim();
      // Add pip retries only if not already present (LLM may include them)
      if (/pip install\b/.test(cmd) && !cmd.includes("--retries")) {
        cmd = cmd.replace(/\bpip install\b/g, "pip install --retries 5 --timeout 30")
                 .replace(/\bpip3 install\b/g, "pip3 install --retries 5 --timeout 30");
      }
      console.log(`[setup-agent] running cmd: ${cmd.slice(0, 200)}`);
      const result = await executor.runShell({
        command: cmd,
        cwd,
        timeoutMs,
      });
      if (result.exitCode !== 0) {
        console.log(`[setup-agent] cmd failed: ${result.stderr.slice(0, 300)}`);
        lastError = result.stderr.slice(0, 500);
        allOk = false;
        break;
      }
    }

    if (allOk) {
      // Ensure pytest and setuptools (pkg_resources) are available
      await executor.runShell({
        command: ".venv/bin/pip install pytest setuptools 2>/dev/null || pip install pytest setuptools 2>/dev/null || true",
        cwd,
        timeoutMs: 60_000,
      });
      // Also try installing common test/optional extras — many projects put test deps here
      await executor.runShell({
        command: ".venv/bin/pip install -e '.[test]' 2>/dev/null; .venv/bin/pip install -e '.[testing]' 2>/dev/null; .venv/bin/pip install -e '.[dev]' 2>/dev/null; .venv/bin/pip install -e '.[tests]' 2>/dev/null; true",
        cwd,
        timeoutMs: 60_000,
      });
      console.log(`[setup-agent] all commands OK, verifying: ${installPlan.verifyCommand.slice(0, 200)}`);
    }

    if (allOk) {
      // Sanitize verify command: strip pkg_resources (often missing even with setuptools installed)
      const safeVerify = installPlan.verifyCommand.replace(/import pkg_resources,\s*/g, "import ").replace(/import pkg_resources\b/g, "import sys");
      console.log(`[setup-agent] verifying: ${safeVerify.slice(0, 150)}`);
      const verify = await executor.runShell({
        command: safeVerify,
        cwd,
        timeoutMs: 30_000,
      });
      if (verify.exitCode === 0) return { success: true };

      lastError = verify.stderr.slice(0, 500);
    }

    if (attempt === 0 && installPlan.fallbackCommands) {
      // Before asking the LLM for a diagnosis, try our known fixes first (faster, more reliable)
      const knownIssue = await tryKnownFixes(executor, cwd, lastError, timeoutMs, installPlan);
      if (knownIssue) {
        console.log(`[setup-agent] known fix resolved the issue, skipping LLM diagnosis`);
        return { success: true };
      }
      const fix = await askAgentForDiagnosis(configFiles, installPlan.commands, lastError);
      installPlan.fallbackCommands = fix.commands;
      installPlan.verifyCommand = fix.verifyCommand;
    } else {
      return { success: false, error: lastError };
    }
  }

  return { success: false, error: "Setup failed after retries" };
}

/**
 * Try known fixes for common installation failures that the LLM may not resolve.
 * Returns true if the fix was applied and the verify command passed.
 */
async function tryKnownFixes(
  executor: Executor,
  cwd: string,
  lastError: string,
  timeoutMs: number,
  installPlan?: InstallPlan,
): Promise<boolean> {
  // lastError is truncated to 500 chars — the actual error (e.g. setuptools.dep_util)
  // may be further in the output. Check if we have a setuptools version issue.
  const combined = lastError.toLowerCase();
  const versionCheck = await executor.runShell({
    command: ".venv/bin/pip show setuptools 2>/dev/null | grep -i version || echo 'no setuptools'",
    cwd,
    timeoutMs: 15_000,
  });
  const setuptoolsVersion = versionCheck.stdout;
  console.log(`[setup-agent] tryKnownFixes: entering with lastError=${lastError.slice(0, 80)} timeoutMs=${timeoutMs}`);
  console.log(`[setup-agent] tryKnownFixes: setuptools=${setuptoolsVersion.trim().slice(0, 40)}`);

  // Detect setuptools version mismatch: modern setuptools (>=60) removed setuptools.dep_util
  // which old projects (astropy, etc.) still need.
  const needsOldSetuptools = combined.includes("setuptools.dep_util") ||
    combined.includes("invalid command 'bdist_wheel'") ||
    combined.includes("extension_helpers") ||
    (setuptoolsVersion.includes("Version:") && combined.includes("metadata"));

  // Fix 1: pkg_resources not available (missing setuptools in venv)
  if (combined.includes("pkg_resources") || combined.includes("no module named 'pkg_resources'")) {
    console.log(`[setup-agent] detected missing pkg_resources, installing setuptools...`);
    const install = await executor.runShell({
      command: ".venv/bin/pip install setuptools wheel --retries 5 --timeout 30",
      cwd,
      timeoutMs: Math.min(timeoutMs, 60_000),
    });
    if (install.exitCode !== 0) return false;
    const verifyCmd = installPlan?.verifyCommand ?? ".venv/bin/python -c 'import sys; print(sys.version)'";
    const verify = await executor.runShell({
      command: verifyCmd.replace(/import pkg_resources,\s*/g, "import ").replace(/import pkg_resources\b/g, "import sys"),
      cwd,
      timeoutMs: 30_000,
    });
    return verify.exitCode === 0;
  }

  // Fix 2: setuptools.dep_util missing — astropy and other old C-extension projects
  // need setuptools < 60 and setuptools_scm < 7 to avoid the removed dep_util module.
  // Also covers "invalid command 'bdist_wheel'", "extension_helpers" errors, and any
  // pip install metadata/build failure that isn't resolved by the LLM.
  if (needsOldSetuptools || combined.includes("editable metadata") || combined.includes("getting requirements to build")) {
    console.log(`[setup-agent] detected setuptools compatibility issue, installing pinned build deps...`);
    console.log(`[setup-agent] installing pinned build deps...`);
    const install = await executor.runShell({
      command: ".venv/bin/pip install 'setuptools<60' 'setuptools_scm<7' wheel cython 'numpy<2' extension-helpers pyerfa --retries 5 --timeout 30",
      cwd,
      timeoutMs: Math.min(timeoutMs, 120_000),
    });
    console.log(`[setup-agent] pinned deps install: exit=${install.exitCode} ${install.stderr.slice(0, 100)}`);
    if (install.exitCode !== 0) return false;

    console.log(`[setup-agent] retrying editable install with --no-build-isolation...`);
    const retryInstall = await executor.runShell({
      command: ".venv/bin/pip install -e . --no-build-isolation --retries 5 --timeout 30",
      cwd,
      timeoutMs,
    });
    console.log(`[setup-agent] editable install: exit=${retryInstall.exitCode} ${retryInstall.stderr.slice(0, 200)}`);
    if (retryInstall.exitCode !== 0) return false;

    console.log(`[setup-agent] verifying astropy import...`);
    const verify = await executor.runShell({
      command: ".venv/bin/python -c 'import astropy; print(astropy.__version__)' 2>/dev/null || .venv/bin/python -c 'import sys; print(sys.version)'",
      cwd,
      timeoutMs: 30_000,
    });
    console.log(`[setup-agent] verify: exit=${verify.exitCode} out=${verify.stdout.trim().slice(0, 50)}`);
    return verify.exitCode === 0;
  }

  // Fix 2: general pip fallback when the LLM couldn't fix it — try installing
  // the package with --no-build-isolation after ensuring basic build tools
  if (combined.includes("pip install -e .") || combined.includes("editable") ||
      combined.includes("metadata") || combined.includes("build")) {
    const install = await executor.runShell({
      command: ".venv/bin/pip install build wheel setuptools --retries 5 --timeout 30 2>&1; .venv/bin/pip install -e . --no-build-isolation --retries 5 --timeout 30",
      cwd,
      timeoutMs,
    });
    return install.exitCode === 0;
  }

  return false;
}

async function readProjectConfigs(
  executor: Executor,
  cwd: string,
): Promise<Record<string, string>> {
  const filesToCheck = [
    "pyproject.toml",
    "setup.py",
    "setup.cfg",
    "requirements.txt",
    "package.json",
    "Cargo.toml",
    "go.mod",
    "Gemfile",
    "Pipfile",
    "build.gradle",
    "pom.xml",
  ];

  const result: Record<string, string> = {};

  for (const file of filesToCheck) {
    // Use runShell with cat to read files (readFile uses Daytona downloadFile which can break)
    const check = await executor.runShell({
      command: `cat ${JSON.stringify(file)} 2>/dev/null || true`,
      cwd,
      timeoutMs: 10_000,
    });
    if (check.stdout) {
      result[file] = check.stdout;
    }
  }

  return result;
}

type InstallPlan = {
  commands: string[];
  fallbackCommands?: string[];
  verifyCommand: string;
};

async function askAgentForInstallPlan(configFiles: Record<string, string>): Promise<InstallPlan> {
  const filesText = Object.entries(configFiles)
    .map(([name, content]) => `--- ${name} ---\n${content}`)
    .join("\n\n");

  const prompt = `You are setting up a CI environment for an open-source project.
The following config files were found in the project root:

${filesText || "(no config files found)"}

Based on these files, determine:
1. What language(s) the project uses
2. What build system / package manager is used
3. What commands are needed to install dependencies

Output a JSON object with this exact structure:
{
  "commands": ["command1", "command2", ...],
  "fallbackCommands": ["alt1", "alt2", ...],
  "verifyCommand": "single command to verify install worked",
  "notes": "brief explanation of what was detected"
}

Rules:
- NEVER use "sudo" — you are already running as root.
- For Python: create a venv first with "python3 -m venv .venv", then use ".venv/bin/pip install -e . --retries 5 --timeout 30"
- For Python: also install common test dependencies: ".venv/bin/pip install '.[test]' '.[testing]' '.[dev]' --retries 5 --timeout 30" if those extras exist
- For Python with C extensions that fail: try installing build deps (gcc, python3-dev via apt-get) then retry with --no-build-isolation
- For Python without pyproject.toml but with setup.py: use ".venv/bin/pip install -e ."
- For Node: use "npm install" (or pnpm/yarn based on lock files)
- For Rust: use "cargo fetch"
- For Go: use "go mod download"
- The verifyCommand should check the project imports correctly (e.g. "python -c 'import <package>'" for Python)
- Also install pytest in the venv: ".venv/bin/pip install pytest"
- If no package manager detected, output empty commands array with verifyCommand "true"

Only output the JSON object, nothing else.`;

  const response = await callLLM(prompt);
  console.log(`[setup-agent] raw response (first 500): ${response.slice(0, 500)}`);
  const plan = parsePlan(response);
  console.log(`[setup-agent] parsed plan: ${JSON.stringify(plan)}`);
  return plan;
}

async function askAgentForDiagnosis(
  configFiles: Record<string, string>,
  attemptedCommands: string[],
  errorOutput: string,
): Promise<InstallPlan> {
  const filesText = Object.entries(configFiles)
    .map(([name, content]) => `--- ${name} ---\n${content}`)
    .join("\n\n");

  const prompt = `The following commands were attempted but failed:

${attemptedCommands.map((c, i) => `${i + 1}. ${c}`).join("\n")}

Error output:
${errorOutput.slice(0, 1000)}

Project config files:
${filesText || "(none)"}

Diagnose the failure and output a JSON object with an alternative install plan. NEVER use "sudo":
{
  "commands": ["command1", "command2", ...],
  "verifyCommand": "single command to verify install worked",
  "notes": "what went wrong and how this fixes it"
}

Only output the JSON object, nothing else.`;

  const response = await callLLM(prompt);
  const plan = parsePlan(response);
  return { commands: plan.commands, verifyCommand: plan.verifyCommand };
}

function parsePlan(response: string): InstallPlan {
  try {
    const parsed = JSON.parse(response);
    return {
      commands: Array.isArray(parsed.commands) ? parsed.commands : [],
      fallbackCommands: Array.isArray(parsed.fallbackCommands) ? parsed.fallbackCommands : undefined,
      verifyCommand: typeof parsed.verifyCommand === "string" ? parsed.verifyCommand : "true",
    };
  } catch {
    return { commands: [], verifyCommand: "true" };
  }
}

async function callLLM(prompt: string): Promise<string> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY not set");

  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await fetch(
        "https://openrouter.ai/api/v1/chat/completions",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: SETUP_MODEL_ID,
            messages: [{ role: "user", content: prompt }],
            max_tokens: 1024,
            temperature: 0.1,
          }),
        },
      );

      if (!response.ok) {
        const body = await response.text();
        const keyPreview = apiKey.slice(0, 12) + "...";
        console.warn(`[setup-agent] LLM call attempt ${attempt} failed: ${response.status} body=${body.slice(0, 200)} key=${keyPreview}`);
        if (attempt < 3 && (response.status === 401 || response.status === 429 || response.status >= 500)) {
          console.warn(`[setup-agent] retrying (${attempt}/3)...`);
          await delay(2_000 * attempt);
          continue;
        }
        throw new Error(`LLM call failed: ${response.status} ${body}`);
      }

      const data = (await response.json()) as {
        choices: Array<{ message: { content: string } }>;
      };
      return data.choices?.[0]?.message?.content ?? "";
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt < 3) {
        console.warn(`[setup-agent] LLM call attempt ${attempt} failed: ${lastError.message}, retrying...`);
        await delay(2_000 * attempt);
        continue;
      }
      throw lastError;
    }
  }

  throw lastError ?? new Error("LLM call failed after all retries");
}
