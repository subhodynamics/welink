const fs = require("fs");
const cheerio = require("cheerio");

/**
 * Extract structured data from LinkedIn profile HTML.
 * Supports:
 *  - Classic public profile v3 (JSON-LD + meta) — best quality
 *  - Flagship / SDUI HTML (hashed classes, text in <p>)
 */
function extractLinkedInProfile(html) {
  const $ = cheerio.load(html, { decodeEntities: true });

  const text = (el) => {
    if (!el || (typeof el.length === "number" && el.length === 0)) return null;
    const t = $(el).text().replace(/\s+/g, " ").trim();
    return t || null;
  };
  const attr = (el, name) => {
    if (!el || (typeof el.length === "number" && el.length === 0)) return null;
    return $(el).attr(name) || null;
  };
  const meta = (sel) => attr($(sel).first(), "content");

  // Fully redacted LinkedIn privacy text: "***** ****"
  const isRedacted = (s) =>
    !s || /^\*+$/.test(String(s).replace(/\s+/g, "")) || /^[\*\s]+$/.test(String(s));

  const cleanText = (s) => {
    if (!s) return null;
    const t = String(s).replace(/\s+/g, " ").trim();
    return t || null;
  };

  // ---------- Meta ----------
  const metaDescription =
    meta('meta[name="description"]') || meta('meta[property="og:description"]');
  const ogTitle = meta('meta[property="og:title"]');
  const ogImage = meta('meta[property="og:image"]');
  const ogUrl =
    meta('meta[property="og:url"]') || attr($('link[rel="canonical"]').first(), "href");
  const firstNameMeta = meta('meta[property="profile:first_name"]');
  const lastNameMeta = meta('meta[property="profile:last_name"]');

  // ---------- Name ----------
  let fullName = null;

  const pageTitle = text($("title"));
  if (pageTitle) {
    fullName = pageTitle
      .replace(/\s*\|\s*LinkedIn.*$/i, "")
      .replace(/\s*-\s*LinkedIn.*$/i, "")
      .split(/\s+[-–|]\s+/)[0]
      .trim();
    if (/^(search|home|feed|linkedin)$/i.test(fullName)) fullName = null;
  }

  if (!fullName && (firstNameMeta || lastNameMeta)) {
    fullName = [firstNameMeta, lastNameMeta].filter(Boolean).join(" ").trim() || null;
  }

  if (!fullName) {
    $("[aria-label]").each((_, el) => {
      const label = ($(el).attr("aria-label") || "").trim();
      if (/^[A-Z][a-zA-Z.'\-]+(?:\s+[A-Z][a-zA-Z.'\-]+){0,3}$/.test(label)) {
        fullName = label;
        return false;
      }
    });
  }

  if (!fullName) {
    fullName =
      text($("h1.top-card-layout__title")) ||
      text($("h1.text-heading-xlarge")) ||
      null;
  }

  if (!fullName) {
    $("h1").each((_, el) => {
      const t = text(el);
      if (
        t &&
        !/search|home|feed|notification/i.test(t) &&
        /^[A-Z]/.test(t) &&
        t.split(/\s+/).length <= 5
      ) {
        fullName = t;
        return false;
      }
    });
  }

  // ---------- JSON-LD Person (richest source on public v3) ----------
  let personData = null;
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const raw = ($(el).html() || $(el).text() || "").trim();
      if (!raw) return;
      const data = JSON.parse(raw);
      const list = Array.isArray(data)
        ? data
        : data["@graph"]
        ? data["@graph"]
        : [data];
      for (const item of list) {
        if (item?.["@type"] === "Person") {
          personData = item;
          break;
        }
      }
    } catch (e) {}
  });
  if (personData?.name && !fullName) fullName = personData.name;

  // ---------- Visible <p> texts (SDUI fallback) ----------
  const paragraphs = [];
  $("p").each((_, el) => {
    const t = text(el);
    if (t && t.length > 1 && t.length < 300) paragraphs.push(t);
  });

  // ---------- Location ----------
  let location =
    text($(".top-card__subline-item")) ||
    text($(".profile-info-subheader span").first()) ||
    null;

  if (!location && personData?.address) {
    const a = personData.address;
    location =
      cleanText(a.addressLocality) ||
      [a.addressLocality, a.addressRegion, a.addressCountry]
        .filter(Boolean)
        .join(", ") ||
      null;
  }
  if (!location && metaDescription) {
    const m = metaDescription.match(/Location:\s*([^·|]+)/i);
    if (m) location = m[1].trim();
  }
  if (!location) {
    const locRe = /^[A-Za-z .'-]+,\s*[A-Za-z .'-]+(?:,\s*[A-Za-z .'-]+)?$/;
    for (const p of paragraphs) {
      if (
        locRe.test(p) &&
        /(India|USA|United States|UK|United Kingdom|Canada|Australia|Germany|France|Singapore|UAE|Emirates)/i.test(
          p
        )
      ) {
        location = p;
        break;
      }
    }
  }
  if (!location) {
    const m = html.match(
      /([A-Za-z][A-Za-z .'-]+,\s*[A-Za-z][A-Za-z .'-]+,\s*India)/
    );
    if (m) location = m[1].trim();
  }

  // ---------- Headline & company ----------
  let headline = null;
  let currentCompany = null;

  if (personData?.worksFor) {
    const w = Array.isArray(personData.worksFor)
      ? personData.worksFor[0]
      : personData.worksFor;
    if (w?.name && !isRedacted(w.name)) currentCompany = w.name;
  }

  if (!currentCompany) {
    currentCompany =
      text($('[data-section="currentPositionsDetails"] .top-card-link__description')) ||
      text($('[data-section="currentPositionsDetails"]')) ||
      null;
  }
  if (!currentCompany && metaDescription) {
    const m = metaDescription.match(/Experience:\s*([^·|]+)/i);
    if (m) {
      const c = m[1].replace(/&amp;/g, "&").trim();
      if (!isRedacted(c)) currentCompany = c;
    }
  }

  if (ogTitle) {
    let cleaned = ogTitle.replace(/\s*\|\s*LinkedIn.*$/i, "").trim();
    if (fullName && cleaned.toLowerCase().startsWith(fullName.toLowerCase())) {
      cleaned = cleaned.slice(fullName.length).replace(/^\s*[-–]\s*/, "").trim();
    }
    if (cleaned && cleaned !== fullName && !isRedacted(cleaned)) {
      headline = cleaned;
      if (!currentCompany && cleaned.length < 80) currentCompany = cleaned;
    }
  }

  headline =
    headline ||
    text($(".top-card-layout__headline")) ||
    text($(".text-body-medium.break-words")) ||
    null;

  if (!headline && fullName) {
    const nameIdx = paragraphs.findIndex((p) => p === fullName);
    if (nameIdx >= 0 && paragraphs[nameIdx + 1]) {
      const next = paragraphs[nameIdx + 1];
      if (
        !/,\s*[A-Za-z].*,\s*(India|USA|UK)/i.test(next) &&
        next.length > 5 &&
        !/reactivate premium|search/i.test(next)
      ) {
        headline = next;
      }
    }
  }

  if (!headline) {
    for (const p of paragraphs) {
      if (
        /Architect|Engineer|Developer|Manager|Consultant|Analyst|@|Certified|Ranger/i.test(
          p
        ) &&
        p.length > 10 &&
        p.length < 200 &&
        p !== fullName &&
        !/reactivate premium/i.test(p)
      ) {
        headline = p;
        break;
      }
    }
  }

  if (!currentCompany) {
    for (const p of paragraphs) {
      if (p.includes(" · ")) {
        const left = p.split(" · ")[0].trim();
        if (left && left.length < 60 && !/Noida|India|connections|followers/i.test(left)) {
          currentCompany = left;
          break;
        }
      }
    }
  }

  if (!currentCompany && headline) {
    const m = headline.match(/@\s*([A-Za-z0-9&.\- ]{2,40})/);
    if (m) currentCompany = m[1].replace(/\s*\|\|.*$/, "").trim();
  }

  if (!headline && currentCompany && fullName) {
    headline = `${fullName} - ${currentCompany}`;
  }

  // ---------- About ----------
  let about = null;
  if (personData?.description) {
    about = cleanText(personData.description);
  }
  if (!about) {
    const sels = [
      'section[data-section="summary"] .core-section-container__content',
      ".pv-about__summary-text",
      "#about ~ div .inline-show-more-text",
    ];
    for (const sel of sels) {
      const t = text($(sel).first());
      if (t && t.length > 20) {
        about = cleanText(
          t
            .replace(/see more[\s\S]*/i, "")
            .replace(/Welcome back[\s\S]*/i, "")
            .replace(/Sign in[\s\S]*/i, "")
        );
        break;
      }
    }
  }
  // Meta only if it looks like a real about (not Experience:/Education:)
  if (!about && metaDescription) {
    const first = metaDescription.split(/\s*·\s*/)[0].trim();
    if (
      first.length >= 25 &&
      !/^Experience:/i.test(first) &&
      !/^Education:/i.test(first) &&
      !/^Location:/i.test(first)
    ) {
      about = cleanText(first.replace(/&amp;/g, "&"));
    }
  }

  // ---------- Education ----------
  const education = [];
  if (personData?.alumniOf) {
    const list = Array.isArray(personData.alumniOf)
      ? personData.alumniOf
      : [personData.alumniOf];
    for (const edu of list) {
      const school = edu.name || null;
      if (isRedacted(school)) continue;
      education.push({
        school,
        degree: isRedacted(edu.member?.description)
          ? null
          : edu.member?.description || null,
        startYear: edu.member?.startDate || null,
        endYear: edu.member?.endDate || null,
      });
    }
  }
  if (education.length === 0 && metaDescription) {
    const m = metaDescription.match(/Education:\s*([^·|]+)/i);
    if (m && !isRedacted(m[1])) {
      education.push({
        school: m[1].trim(),
        degree: null,
        startYear: null,
        endYear: null,
      });
    }
  }
  if (education.length === 0) {
    for (const p of paragraphs) {
      if (p.includes(" · ")) {
        const parts = p.split(" · ").map((s) => s.trim());
        if (parts[1] && /college|university|school|institute|collage/i.test(parts[1])) {
          education.push({
            school: parts[1],
            degree: null,
            startYear: null,
            endYear: null,
          });
          break;
        }
      }
    }
  }

  // ---------- Experience ----------
  const experience = [];
  if (personData?.worksFor) {
    const list = Array.isArray(personData.worksFor)
      ? personData.worksFor
      : [personData.worksFor];
    for (const job of list) {
      const company = job.name || null;
      if (isRedacted(company)) continue;
      let title = job.member?.description || null;
      if (isRedacted(title)) title = null;
      experience.push({
        company,
        location: job.location || null,
        title,
        url: job.url || null,
      });
    }
  }
  if (experience.length === 0 && currentCompany) {
    let title = null;
    if (headline) {
      const m = headline.match(/^(.+?)\s*@\s*/);
      if (m) {
        title = m[1].replace(/\s*\|\|.*$/, "").trim();
        if (isRedacted(title)) title = null;
      }
    }
    experience.push({
      company: currentCompany,
      location: null,
      title,
      url: null,
    });
  }

  // ---------- Languages ----------
  const languages = [];
  if (personData?.knowsLanguage) {
    const list = Array.isArray(personData.knowsLanguage)
      ? personData.knowsLanguage
      : [personData.knowsLanguage];
    for (const lang of list) {
      const name = lang.name || lang;
      if (name && !isRedacted(name)) languages.push(name);
    }
  }

  // ---------- Certifications ----------
  const certifications = [];
  const seen = new Set();
  $("section").each((_, sec) => {
    const title = text($(sec).find("h2").first());
    if (!title || !/licenses?|certifications?/i.test(title)) return;
    const raw = text(sec) || "";
    const re =
      /([A-Za-z0-9][A-Za-z0-9\s\(\)&\-\.]{2,90}?)\s+(Salesforce|Oracle|Microsoft|AWS|Google|IBM|GitHub)\s+Issued\s+([A-Za-z]{3}\s+\d{4})/gi;
    let m;
    while ((m = re.exec(raw)) !== null) {
      const name = m[1].trim();
      if (name.length > 120 || /cookie|policy|sign in/i.test(name)) continue;
      const key = name.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        certifications.push({
          name,
          issuer: m[2].trim(),
          issued: m[3].trim(),
        });
      }
    }
  });

  // ---------- Photo ----------
  let profilePhoto = ogImage || null;
  if (!profilePhoto && personData?.image?.contentUrl) {
    profilePhoto = personData.image.contentUrl;
  }
  if (!profilePhoto) {
    const m = html.match(
      /https:\/\/media\.licdn\.com\/dms\/image\/[^"'\\\s]+profile-displayphoto[^"'\\\s]*/
    );
    if (m) profilePhoto = m[0].replace(/&amp;/g, "&");
  }

  return {
    basic: {
      fullName: fullName || null,
      firstName:
        firstNameMeta || (fullName ? fullName.split(/\s+/)[0] : null),
      lastName:
        lastNameMeta ||
        (fullName ? fullName.split(/\s+/).slice(1).join(" ") : null),
      location: location || null,
      profileUrl: ogUrl || personData?.url || null,
      profilePhoto,
      headline:
        headline ||
        (fullName && currentCompany ? `${fullName} - ${currentCompany}` : fullName),
    },
    about: about || null,
    currentCompany: currentCompany || null,
    education,
    experience,
    languages: [...new Set(languages.filter(Boolean))],
    certifications,
  };
}

if (require.main === module) {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error("Usage: node extract-linkedin.js <html-file>");
    process.exit(1);
  }
  const html = fs.readFileSync(filePath, "utf-8");
  console.log(JSON.stringify(extractLinkedInProfile(html), null, 2));
}

module.exports = { extractLinkedInProfile };