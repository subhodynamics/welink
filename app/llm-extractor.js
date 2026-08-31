const OpenAI = require("openai");
const cheerio = require("cheerio");
const { Experience, Education, ProfileResponse } = require("./schema");
const { buildLinkedInExtractionPrompt } = require("./prompt");

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

function validateLinkedInProfileData(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("LLM response must be a JSON object matching the supported schema.");
  }

  const validateStringOrNull = (value, fieldName) => {
    if (value === null || value === undefined) return;
    if (typeof value !== "string") {
      throw new Error(`Field "${fieldName}" must be a string or null.`);
    }
  };

  const validateStringArray = (value, fieldName) => {
    if (value === undefined || value === null) return;
    if (!Array.isArray(value)) {
      throw new Error(`Field "${fieldName}" must be an array.`);
    }
    for (const item of value) {
      if (typeof item !== "string") {
        throw new Error(`Field "${fieldName}" must contain only strings.`);
      }
    }
  };

  ["name", "headline", "location", "about", "profile_image_url"].forEach((field) => {
    validateStringOrNull(data[field], field);
  });

  if (data.experience !== undefined && data.experience !== null) {
    if (!Array.isArray(data.experience)) {
      throw new Error('Field "experience" must be an array.');
    }
    for (const item of data.experience) {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        throw new Error('Each experience item must be an object.');
      }
      ["title", "company", "location", "duration", "description"].forEach((field) => {
        validateStringOrNull(item[field], field);
      });
    }
  }

  if (data.education !== undefined && data.education !== null) {
    if (!Array.isArray(data.education)) {
      throw new Error('Field "education" must be an array.');
    }
    for (const item of data.education) {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        throw new Error('Each education item must be an object.');
      }
      ["school", "degree", "duration"].forEach((field) => {
        validateStringOrNull(item[field], field);
      });
    }
  }

  validateStringArray(data.skills, "skills");
  validateStringArray(data.certifications, "certifications");
  validateStringArray(data.languages, "languages");
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

  const prompt = buildLinkedInExtractionPrompt(pageText);

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
  validateLinkedInProfileData(parsedData);

  // Inject the image URL we saved from the raw HTML
  if (!parsedData.profile_image_url && profileImageUrl) {
    parsedData.profile_image_url = profileImageUrl;
  }

  return mapLlmProfile(parsedData, profileUrl);
}

module.exports = {
  DEFAULT_MODEL,
  extractLinkedInProfileWithLlm,
  mapLlmProfile,
  pageToText,
  parseJsonResponse,
  validateLinkedInProfileData,
};