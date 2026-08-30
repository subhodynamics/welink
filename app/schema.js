class Experience {
  constructor({
    title = null,
    company = null,
    location = null,
    duration = null,
    description = null,
  } = {}) {
    this.title = title;
    this.company = company;
    this.location = location;
    this.duration = duration;
    this.description = description;
  }
}

class Education {
  constructor({ school = null, degree = null, duration = null } = {}) {
    this.school = school;
    this.degree = degree;
    this.duration = duration;
  }
}

class ProfileResponse {
  constructor({
    success,
    profile_url,
    name = null,
    headline = null,
    location = null,
    about = null,
    profile_image_url = null,
    experience = [],
    education = [],
    skills = [],
    certifications = [],
    languages = [],
    error_message = null,
  }) {
    this.success = success;
    this.profile_url = profile_url;
    this.name = name;
    this.headline = headline;
    this.location = location;
    this.about = about;
    this.profile_image_url = profile_image_url;
    this.experience = experience;
    this.education = education;
    this.skills = skills;
    this.certifications = certifications;
    this.languages = languages;
    this.error_message = error_message;
  }

  toJSON() {
    if (!this.success) {
      return {
        success: false,
        profile_url: this.profile_url,
        error_message: this.error_message,
      };
    }
    return {
      success: true,
      profile_url: this.profile_url,
      name: this.name,
      headline: this.headline,
      location: this.location,
      about: this.about,
      profile_image_url: this.profile_image_url,
      experience: (this.experience || []).map((e) => ({
        title: e.title ?? null,
        company: e.company ?? null,
        location: e.location ?? null,
        duration: e.duration ?? null,
        description: e.description ?? null,
      })),
      education: (this.education || []).map((e) => ({
        school: e.school ?? null,
        degree: e.degree ?? null,
        duration: e.duration ?? null,
      })),
      skills: this.skills || [],
      certifications: this.certifications || [],
      languages: this.languages || [],
    };
  }
}

module.exports = { Experience, Education, ProfileResponse };