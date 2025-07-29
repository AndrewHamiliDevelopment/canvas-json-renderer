import express from "express";
import puppeteer from "puppeteer";
import fs from "fs";
import path from "path";

const app = express();
const PORT = 3000;

app.use(express.json({ limit: "10mb" }));

const outputDir = "./output";
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir);
}

// HTML template with Fabric.js
const htmlTemplate = `
<!DOCTYPE html>
<html>
<head>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/fabric.js/5.3.0/fabric.min.js"></script>
    <style>
        body { margin: 0; padding: 20px; background: transparent; }
        #canvas-container { display: inline-block; }
        canvas { background: transparent !important; }
    </style>
</head>
<body>
    <div id="canvas-container">
        <canvas id="canvas"></canvas>
    </div>
    
    <script>
        window.renderFabricCanvas = function(fabricData) {
            return new Promise((resolve, reject) => {
                try {
                    // Create canvas with size from data or default
                    const canvasWidth = fabricData.width || 800;
                    const canvasHeight = fabricData.height || 700;
                    
                    const canvas = new fabric.Canvas('canvas', {
                        width: canvasWidth,
                        height: canvasHeight,
                        backgroundColor: null // Transparent background
                    });
                    
                    // Ensure canvas background is transparent
                    canvas.backgroundImage = null;
                    canvas.backgroundColor = null;
                    
                    // Load canvas from JSON
                    canvas.loadFromJSON(fabricData, function() {
                        // Override any background color from JSON to keep transparent
                        canvas.backgroundColor = null;
                        canvas.renderAll();
                        
                        // Wait a bit for images to load
                        setTimeout(() => {
                            resolve('Canvas rendered successfully');
                        }, 2000);
                    });
                    
                } catch (error) {
                    reject(error);
                }
            });
        };
    </script>
</body>
</html>
`;

let browser = null;

// Initialize browser with proper configuration
async function initBrowser() {
  if (!browser) {
    const isDocker = fs.existsSync("/.dockerenv");

    const launchOptions = {
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-accelerated-2d-canvas",
        "--no-first-run",
        "--no-zygote",
        "--single-process",
        "--disable-gpu",
        "--disable-background-timer-throttling",
        "--disable-backgrounding-occluded-windows",
        "--disable-renderer-backgrounding",
      ],
    };

    // Additional Docker-specific settings
    if (isDocker) {
      launchOptions.args.push(
        "--disable-extensions",
        "--disable-plugins",
        "--disable-background-networking",
        "--disable-background-timer-throttling",
        "--disable-client-side-phishing-detection",
        "--disable-default-apps",
        "--disable-hang-monitor",
        "--disable-popup-blocking",
        "--disable-prompt-on-repost",
        "--disable-sync",
        "--disable-translate",
        "--metrics-recording-only",
        "--no-first-run",
        "--safebrowsing-disable-auto-update",
        "--enable-automation",
        "--password-store=basic",
        "--use-mock-keychain"
      );
    }

    browser = await puppeteer.launch(launchOptions);
  }
  return browser;
}

// Render Fabric.js canvas to PNG with transparent background
async function renderCanvasToPNG(fabricData) {
  const browser = await initBrowser();
  const page = await browser.newPage();

  try {
    // Set viewport size
    await page.setViewport({ width: 1200, height: 800 });

    // Load HTML template
    await page.setContent(htmlTemplate, { waitUntil: "networkidle0" });

    // Wait for Fabric.js to load
    await page.waitForFunction(() => typeof window.fabric !== "undefined", {
      timeout: 10000,
    });

    // Render the canvas
    await page.evaluate((data) => {
      return window.renderFabricCanvas(data);
    }, fabricData);

    // Wait for images to load
    await page.waitForTimeout(3000);

    // Take screenshot of just the canvas with transparent background
    const canvasElement = await page.$("#canvas-container");
    if (!canvasElement) {
      throw new Error("Canvas element not found");
    }

    const screenshot = await canvasElement.screenshot({
      type: "png",
      omitBackground: true, // This makes the background transparent
    });

    return screenshot;
  } finally {
    await page.close();
  }
}

