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

    const seenCmds = new Set<string>();
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
      // Belt-and-suspenders: skip frontend builds even if the LLM ignored the
      // "Python tests only" rule in the prompt. Repos like HKUDS/nanobot ship a
      // `webui/` Next.js app alongside Python source; `npm ci` + `next build`
      // OOMs the small E2B sandbox and the retry loop just burns wall-clock.
      if (isFrontendBuildCommand(cmd)) {
        console.log(`[setup-agent] skipping frontend-build command (Python tests don't need it): ${cmd.slice(0, 200)}`);
        continue;
      }
      // Refuse to re-run the exact same command twice in the same attempt — if
      // it failed once it will fail again, and any retry should come from the
      // diagnosis LLM with a different plan.
      if (seenCmds.has(cmd)) {
        console.log(`[setup-agent] skipping duplicate command: ${cmd.slice(0, 200)}`);
        continue;
      }
      seenCmds.add(cmd);
      console.log(`[setup-agent] running cmd: ${cmd.slice(0, 200)}`);
      const result = await executor.runShell({
        command: cmd,
        cwd,
        timeoutMs,
      });
      if (result.exitCode !== 0) {
        const oom = isOomFailure(result);
        console.log(
          `[setup-agent] cmd failed${oom ? " (OOM)" : ""}: exit=${result.exitCode} ${result.stderr.slice(0, 300)}`,
        );
        lastError = oom
          ? `out_of_memory: '${cmd.slice(0, 80)}' killed by OS (exit ${result.exitCode}). ` +
            `Skip this command — the sandbox cannot allocate enough memory for it.`
          : result.stderr.slice(0, 500);
        allOk = false;
        // On OOM, do not retry the same plan — abort this attempt immediately
        // so the diagnosis LLM gets a real signal instead of grinding the same
        // command three more times.
        if (oom) return { success: false, error: lastError };
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

    console.log(`[setup-agent] retrying install with setup.py develop (old setuptools doesn't support pip install -e)...`);
    const retryInstall = await executor.runShell({
      // Old setuptools (<60) doesn't support PEP 660 build_editable hook, so use setup.py develop
      command: ".venv/bin/python setup.py develop 2>&1",
      cwd,
      timeoutMs,
    });
    console.log(`[setup-agent] setup.py develop: exit=${retryInstall.exitCode} ${retryInstall.stderr.slice(0, 200)}`);
    // If setup.py develop also fails, try building extensions in-place
    if (retryInstall.exitCode !== 0) {
      const buildResult = await executor.runShell({
        command: ".venv/bin/python setup.py build_ext --inplace 2>&1",
        cwd,
        timeoutMs,
      });
      console.log(`[setup-agent] build_ext --inplace: exit=${buildResult.exitCode}`);
      if (buildResult.exitCode !== 0) return false;
    }

    console.log(`[setup-agent] verifying astropy import...`);
    const verify = await executor.runShell({
      command: ".venv/bin/python -c 'import astropy; print(astropy.__version__)' 2>/dev/null || .venv/bin/python -c 'import sys; print(sys.version)'",
      cwd,
      timeoutMs: 30_000,
    });
    console.log(`[setup-agent] verify: exit=${verify.exitCode} out=${verify.stdout.trim().slice(0, 50)}`);
    if (verify.exitCode !== 0) return false;

    // Ensure pytest is available (post-install step was skipped because the LLM's commands failed)
    await executor.runShell({
      command: ".venv/bin/pip install pytest 2>/dev/null || true",
      cwd,
      timeoutMs: 60_000,
    });
    return true;
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

  const prompt = `You are setting up a CI environment so a Python test suite can be executed against a project.
The following config files were found in the project root:

${filesText || "(no config files found)"}

Based on these files, determine:
1. The Python install commands needed to run pytest against this project
2. A verifyCommand that confirms the project imports correctly

Output a JSON object with this exact structure:
{
  "commands": ["command1", "command2", ...],
  "fallbackCommands": ["alt1", "alt2", ...],
  "verifyCommand": "single command to verify install worked",
  "notes": "brief explanation of what was detected"
}

HARD RULES — violations make the validation fail:
- NEVER use "sudo" — you are already running as root.
- NEVER install or build Node.js / npm / pnpm / yarn dependencies. Many Python
  repos ship a frontend (e.g. \`webui/\`, \`web/\`, \`frontend/\`, \`ui/\`) alongside
  the Python source. The Python tests do NOT need that frontend built. The
  sandbox is memory-constrained and \`npm ci\` / \`next build\` reliably OOMs.
  IGNORE every \`package.json\` you see.
- NEVER run any of: \`npm install\`, \`npm ci\`, \`npm run build\`, \`yarn\`,
  \`yarn install\`, \`yarn build\`, \`pnpm install\`, \`pnpm build\`,
  \`next build\`, \`vite build\`, \`webpack\`, \`tsc -b\`, \`tsc --build\`.
- If the project has NO Python config (no \`pyproject.toml\`, no \`setup.py\`,
  no \`setup.cfg\`, no \`requirements.txt\`), output empty \`commands\` and
  \`verifyCommand: "true"\` — the validation will gracefully fail.

PYTHON RULES:
- Create a venv first: "python3 -m venv .venv"
- Install editable: ".venv/bin/pip install -e . --retries 5 --timeout 30"
- Install test extras when likely available: ".venv/bin/pip install '.[test]' '.[testing]' '.[dev]' --retries 5 --timeout 30"
- For C extensions that fail: install build deps (gcc, python3-dev via apt-get) then retry with --no-build-isolation
- Without pyproject.toml but with setup.py: ".venv/bin/pip install -e ."
- Always install pytest in the venv: ".venv/bin/pip install pytest"
- verifyCommand should check the project imports (e.g. ".venv/bin/python -c 'import <pkg>; print(<pkg>.__version__)'")

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

Diagnose the failure and output a JSON object with an ALTERNATIVE install plan
(do not repeat commands from the list above — they already failed).

HARD RULES:
- NEVER use "sudo".
- NEVER include npm / pnpm / yarn / next / vite / webpack / tsc-build commands.
  Python tests don't need any frontend asset built. The sandbox OOMs when you try.
- If the error mentions "out_of_memory" or "Killed" or "exit 137", the previous
  command exceeded sandbox RAM. Do NOT propose a heavier alternative — propose
  a lighter one (e.g. install the Python package WITHOUT building optional
  extras, or skip the failing component entirely).

Schema:
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

// Match any command that invokes a Node.js package manager or a JS bundler.
// Skipping these prevents the sandbox from OOMing when a Python repo also ships
// a frontend (e.g. HKUDS/nanobot's `webui/`).
const FRONTEND_BUILD_RE = new RegExp(
  [
    "(?:^|[\\s;&|()`])npm\\s+(?:ci|install|run\\s+build|run\\s+dev|run\\s+watch|run\\s+start)\\b",
    "(?:^|[\\s;&|()`])pnpm\\s+(?:install|i|build|run\\s+build|run\\s+dev|run\\s+watch|run\\s+start)\\b",
    "(?:^|[\\s;&|()`])yarn\\s+(?:install|add|build|run\\s+build|run\\s+dev|run\\s+watch|run\\s+start)\\b",
    "(?:^|[\\s;&|()`])yarn(?:\\s|$)",
    "(?:^|[\\s;&|()`])bun\\s+(?:install|build|run\\s+build)\\b",
    "(?:^|[\\s;&|()`])npx\\s+(?:next|vite|webpack|rollup|esbuild|turbo)\\b",
    "(?:^|[\\s;&|()`])(?:next|vite|webpack|rollup|esbuild|turbo|parcel)(?:\\s+(?:build|dev)\\b|\\s*$)",
    "(?:^|[\\s;&|()`])tsc\\s+(?:-b|--build)\\b",
  ].join("|"),
);

function isFrontendBuildCommand(cmd: string): boolean {
  return FRONTEND_BUILD_RE.test(cmd);
}

/** Detect commands killed by the OOM killer (exit 137) or V8 GC blow-ups. */
function isOomFailure(result: { exitCode: number; stdout: string; stderr: string }): boolean {
  if (result.exitCode === 137) return true;
  const blob = `${result.stdout}\n${result.stderr}`.toLowerCase();
  return (
    blob.includes("killed") &&
    (blob.includes("npm") || blob.includes("node") || blob.includes("oom") || blob.includes("out of memory") || /\bsignal\s*9\b/.test(blob))
  ) ||
    blob.includes("javascript heap out of memory") ||
    blob.includes("allocation failure; scavenge might not succeed") ||
    blob.includes("mark-compact");
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
