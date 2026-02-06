import fs from "node:fs/promises";
import path from "node:path";
import puppeteer, { type ConsoleMessage, type Cookie, type HTTPRequest, type Target } from "puppeteer-core";

interface ExperimentResult {
  name: string;
  passed: boolean;
  details: string[];
}

const TARGET_URL = process.argv[2] ?? "https://x.com/i/status/2019006416791740596";
const DEBUG_URL = process.env.CHROME_DEBUG_URL ?? "http://127.0.0.1:9222";
const OUTPUT_PATH = path.join(process.cwd(), "tmp", "x-capture-debug.md");

async function run(): Promise<void> {
  const experiments: ExperimentResult[] = [];
  const start = new Date().toISOString();

  // Experiment 1: DevTools endpoint health
  const devtools = await experiment("DevTools endpoint is reachable", async () => {
    const versionResponse = await fetch(`${DEBUG_URL}/json/version`);
    if (!versionResponse.ok) {
      throw new Error(`DevTools endpoint returned ${versionResponse.status} ${versionResponse.statusText}`);
    }

    const versionData = await versionResponse.json();
    return [
      `Endpoint: ${DEBUG_URL}/json/version`,
      `Browser: ${versionData.Browser ?? "unknown"}`,
      `User-Agent: ${versionData["User-Agent"] ?? "unknown"}`,
      `WebSocket debugger URL present: ${Boolean(versionData.webSocketDebuggerUrl)}`,
    ];
  });
  experiments.push(devtools);

  let browser: any = null;

  try {
    // Experiment 2: Connect and inspect session state
    const connectionExperiment = await experiment("Puppeteer can connect to shared Chromium", async () => {
      browser = await puppeteer.connect({ browserURL: DEBUG_URL });
      const pages = await browser.pages();
      const targets = browser
        .targets()
        .map((target: Target) => `${target.type()}: ${target.url() || "(blank)"}`)
        .slice(0, 20);

      return [
        `Connected: ${browser.connected}`,
        `Open pages: ${pages.length}`,
        `Total targets: ${browser.targets().length}`,
        ...targets.map((target: string) => `Target -> ${target}`),
      ];
    });
    experiments.push(connectionExperiment);

    if (browser) {
      const connectedBrowser = browser;

      // Experiment 3: Cookie visibility for x.com
      const cookieExperiment = await experiment("Shared Chromium exposes x.com cookies", async () => {
      const context = connectedBrowser.defaultBrowserContext();
      const allCookies = await context.cookies();
      const cookies = allCookies.filter((cookie: Cookie) => cookie.domain.includes("x.com") || cookie.domain.includes("twitter.com"));
      const sample = cookies.slice(0, 10).map((cookie: Cookie) => `${cookie.name} (domain=${cookie.domain}, secure=${cookie.secure})`);

      return [
        `x.com cookie count in default browser context: ${cookies.length}`,
        ...sample.map((cookie: string) => `Cookie -> ${cookie}`),
      ];
    });
      experiments.push(cookieExperiment);

      // Experiment 4: Render diagnostics in a new tab
      const renderExperiment = await experiment("Tweet URL renders meaningful DOM content", async () => {
      const page = await connectedBrowser.newPage();
      const consoleMessages: string[] = [];
      const requestFailures: string[] = [];

      page.on("console", (msg: ConsoleMessage) => {
        consoleMessages.push(`${msg.type()}: ${msg.text()}`);
      });
      page.on("requestfailed", (req: HTTPRequest) => {
        const failureText = req.failure()?.errorText ?? "unknown";
        requestFailures.push(`${req.method()} ${req.url()} => ${failureText}`);
      });

      await page.setViewport({ width: 1366, height: 900 });
      await page.setJavaScriptEnabled(true);
      const response = await page.goto(TARGET_URL, {
        waitUntil: "domcontentloaded",
        timeout: 45000,
      });

      // Give X time to hydrate its SPA
      await new Promise(resolve => setTimeout(resolve, 12000));

      const diagnostic = await page.evaluate(() => {
        const bodyText = document.body?.innerText ?? "";
        const articleCount = document.querySelectorAll("article").length;
        const mainCount = document.querySelectorAll("main").length;
        const loginMarker = document.querySelector('[data-testid="SideNav_AccountSwitcher_Button"]') ? 1 : 0;
        const jsDisabledText = bodyText.includes("JavaScript is not available");
        const title = document.title;

        return {
          href: window.location.href,
          title,
          textLength: bodyText.length,
          textPreview: bodyText.slice(0, 600),
          articleCount,
          mainCount,
          loginMarker,
          jsDisabledText,
          userAgent: navigator.userAgent,
          webdriver: (navigator as Navigator & { webdriver?: boolean }).webdriver ?? false,
        };
      });

      await page.close();

      return [
        `Navigation response status: ${response?.status() ?? 0}`,
        `Final URL: ${diagnostic.href}`,
        `Page title: ${diagnostic.title}`,
        `DOM text length: ${diagnostic.textLength}`,
        `Article elements: ${diagnostic.articleCount}`,
        `Main elements: ${diagnostic.mainCount}`,
        `Logged-in marker present: ${diagnostic.loginMarker === 1}`,
        `Contains "JavaScript is not available": ${diagnostic.jsDisabledText}`,
        `navigator.webdriver: ${diagnostic.webdriver}`,
        `navigator.userAgent: ${diagnostic.userAgent}`,
        `Text preview: ${diagnostic.textPreview.replace(/\n+/g, " ").slice(0, 500)}`,
        ...consoleMessages.slice(0, 20).map(message => `Console -> ${message}`),
        ...requestFailures.slice(0, 20).map(message => `Request failed -> ${message}`),
      ];
      });
      experiments.push(renderExperiment);
    }
  } finally {
    if (browser) {
      await browser.close();
    }
  }

  // Experiment 5: Direct fetch baseline
  const fetchExperiment = await experiment("Raw fetch baseline (without browser rendering)", async () => {
    const response = await fetch(TARGET_URL, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; ob-share-debug/1.0)",
      },
    });
    const html = await response.text();

    return [
      `HTTP status: ${response.status}`,
      `Response length: ${html.length}`,
      `Contains "JavaScript is not available": ${html.includes("JavaScript is not available")}`,
      `Contains tweet article marker ("data-testid=\"tweetText\""): ${html.includes("tweetText")}`,
    ];
  });
  experiments.push(fetchExperiment);

  const summary = buildSummary(experiments);
  const markdown = renderMarkdown({ start, targetUrl: TARGET_URL, debugUrl: DEBUG_URL, experiments, summary });

  await fs.mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await fs.writeFile(OUTPUT_PATH, markdown, "utf-8");

  console.log(`Wrote debug report: ${OUTPUT_PATH}`);
  console.log(summary);
}