// API endpoint
app.post("/render", async (req, res) => {
  try {
    const fabricData = req.body;

    if (!fabricData.objects || !Array.isArray(fabricData.objects)) {
      return res.status(400).json({
        error: "Invalid canvas data. Expected JSON with 'objects' array.",
      });
    }

    console.log("Rendering canvas with transparent background...");

    const screenshot = await renderCanvasToPNG(fabricData);

    // Save PNG
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const filename = `fabric-canvas-${timestamp}.png`;
    const filepath = path.join(outputDir, filename);

    fs.writeFileSync(filepath, screenshot);

    console.log(`Canvas rendered with transparent background: ${filepath}`);

    res.json({
      success: true,
      message: "Canvas rendered successfully with transparent background",
      filename: filename,
      filepath: filepath,
      method: "puppeteer + fabric.js",
      background: "transparent",
    });
  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({
      error: "Failed to render canvas",
      details: error.message,
    });
  }
});

// API endpoint for white background (if needed)
app.post("/render-white", async (req, res) => {
  try {
    const fabricData = req.body;

    if (!fabricData.objects || !Array.isArray(fabricData.objects)) {
      return res.status(400).json({
        error: "Invalid canvas data. Expected JSON with 'objects' array.",
      });
    }

    // Override background to white
    fabricData.backgroundColor = "white";

    console.log("Rendering canvas with white background...");

    const browser = await initBrowser();
    const page = await browser.newPage();

    try {
      await page.setViewport({ width: 1200, height: 800 });

      const whiteTemplate = htmlTemplate
        .replace("backgroundColor: null", 'backgroundColor: "white"')
        .replace(
          "canvas.backgroundColor = null;",
          'canvas.backgroundColor = "white";'
        );

      await page.setContent(whiteTemplate, { waitUntil: "networkidle0" });
      await page.waitForFunction(() => typeof window.fabric !== "undefined", {
        timeout: 10000,
      });

      await page.evaluate((data) => {
        return window.renderFabricCanvas(data);
      }, fabricData);

      await page.waitForTimeout(3000);

      const canvasElement = await page.$("#canvas-container");
      const screenshot = await canvasElement.screenshot({
        type: "png",
        omitBackground: false, // Keep white background
      });

      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const filename = `fabric-canvas-white-${timestamp}.png`;
      const filepath = path.join(outputDir, filename);

      fs.writeFileSync(filepath, screenshot);

      res.json({
        success: true,
        message: "Canvas rendered successfully with white background",
        filename: filename,
        filepath: filepath,
        method: "puppeteer + fabric.js",
        background: "white",
      });
    } finally {
      await page.close();
    }
  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({
      error: "Failed to render canvas",
      details: error.message,
    });
  }
});

// Test endpoint to check browser
app.get("/test-browser", async (req, res) => {
  try {
    const browser = await initBrowser();
    const page = await browser.newPage();

    await page.goto("data:text/html,<h1>Browser Test</h1>");
    const title = await page.title();
    await page.close();

    res.json({
      success: true,
      message: "Browser is working",
      title: title,
    });
  } catch (error) {
    res.status(500).json({
      error: "Browser test failed",
      details: error.message,
    });
  }
});

// Health check
app.get("/health", (req, res) => {
  res.json({
    status: "OK",
    method: "puppeteer + fabric.js",
    background: "transparent by default",
  });
});

// Graceful shutdown
process.on("SIGINT", async () => {
  console.log("Shutting down...");
  if (browser) {
    await browser.close();
  }
  process.exit(0);
});

app.listen(PORT, async () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`Output directory: ${path.resolve(outputDir)}`);
  console.log("Background: Transparent by default");
  console.log("Initializing browser...");

  try {
    await initBrowser();
    console.log("✅ Browser initialized successfully");
  } catch (error) {
    console.error("❌ Failed to initialize browser:", error.message);
    console.log("\n🔧 Troubleshooting:");
    console.log(
      "1. If running in Docker, make sure to use the provided Dockerfile"
    );
    console.log(
      "2. If running locally, try: sudo apt-get install -y libnss3 libatk1.0-0 libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 libxrandr2 libgbm1 libxss1 libasound2"
    );
    console.log("3. Or install Chrome/Chromium manually");
  }
});
