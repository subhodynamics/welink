const OpenAI = require("openai");
const cheerio = require("cheerio");
const { Experience, Education, ProfileResponse } = require("./schema");

const GROQ_BASE_URL = "https://api.groq.com/openai/v1";
// Changed to a valid, high-performance Groq model
const DEFAULT_MODEL = "llama-3.3-70b-versatile"; 
const MAX_PAGE_TEXT_LENGTH = 60_000;

function getGroqClient() {
  const apiKey = process.env.GROQ_API_KEY || process.env.groq_api;
  if (!apiKey) throw new Error("GROQ_API_KEY is not configured.");
  return new OpenAI({ apiKey, baseURL: GROQ_BASE_URL });
}

function pageToText(html) {
  const $ = cheerio.load(html);
  $("script, style, noscript, svg").remove();
  return $.root().text().replace(/\s+/g, " ").trim().slice(0, MAX_PAGE_TEXT_LENGTH);
}

function parseJsonResponse(output) {
  const cleaned = String(output || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("The model did not return a JSON object.");
  return JSON.parse(cleaned.slice(start, end + 1));
}

function asString(value) { return typeof value === "string" && value.trim() ? value.trim() : null; }
function asStringList(value) { return Array.isArray(value) ? value.map(asString).filter(Boolean) : []; }

function mapLlmProfile(profile, profileUrl) {
  return new ProfileResponse({
    success: true, profile_url: profileUrl,
    name: asString(profile.name), headline: asString(profile.headline),
    location: asString(profile.location), about: asString(profile.about),
    profile_image_url: asString(profile.profile_image_url),
    experience: Array.isArray(profile.experience) ? profile.experience.map(item => new Experience({
      title: asString(item?.title), company: asString(item?.company),
      location: asString(item?.location), duration: asString(item?.duration),
      description: asString(item?.description)
    })) : [],
    education: Array.isArray(profile.education) ? profile.education.map(item => new Education({
      school: asString(item?.school), degree: asString(item?.degree), duration: asString(item?.duration)
    })) : [],
    skills: asStringList(profile.skills),
    certifications: asStringList(profile.certifications),
    languages: asStringList(profile.languages),
  });
}

async function extractLinkedInProfileWithLlm(html, profileUrl, client = getGroqClient()) {
  const pageText = pageToText(html);
  if (!pageText) throw new Error("The LinkedIn page did not contain readable text.");

  // CRITICAL: Extract Image URL from raw HTML BEFORE cheerio strips the <img> tags
  const imgMatch = html.match(/https:\/\/media\.licdn\.com\/dms\/image\/[^"'\s]+profile-displayphoto[^"'\s]*/);
  const profileImageUrl = imgMatch ? imgMatch[0].replace(/&amp;/g, "&") : null;

  const prompt = `Extract the LinkedIn profile from the page text below. Return ONLY a valid JSON object, with exactly these fields:
{
  "name": "string or null", "headline": "string or null", "location": "string or null",
  "about": "string or null", "profile_image_url": "string or null",
  "experience": [{"title": "string or null", "company": "string or null", "location": "string or null", "duration": "string or null", "description": "string or null"}],
  "education": [{"school": "string or null", "degree": "string or null", "duration": "string or null"}],
  "skills": ["string"], "certifications": ["string"], "languages": ["string"]
}
Use only information explicitly present. Do not infer. Use null or [] for missing values. Ignore navigation, login prompts, and ads.

LinkedIn page text:\n${pageText}`;

  // 1. Use chat.completions.create (Groq does not support the Responses API)
  const response = await client.chat.completions.create({
    model: process.env.GROQ_MODEL || DEFAULT_MODEL,
    messages: [{ role: "user", content: prompt }],
    response_format: { type: "json_object" }, // Forces the LLM to output strict JSON
    temperature: 0.1,
  });

  // 2. Parse response.choices[0].message.content
  const rawContent = response.choices[0].message.content;
  const parsedData = parseJsonResponse(rawContent);
  
  // Inject the image URL we saved from the raw HTML
  if (!parsedData.profile_image_url && profileImageUrl) {
    parsedData.profile_image_url = profileImageUrl;
  }

  return mapLlmProfile(parsedData, profileUrl);
}

module.exports = { DEFAULT_MODEL, extractLinkedInProfileWithLlm, mapLlmProfile, pageToText, parseJsonResponse };