async function experiment(name: string, fn: () => Promise<string[]>): Promise<ExperimentResult> {
  try {
    const details = await fn();
    return { name, passed: true, details };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      name,
      passed: false,
      details: [message],
    };
  }
}

function buildSummary(experiments: ExperimentResult[]): string {
  const passed = experiments.filter(exp => exp.passed).length;
  const failed = experiments.length - passed;
  return `Experiments complete: ${passed} passed, ${failed} failed.`;
}

function renderMarkdown(input: {
  start: string;
  targetUrl: string;
  debugUrl: string;
  experiments: ExperimentResult[];
  summary: string;
}): string {
  const lines: string[] = [];

  lines.push("# X Capture Debug Report");
  lines.push("");
  lines.push(`- Started at: ${input.start}`);
  lines.push(`- Target URL: ${input.targetUrl}`);
  lines.push(`- DevTools URL: ${input.debugUrl}`);
  lines.push(`- ${input.summary}`);
  lines.push("");
  lines.push("## Experiments");
  lines.push("");

  input.experiments.forEach((exp, index) => {
    lines.push(`### ${index + 1}. ${exp.name}`);
    lines.push(`Status: ${exp.passed ? "✅ PASS" : "❌ FAIL"}`);
    lines.push("");
    exp.details.forEach(detail => lines.push(`- ${detail}`));
    lines.push("");
  });

  lines.push("## Next Steps");
  lines.push("");
  lines.push("- If browser-connect experiments fail, check if Chromium is running with `--remote-debugging-port=9222`.");
  lines.push("- If cookie experiment fails, log into x.com in VNC Chromium and rerun this script.");
  lines.push("- If render experiment shows JavaScript fallback page while cookies exist, investigate anti-automation signals (webdriver/user-agent) and request blocking.");
  lines.push("");

  return `${lines.join("\n")}\n`;
}

void run();
