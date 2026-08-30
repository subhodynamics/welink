const { ProfileResponse, Experience, Education } = require("./schema");
const { extractLinkedInProfile } = require("./extract-linkedin");
const { extractLinkedInProfileWithLlm } = require("./llm-extractor");

function buildFailure(profileUrl, message) {
  return new ProfileResponse({
    success: false,
    profile_url: profileUrl,
    error_message: message,
  });
}

async function scrapeLinkedInProfile(profileUrl, cookieStr = null, mode = "llm") {
  const headers = {
  accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
  "accept-language": "en-US,en;q=0.9",
  dnt: "1",
  priority: "u=0, i",
  referer: "https://www.google.com/",
  "sec-ch-ua": '"Not=A?Brand";v="99", "Microsoft Edge";v="151", "Chromium";v="151"',
  "sec-ch-ua-mobile": "?0",
  "sec-ch-ua-platform": '"macOS"',
  "sec-fetch-dest": "document",
  "sec-fetch-mode": "navigate",
  "sec-fetch-site": "cross-site",
  "sec-fetch-user": "?1",
  "upgrade-insecure-requests": "1",
  "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36 Edg/151.0.0.0",
};

  if (cookieStr && String(cookieStr).trim()) {
    headers.cookie = String(cookieStr).trim();
  }

  try {
    const response = await fetch(profileUrl, {
      method: "GET",
      headers,
      redirect: "follow",
      signal: AbortSignal.timeout(25000),
    });

    if (!response.ok) {
      return buildFailure(profileUrl, `HTTP ${response.status}`);
    }

    const html = await response.text();
    if (mode === "llm") {
      try {
        const profile = await extractLinkedInProfileWithLlm(html, profileUrl);
        if (profile.name) return profile;
      } catch (error) {
        if (process.env.LLM_FALLBACK_TO_LOCAL === "false") throw error;
      }
    }

    const data = extractLinkedInProfile(html);
    if (!data?.basic?.fullName) {
      return buildFailure(
        profileUrl,
        "Could not extract profile data (auth wall or empty public profile)."
      );
    }
    return mapToSchema(data, profileUrl);
  } catch (error) {
    return buildFailure(profileUrl, String(error?.message || error));
  }
}

function mapToSchema(data, url) {
  const basic = data.basic || {};

  const experience = (data.experience || []).map(
    (job) =>
      new Experience({
        title: job.title || null,
        company: job.company || null,
        location: job.location || null,
        duration: null,
        description: null,
      })
  );

  const education = (data.education || []).map(
    (edu) =>
      new Education({
        school: edu.school || null,
        degree: edu.degree || null,
        duration:
          edu.startYear && edu.endYear
            ? `${edu.startYear} – ${edu.endYear}`
            : edu.startYear
            ? String(edu.startYear)
            : null,
      })
  );

  const certifications = (data.certifications || [])
    .map((c) => {
      if (typeof c === "string") return c;
      if (!c?.name) return null;
      return `${c.name}${c.issuer ? ` (${c.issuer})` : ""}${c.issued ? ` - ${c.issued}` : ""}`;
    })
    .filter(Boolean);

  let headline = basic.headline || null;
  if (data.currentCompany && (!headline || headline === basic.fullName)) {
    headline = `${basic.fullName} - ${data.currentCompany}`;
  } else if (!headline && data.currentCompany) {
    headline = data.currentCompany;
  }

  return new ProfileResponse({
    success: true,
    profile_url: url || basic.profileUrl || null,
    name: basic.fullName || null,
    headline,
    location: basic.location || null,
    about: data.about || null,
    profile_image_url: basic.profilePhoto || null,
    experience,
    education,
    skills: [],
    certifications,
    languages: data.languages || [],
  });
}

module.exports = { scrapeLinkedInProfile };
