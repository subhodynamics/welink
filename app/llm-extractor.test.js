const test = require("node:test");
const assert = require("node:assert/strict");
const { validateLinkedInProfileData } = require("./llm-extractor");

test("accepts a profile payload matching the supported schema and extra LLM details", () => {
  const payload = {
    name: "Jane Doe",
    headline: "Senior Engineer",
    location: "New York, NY",
    about: "About text",
    profile_image_url: "https://example.com/avatar.jpg",
    experience: [
      {
        title: "Engineer",
        company: "Acme",
        location: "New York, NY",
        duration: "2020 - Present",
        description: "Led product work.",
      },
    ],
    education: [
      {
        school: "University of Technology",
        degree: "BSc Computer Science",
        duration: "2014 - 2018",
      },
    ],
    skills: ["JavaScript", "Node.js"],
    certifications: ["AWS Certified Developer"],
    languages: ["English"],
    volunteer_experience: [
      { role: "Volunteer Mentor", organization: "Code for Good" },
    ],
    additional_info: { awards: ["Employee of the Year"] },
  };

  assert.doesNotThrow(() => validateLinkedInProfileData(payload));
});

test("rejects malformed data rather than extra LLM details", () => {
  assert.throws(
    () =>
      validateLinkedInProfileData({
        name: { not: "a string" },
      }),
    /string or null/i,
  );

  assert.throws(
    () =>
      validateLinkedInProfileData({
        name: "Jane Doe",
        headline: "Senior Engineer",
        location: "New York, NY",
        about: null,
        profile_image_url: null,
        experience: [{ title: "Engineer", company: 42 }],
        education: [],
        skills: [],
        certifications: [],
        languages: [],
      }),
    /string or null/i,
  );
});
