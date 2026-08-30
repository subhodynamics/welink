require("dotenv").config();

const express = require("express");
const cors = require("cors");
const { scrapeLinkedInProfile } = require("./scraper");

const app = express();
const DEFAULT_PORT = Number(process.env.PORT) || 3000;

app.use(cors());
app.use(express.json({ limit: "2mb" }));

async function handleProfileRequest(req, res) {
  const profileUrl = req.body?.profile_url || req.query?.profile_url;
  const cookie = req.body?.cookie || req.query?.cookie || null;
  const extractionMode = req.body?.extraction_mode || req.query?.extraction_mode || "llm";

  if (!profileUrl || !String(profileUrl).includes("linkedin.com/in/")) {
    return res.status(400).json({
      success: false,
      detail: "Invalid LinkedIn profile URL. Must contain linkedin.com/in/",
    });
  }

  if (!["llm", "local"].includes(extractionMode)) {
    return res.status(400).json({
      success: false,
      detail: 'Invalid extraction_mode. Use "llm" or "local".',
    });
  }

  try {
    const result = await scrapeLinkedInProfile(
      String(profileUrl),
      cookie ? String(cookie) : null,
      extractionMode
    );

    if (!result.success) {
      return res.status(502).json({
        success: false,
        detail: result.error_message || "Unable to fetch LinkedIn profile",
        profile_url: profileUrl,
      });
    }

    return res.json(result);
  } catch (err) {
    return res.status(500).json({
      success: false,
      detail: err.message || "Internal server error",
    });
  }
}

app.get("/api/v1/profile", handleProfileRequest);

app.get("/health", (_req, res) => {
  res.json({ status: "healthy", timestamp: new Date().toISOString() });
});

function startServer(port) {
  const server = app.listen(port, () => {
    console.log(`WeLink running on http://localhost:${port}`);
  });
  server.on("error", (error) => {
    if (error.code === "EADDRINUSE") {
      console.warn(`Port ${port} in use, trying ${port + 1}`);
      startServer(port + 1);
      return;
    }
    throw error;
  });
}

if (require.main === module) startServer(DEFAULT_PORT);

module.exports = app;
