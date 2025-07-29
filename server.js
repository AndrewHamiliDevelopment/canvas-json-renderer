import express from "express"
import puppeteer from "puppeteer"
import fs from "fs"
import path from "path"

const app = express()
const PORT = 3000

app.use(express.json({ limit: "10mb" }))

const outputDir = "./output"
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir)
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
`

let browser = null

// Initialize browser with proper configuration
async function initBrowser() {
  if (!browser) {
    const isDocker = fs.existsSync("/.dockerenv")

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
    }

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
        "--use-mock-keychain",
      )
    }

    browser = await puppeteer.launch({executablePath: process.env.CHROMIUM_EXEC, headless: true})
  }
  return browser
}

// Main function that returns image buffer directly
async function renderFabricCanvasToBuffer(fabricData, options = {}) {
  const { transparent = true, format = "png", quality = 90 } = options

  const browser = await initBrowser()
  const page = await browser.newPage()

  try {
    // Set viewport size
    await page.setViewport({ width: 1200, height: 800 })

    // Modify template based on transparency option
    let template = htmlTemplate
    if (!transparent) {
      template = template
        .replace("backgroundColor: null", '"white"')
        .replace("canvas.backgroundColor = null;", 'canvas.backgroundColor = "white";')
        .replace("background: transparent", "background: white")
    }

    // Load HTML template
    await page.setContent(template, { waitUntil: "networkidle0" })

    // Wait for Fabric.js to load
    await page.waitForFunction(() => typeof window.fabric !== "undefined", { timeout: 10000 })

    // Render the canvas
    await page.evaluate((data) => {
      return window.renderFabricCanvas(data)
    }, fabricData)

    // Wait for images to load
    await page.waitForTimeout(3000)

    // Take screenshot of just the canvas
    const canvasElement = await page.$("#canvas-container")
    if (!canvasElement) {
      throw new Error("Canvas element not found")
    }

    const screenshotOptions = {
      type: format,
      omitBackground: transparent,
    }

    // Add quality for JPEG
    if (format === "jpeg" && quality) {
      screenshotOptions.quality = quality
    }

    const buffer = await canvasElement.screenshot(screenshotOptions)

    return buffer
  } finally {
    await page.close()
  }
}

// Wrapper function for backward compatibility (saves to file)
async function renderCanvasToPNG(fabricData, options = {}) {
  const buffer = await renderFabricCanvasToBuffer(fabricData, options)

  // Save PNG
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-")
  const format = options.format || "png"
  const filename = `fabric-canvas-${timestamp}.${format}`
  const filepath = path.join(outputDir, filename)

  fs.writeFileSync(filepath, buffer)

  return {
    buffer,
    filename,
    filepath,
  }
}

// API endpoint that returns image buffer directly
app.post("/render-buffer", async (req, res) => {
  try {
    const { fabricData, options = {} } = req.body

    if (!fabricData || !fabricData.objects || !Array.isArray(fabricData.objects)) {
      return res.status(400).json({
        error: "Invalid request. Expected { fabricData: { objects: [...] }, options?: {...} }",
      })
    }

    console.log("Rendering canvas to buffer...")

    const buffer = await renderFabricCanvasToBuffer(fabricData, options)

    // Set appropriate content type
    const format = options.format || "png"
    const contentType = format === "jpeg" ? "image/jpeg" : "image/png"

    res.set({
      "Content-Type": contentType,
      "Content-Length": buffer.length,
      "Cache-Control": "no-cache",
    })

    res.send(buffer)
  } catch (error) {
    console.error("Error:", error)
    res.status(500).json({
      error: "Failed to render canvas",
      details: error.message,
    })
  }
})

// API endpoint that returns base64 encoded image
app.post("/render-base64", async (req, res) => {
  try {
    const { fabricData, options = {} } = req.body

    if (!fabricData || !fabricData.objects || !Array.isArray(fabricData.objects)) {
      return res.status(400).json({
        error: "Invalid request. Expected { fabricData: { objects: [...] }, options?: {...} }",
      })
    }

    console.log("Rendering canvas to base64...")

    const buffer = await renderFabricCanvasToBuffer(fabricData, options)
    const format = options.format || "png"
    const base64 = buffer.toString("base64")
    const dataUrl = `data:image/${format};base64,${base64}`

    res.json({
      success: true,
      message: "Canvas rendered successfully",
      format: format,
      size: buffer.length,
      base64: base64,
      dataUrl: dataUrl,
    })
  } catch (error) {
    console.error("Error:", error)
    res.status(500).json({
      error: "Failed to render canvas",
      details: error.message,
    })
  }
})

// Original API endpoint (saves to file)
app.post("/render", async (req, res) => {
  try {
    const fabricData = req.body

    if (!fabricData.objects || !Array.isArray(fabricData.objects)) {
      return res.status(400).json({
        error: "Invalid canvas data. Expected JSON with 'objects' array.",
      })
    }

    console.log("Rendering canvas with transparent background...")

    const result = await renderCanvasToPNG(fabricData, { transparent: true })

    console.log(`Canvas rendered with transparent background: ${result.filepath}`)

    res.json({
      success: true,
      message: "Canvas rendered successfully with transparent background",
      filename: result.filename,
      filepath: result.filepath,
      method: "puppeteer + fabric.js",
      background: "transparent",
      size: result.buffer.length,
    })
  } catch (error) {
    console.error("Error:", error)
    res.status(500).json({
      error: "Failed to render canvas",
      details: error.message,
    })
  }
})

// API endpoint for white background (saves to file)
app.post("/render-white", async (req, res) => {
  try {
    const fabricData = req.body

    if (!fabricData.objects || !Array.isArray(fabricData.objects)) {
      return res.status(400).json({
        error: "Invalid canvas data. Expected JSON with 'objects' array.",
      })
    }

    console.log("Rendering canvas with white background...")

    const result = await renderCanvasToPNG(fabricData, { transparent: false })

    res.json({
      success: true,
      message: "Canvas rendered successfully with white background",
      filename: result.filename,
      filepath: result.filepath,
      method: "puppeteer + fabric.js",
      background: "white",
      size: result.buffer.length,
    })
  } catch (error) {
    console.error("Error:", error)
    res.status(500).json({
      error: "Failed to render canvas",
      details: error.message,
    })
  }
})

// Test endpoint to check browser
app.get("/test-browser", async (req, res) => {
  try {
    const browser = await initBrowser()
    const page = await browser.newPage()

    await page.goto("data:text/html,<h1>Browser Test</h1>")
    const title = await page.title()
    await page.close()

    res.json({
      success: true,
      message: "Browser is working",
      title: title,
    })
  } catch (error) {
    res.status(500).json({
      error: "Browser test failed",
      details: error.message,
    })
  }
})

// Health check
app.get("/health", (req, res) => {
  res.json({
    status: "OK",
    method: "puppeteer + fabric.js",
    endpoints: {
      "/render": "Save to file (transparent)",
      "/render-white": "Save to file (white bg)",
      "/render-buffer": "Return image buffer",
      "/render-base64": "Return base64 encoded image",
    },
  })
})

// Graceful shutdown
process.on("SIGINT", async () => {
  console.log("Shutting down...")
  if (browser) {
    await browser.close()
  }
  process.exit(0)
})

app.listen(PORT, async () => {
  console.log(`Server running on http://localhost:${PORT}`)
  console.log(`Output directory: ${path.resolve(outputDir)}`)
  console.log("Available endpoints:")
  console.log("  POST /render        - Save to file (transparent)")
  console.log("  POST /render-white  - Save to file (white bg)")
  console.log("  POST /render-buffer - Return image buffer")
  console.log("  POST /render-base64 - Return base64 image")
  console.log("Initializing browser...")

  try {
    await initBrowser()
    console.log("✅ Browser initialized successfully")
  } catch (error) {
    console.error("❌ Failed to initialize browser:", error.message)
  }
})

// Export the main function for use in other modules
export { renderFabricCanvasToBuffer }
