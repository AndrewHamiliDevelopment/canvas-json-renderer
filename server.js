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
        body { margin: 0; padding: 20px; background: white; }
        #canvas-container { display: inline-block; }
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
                        backgroundColor: fabricData.backgroundColor || 'white'
                    });
                    
                    // Load canvas from JSON
                    canvas.loadFromJSON(fabricData, function() {
                        canvas.renderAll();
                        
                        // Wait a bit for images to load
                        setTimeout(() => {
                            resolve('Canvas rendered successfully');
                        }, 1000);
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

// Initialize browser
async function initBrowser() {
  if (!browser) {
    browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    })
  }
  return browser
}

// Render Fabric.js canvas to PNG
async function renderCanvasToPNG(fabricData) {
  const browser = await initBrowser()
  const page = await browser.newPage()

  try {
    // Set viewport size
    await page.setViewport({ width: 1200, height: 800 })

    // Load HTML template
    await page.setContent(htmlTemplate)

    // Wait for Fabric.js to load
    await page.waitForFunction(() => typeof window.fabric !== "undefined")

    // Render the canvas
    await page.evaluate((data) => {
      return window.renderFabricCanvas(data)
    }, fabricData)

    // Wait for images to load
    await page.waitForTimeout(2000)

    // Take screenshot of just the canvas
    const canvasElement = await page.$("#canvas-container")
    const screenshot = await canvasElement.screenshot({
      type: "png",
      omitBackground: false,
    })

    return screenshot
  } finally {
    await page.close()
  }
}

// API endpoint
app.post("/render", async (req, res) => {
  try {
    const fabricData = req.body

    if (!fabricData.objects || !Array.isArray(fabricData.objects)) {
      return res.status(400).json({
        error: "Invalid canvas data. Expected JSON with 'objects' array.",
      })
    }

    console.log("Rendering canvas with Puppeteer + Fabric.js...")

    const screenshot = await renderCanvasToPNG(fabricData)

    // Save PNG
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-")
    const filename = `fabric-canvas-${timestamp}.png`
    const filepath = path.join(outputDir, filename)

    fs.writeFileSync(filepath, screenshot)

    console.log(`Canvas rendered: ${filepath}`)

    res.json({
      success: true,
      message: "Canvas rendered successfully with Fabric.js",
      filename: filename,
      filepath: filepath,
      method: "puppeteer + fabric.js",
    })
  } catch (error) {
    console.error("Error:", error)
    res.status(500).json({
      error: "Failed to render canvas",
      details: error.message,
    })
  }
})

// Health check
app.get("/health", (req, res) => {
  res.json({ status: "OK", method: "puppeteer + fabric.js" })
})

// Graceful shutdown
process.on("SIGINT", async () => {
  if (browser) {
    await browser.close()
  }
  process.exit(0)
})

app.listen(PORT, async () => {
  console.log(`Server running on http://localhost:${PORT}`)
  console.log(`Output directory: ${path.resolve(outputDir)}`)
  console.log("Initializing browser...")

  try {
    await initBrowser()
    console.log("Browser initialized successfully")
  } catch (error) {
    console.error("Failed to initialize browser:", error)
  }
})
