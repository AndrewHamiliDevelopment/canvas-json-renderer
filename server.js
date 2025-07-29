import express from "express"
import { createCanvas, loadImage } from "canvas"
import fs from "fs"
import path from "path"

const app = express()
const PORT = 3000

app.use(express.json({ limit: "10mb" }))

const outputDir = "./output"
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir)
}

async function renderFabricCanvasFromJSON(fabricData) {
  const canvas = createCanvas(800, 700)
  const ctx = canvas.getContext("2d")

  ctx.fillStyle = "white"
  ctx.fillRect(0, 0, 800, 700)

  if (fabricData.objects && Array.isArray(fabricData.objects)) {
    for (const obj of fabricData.objects) {
      await renderObjectWithOrigin(ctx, obj)
    }
  }

  return canvas
}

async function renderObjectWithOrigin(ctx, obj) {
  if (obj.type === "group") {
    // For groups, render children with proper origin handling
    const groupX = obj.left || 0
    const groupY = obj.top || 0
    const groupWidth = obj.width || 0
    const groupHeight = obj.height || 0
    const groupOriginX = obj.originX || "left"
    const groupOriginY = obj.originY || "top"

    // Calculate group's actual top-left position based on origin
    let groupActualX = groupX
    let groupActualY = groupY

    if (groupOriginX === "center") {
      groupActualX = groupX - groupWidth / 2
    } else if (groupOriginX === "right") {
      groupActualX = groupX - groupWidth
    }

    if (groupOriginY === "center") {
      groupActualY = groupY - groupHeight / 2
    } else if (groupOriginY === "bottom") {
      groupActualY = groupY - groupHeight
    }

    if (obj.objects && Array.isArray(obj.objects)) {
      for (const child of obj.objects) {
        ctx.save()

        // Child position relative to group's actual top-left
        const childRelativeX = child.left || 0
        const childRelativeY = child.top || 0
        const childWidth = child.width || 0
        const childHeight = child.height || 0
        const childOriginX = child.originX || "left"
        const childOriginY = child.originY || "top"

        // Calculate child's absolute position
        let childAbsoluteX = groupActualX + childRelativeX
        let childAbsoluteY = groupActualY + childRelativeY

        // Adjust for child's origin point
        if (childOriginX === "center") {
          childAbsoluteX = childAbsoluteX - childWidth / 2
        } else if (childOriginX === "right") {
          childAbsoluteX = childAbsoluteX - childWidth
        }

        if (childOriginY === "center") {
          childAbsoluteY = childAbsoluteY - childHeight / 2
        } else if (childOriginY === "bottom") {
          childAbsoluteY = childAbsoluteY - childHeight
        }

        ctx.translate(childAbsoluteX, childAbsoluteY)

        // Apply child transformations
        const scaleX = child.scaleX || 1
        const scaleY = child.scaleY || 1
        const angle = child.angle || 0

        if (angle !== 0) {
          ctx.rotate((angle * Math.PI) / 180)
        }
        ctx.scale(scaleX, scaleY)

        if (child.type === "i-text" || child.type === "text") {
          renderText(ctx, child)
        } else if (child.type === "image") {
          await renderImage(ctx, child)
        }

        ctx.restore()
      }
    }
  } else {
    // Standalone objects
    ctx.save()

    const x = obj.left || 0
    const y = obj.top || 0
    const width = obj.width || 0
    const height = obj.height || 0
    const originX = obj.originX || "left"
    const originY = obj.originY || "top"

    // Calculate actual position based on origin
    let actualX = x
    let actualY = y

    if (originX === "center") {
      actualX = x - width / 2
    } else if (originX === "right") {
      actualX = x - width
    }

    if (originY === "center") {
      actualY = y - height / 2
    } else if (originY === "bottom") {
      actualY = y - height
    }

    ctx.translate(actualX, actualY)

    if (obj.type === "i-text" || obj.type === "text") {
      renderText(ctx, obj)
    } else if (obj.type === "image") {
      await renderImage(ctx, obj)
    }

    ctx.restore()
  }
}

function renderText(ctx, textObj) {
  const text = textObj.text || ""
  if (!text) return

  const fontSize = textObj.fontSize || 16
  const fontFamily = textObj.fontFamily || "Arial"
  const fontWeight = textObj.fontWeight || "normal"
  const fill = textObj.fill || "#000000"

  ctx.font = `${fontWeight} ${fontSize}px ${fontFamily}`
  ctx.textAlign = "left"
  ctx.textBaseline = "top"
  ctx.fillStyle = fill

  ctx.fillText(text, 0, 0)
}

async function renderImage(ctx, imageObj) {
  try {
    const src = imageObj.src
    if (!src) return

    const img = await loadImage(src)
    const width = imageObj.width || img.width
    const height = imageObj.height || img.height

    ctx.drawImage(img, 0, 0, width, height)
  } catch (error) {
    console.error("Error loading image:", imageObj.src, error)
    const width = imageObj.width || 100
    const height = imageObj.height || 100
    ctx.fillStyle = "#cccccc"
    ctx.fillRect(0, 0, width, height)
    ctx.fillStyle = "#666666"
    ctx.font = "12px Arial"
    ctx.fillText("Image Error", 10, 20)
  }
}

app.post("/render", async (req, res) => {
  try {
    const fabricData = req.body

    if (!fabricData.objects || !Array.isArray(fabricData.objects)) {
      return res.status(400).json({
        error: "Invalid canvas data. Expected JSON with 'objects' array.",
      })
    }

    const canvas = await renderFabricCanvasFromJSON(fabricData)

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-")
    const filename = `fabric-canvas-${timestamp}.png`
    const filepath = path.join(outputDir, filename)

    const buffer = canvas.toBuffer("image/png")
    fs.writeFileSync(filepath, buffer)

    console.log(`Canvas rendered: ${filepath}`)

    res.json({
      success: true,
      message: "Canvas rendered successfully",
      filename: filename,
      filepath: filepath,
      size: {
        width: canvas.width,
        height: canvas.height,
      },
    })
  } catch (error) {
    console.error("Error:", error)
    res.status(500).json({
      error: "Failed to render canvas",
      details: error.message,
    })
  }
})

app.get("/health", (req, res) => {
  res.json({ status: "OK" })
})

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`)
  console.log(`Output directory: ${path.resolve(outputDir)}`)
})
