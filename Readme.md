# LinkedIn Profile Extraction API

A lightweight REST API that fetches LinkedIn profile pages and converts the returned HTML into structured profile data.

The service uses a hybrid extraction architecture:

* **Groq LLM** as the primary extraction mechanism
* **Cheerio-based deterministic extraction** as a fallback
* **Express.js** as the API layer
* **Native Node.js `fetch`** for retrieving LinkedIn pages

The API is designed to accept a LinkedIn profile URL and a LinkedIn session cookie, fetch the profile page, extract the available information, normalize it into a consistent schema, and return it as JSON.

---

# 1. System Architecture

```text
                        ┌─────────────────────────┐
                        │         Client          │
                        │                         │
                        │  LinkedIn Profile URL   │
                        │  LinkedIn Cookie        │
                        └────────────┬────────────┘
                                     │
                                     │ POST /api/v1/profile
                                     ▼
                        ┌─────────────────────────┐
                        │      Express API        │
                        │                         │
                        │  Request validation     │
                        │  Input extraction      │
                        │  Response handling      │
                        └────────────┬────────────┘
                                     │
                                     ▼
                        ┌─────────────────────────┐
                        │    Profile Scraper      │
                        │                         │
                        │  Browser-like headers   │
                        │  Cookie forwarding     │
                        │  LinkedIn GET request   │
                        │  25s timeout            │
                        └────────────┬────────────┘
                                     │
                                     ▼
                        ┌─────────────────────────┐
                        │    LinkedIn HTML        │
                        └────────────┬────────────┘
                                     │
                         ┌───────────┴───────────┐
                         │                       │
                         ▼                       ▼
                ┌──────────────────┐    ┌──────────────────┐
                │   LLM Extractor  │    │ Local Extractor  │
                │                  │    │                  │
                │ Groq             │    │ Cheerio          │
                │ GPT-OSS-20B      │    │ JSON-LD          │
                │                  │    │ Meta / HTML      │
                │ Primary path     │    │ Fallback path    │
                └────────┬─────────┘    └────────┬─────────┘
                         │                       │
                         └───────────┬───────────┘
                                     ▼
                        ┌─────────────────────────┐
                        │   ProfileResponse       │
                        │                         │
                        │ Normalized JSON         │
                        └────────────┬────────────┘
                                     │
                                     ▼
                              API Response
```

---

# 2. Technology Stack

| Layer             | Technology                       |
| ----------------- | -------------------------------- |
| Runtime           | Node.js                          |
| API Framework     | Express.js                       |
| HTTP Client       | Native `fetch`                   |
| HTML Parser       | Cheerio                          |
| LLM SDK           | OpenAI Node.js SDK               |
| LLM Provider      | Groq                             |
| LLM Model         | `openai/gpt-oss-20b`             |
| Configuration     | `dotenv` / environment variables |
| API Format        | REST / JSON                      |
| CORS              | `cors`                           |
| Deployment        | Render                           |
| Health Monitoring | UptimeRobot                      |

The application uses Express middleware for JSON and URL-encoded requests and enables CORS.

---

# 3. Project Structure

```text
.
├── server.js
├── scraper.js
├── extract-linkedin.js
├── llm-extractor.js
├── schema.js
├── package.json
├── package-lock.json
└── .env
```

## `server.js`

The API entry point.

Responsibilities:

* Creates the Express application
* Configures middleware
* Validates incoming requests
* Exposes `/api/v1/profile`
* Exposes `/health`
* Handles HTTP responses
* Starts the server

The main API endpoint is registered as:

```text
POST /api/v1/profile
```

and the health endpoint is:

```text
HEAD /health
```

---

## `scraper.js`

The orchestration layer between the API and the extraction engines.

Responsibilities:

1. Build the LinkedIn request headers.
2. Forward the supplied cookie.
3. Fetch the LinkedIn profile HTML.
4. Apply the 25-second request timeout.
5. Run LLM extraction.
6. Fall back to deterministic extraction if required.
7. Normalize the extracted data into `ProfileResponse`.

The LinkedIn request follows redirects and uses browser-like request headers.

---

## `llm-extractor.js`

Responsible for LLM-based profile extraction.

The module:

1. Converts HTML into readable text.
2. Removes unnecessary HTML elements.
3. Limits the text sent to the model.
4. Extracts the profile image URL directly from raw HTML.
5. Sends the cleaned content to Groq.
6. Parses the JSON response.
7. Normalizes the result.

The HTML-to-text conversion removes `script`, `style`, `noscript`, and `svg` elements and limits the resulting text to 60,000 characters.

---

## `extract-linkedin.js`

Contains the deterministic extraction engine.

It uses Cheerio and several different extraction strategies because LinkedIn does not expose profile information through one stable HTML structure.

The extractor looks at:

* JSON-LD
* Open Graph metadata
* Meta tags
* HTML elements
* Visible paragraph text
* Known LinkedIn selectors
* Regular-expression-based fallbacks

---

## `schema.js`

Defines the normalized response model.

The main classes are:

```text
ProfileResponse
Experience
Education
```

`ProfileResponse` defines the public API structure returned to clients.

---

# 4. API

## POST `/api/v1/profile`

Extracts profile information from a LinkedIn profile.

### Required Inputs

The API requires:

* `profile_url`
* `cookie`

The cookie is required because the service relies on the user's LinkedIn session when requesting the profile.

The current implementation supports receiving both values through either request headers or JSON body.

---

## Request — JSON Body

```http
POST /api/v1/profile
Content-Type: application/json
```

```json
{
  "profile_url": "https://www.linkedin.com/in/example-profile/",
  "cookie": "your-linkedin-cookie-string"
}
```

The intended client experience is deliberately simple:

```text
Paste LinkedIn URL
+
Paste LinkedIn Cookie
+
Send Request
```

The client should not need to manually escape cookie characters or construct a serialized JSON cookie object.

---

## Request — Headers

The same request can be sent using headers:

```http
POST /api/v1/profile
X-Profile-Url: https://www.linkedin.com/in/example-profile/
X-Cookie: your-linkedin-cookie-string
```

The server resolves the values using:

```text
profile_url = X-Profile-Url || body.profile_url
cookie      = X-Cookie      || body.cookie
```

---

# 5. Request Parameters

| Parameter     | Type   | Required | Description             |
| ------------- | ------ | -------: | ----------------------- |
| `profile_url` | String |      Yes | LinkedIn profile URL    |
| `cookie`      | String |      Yes | LinkedIn session cookie |

The profile URL is validated to contain:

```text
linkedin.com/in/
```

Invalid profile URLs return HTTP `400`.

> **Security:** The cookie represents the user's LinkedIn session and must be treated as sensitive credential material. Do not commit it to Git, log it, or expose it in application logs.

---

# 6. Example cURL

## JSON Body

```bash
curl -X POST "https://YOUR-DOMAIN/api/v1/profile" \
  -H "Content-Type: application/json" \
  -d '{
    "profile_url": "https://www.linkedin.com/in/example-profile/",
    "cookie": "your-cookie-string"
  }'
```

## Headers

```bash
curl -X POST "https://YOUR-DOMAIN/api/v1/profile" \
  -H "X-Profile-Url: https://www.linkedin.com/in/example-profile/" \
  -H "X-Cookie: your-cookie-string"
```

---

# 7. Request Processing Pipeline

A request moves through the system as follows:

### Step 1 — Receive Request

Express receives:

```text
POST /api/v1/profile
```

The server extracts the profile URL and cookie.

### Step 2 — Validate URL

The API checks that the URL contains:

```text
linkedin.com/in/
```

If not, it immediately returns `400`.

### Step 3 — Fetch LinkedIn

The scraper performs:

```text
GET <profile_url>
```

using browser-like HTTP headers and the supplied cookie.

The request has a 25-second timeout and follows redirects.

### Step 4 — Receive HTML

The response body is read as HTML.

If LinkedIn returns a non-success HTTP status, the scraper returns an extraction failure.

### Step 5 — LLM Extraction

The HTML is converted into readable text and passed to the LLM.

### Step 6 — Normalize

The extracted data is converted into the application's `ProfileResponse` model.

### Step 7 — Return JSON

The normalized response is returned to the client.

---

# 8. LLM Extraction

The current primary extraction model is:

```text
openai/gpt-oss-20b
```

running through Groq's OpenAI-compatible API.

The Groq endpoint is configured as:

```text
https://api.groq.com/openai/v1
```

The application uses the OpenAI Node.js client with Groq's endpoint as the `baseURL`.

## Environment Configuration

```env
GROQ_API_KEY=your-groq-api-key
GROQ_MODEL=openai/gpt-oss-20b
```

The model is read from `GROQ_MODEL`; otherwise the code has a hardcoded fallback model.

---

# 9. Why an LLM Is Used

One of the biggest challenges in this project is that LinkedIn's HTML is not a clean public data schema.

During development, we found that profile information could appear in structures such as:

```text
profile-info-subheader → location
top-end-link-description → company / education-related information
```

However, these selectors are implementation details of LinkedIn rather than a stable public API.

The problem is not simply finding an HTML tag. The same type of information can appear through:

* JSON-LD
* metadata
* different HTML structures
* different selectors
* visible text
* dynamically structured page content

LinkedIn can also change its internal HTML structure.

This made a pure selector-based scraper increasingly difficult to maintain.

The deterministic extractor therefore remains in the project as a fallback, but the primary extraction responsibility has moved to the LLM.

---

# 10. LLM Extraction Process

The LLM receives cleaned page text rather than the entire raw HTML.

The cleaning process:

```text
Raw LinkedIn HTML
       │
       ▼
Remove scripts/styles/etc.
       │
       ▼
Extract readable text
       │
       ▼
Normalize whitespace
       │
       ▼
Limit to 60,000 characters
       │
       ▼
Send to LLM
```

The extraction prompt instructs the model to:

* Return JSON
* Use only information explicitly present
* Avoid inference
* Return `null` for missing string values
* Return `[]` for missing arrays
* Ignore navigation, login prompts, and advertisements

The API also requests JSON output directly from the model and uses a low temperature of `0.1`.

---

# 11. Profile Response

A successful response has the following structure:

```json
{
  "success": true,
  "profile_url": "https://www.linkedin.com/in/example-profile/",
  "name": "John Doe",
  "headline": "Senior Software Engineer",
  "location": "Bengaluru, Karnataka, India",
  "about": "Software engineer with experience...",
  "profile_image_url": "https://media.licdn.com/...",
  "experience": [
    {
      "title": "Senior Software Engineer",
      "company": "Example Corp",
      "location": "Bengaluru, India",
      "duration": "2022 - Present",
      "description": "..."
    }
  ],
  "education": [
    {
      "school": "Example University",
      "degree": "B.Tech",
      "duration": "2016 - 2020"
    }
  ],
  "skills": [
    "Java",
    "Spring Boot"
  ],
  "certifications": [
    "AWS Certified Developer"
  ],
  "languages": [
    "English"
  ]
}
```

The response schema defines:

```text
success
profile_url
name
headline
location
about
profile_image_url
experience
education
skills
certifications
languages
```

---

# 12. Experience Schema

```json
{
  "title": "Senior Software Engineer",
  "company": "Example Corp",
  "location": "Bengaluru, India",
  "duration": "2022 - Present",
  "description": "..."
}
```

Supported fields:

| Field         | Type          |
| ------------- | ------------- |
| `title`       | String / null |
| `company`     | String / null |
| `location`    | String / null |
| `duration`    | String / null |
| `description` | String / null |

---

# 13. Education Schema

```json
{
  "school": "Example University",
  "degree": "B.Tech",
  "duration": "2016 - 2020"
}
```

Supported fields:

| Field      | Type          |
| ---------- | ------------- |
| `school`   | String / null |
| `degree`   | String / null |
| `duration` | String / null |

---

# 14. Profile Image Extraction

The profile image is handled slightly differently from the other fields.

Before converting the HTML to text, the application searches the raw HTML for LinkedIn profile-display-photo URLs.

This is intentional because the HTML-to-text conversion removes HTML elements, while the image URL is still available in the original document.

If the LLM does not return an image URL, the URL found directly from the HTML is injected into the final result.

---

# 15. Local Extraction Fallback

The project still contains a complete deterministic extraction engine.

It attempts to extract information from:

* LinkedIn JSON-LD
* Open Graph metadata
* Meta descriptions
* Known LinkedIn selectors
* Visible paragraph text
* HTML pattern matching

For example, JSON-LD `Person` data is inspected for information such as name, company, education and languages.

The extractor also contains fallback logic for location, headline, company, education, experience, languages, certifications and profile photo.
The architecture therefore remains:

```text
LLM Extraction
      │
      │ failed?
      ▼
Local Extraction
```

The fallback can be disabled with:

```env
LLM_FALLBACK_TO_LOCAL=false
```

---

# 16. Error Handling

## `400 Bad Request`

Invalid or missing profile URL.

```json
{
  "success": false,
  "detail": "Invalid LinkedIn profile URL. Must contain linkedin.com/in/"
}
```

## `502 Bad Gateway`

The API was unable to successfully retrieve or extract the LinkedIn profile.

```json
{
  "success": false,
  "detail": "Unable to fetch LinkedIn profile",
  "profile_url": "https://www.linkedin.com/in/example-profile/"
}
```

## `500 Internal Server Error`

Unexpected application-level error.

```json
{
  "success": false,
  "detail": "Internal server error"
}
```

---

# 17. Health Check

The application exposes:

```http
HEAD /health
```

A healthy instance returns:

```text
HTTP 200
```

No response body is required.

This endpoint is also used by the external uptime-monitoring setup.

---

# 18. Environment Variables

Example:

```env
PORT=3000

GROQ_API_KEY=your-groq-api-key
GROQ_MODEL=openai/gpt-oss-20b

LLM_FALLBACK_TO_LOCAL=true
```

`PORT` defaults to `3000` when not provided.

The Groq API key is read from `GROQ_API_KEY` and the application also supports the legacy `groq_api` environment variable.

---

# 19. Engineering Decisions

The current architecture was not chosen upfront. It evolved through experimentation with LinkedIn's available interfaces and the practical constraints of hosting a small API.

---

## 19.1 Initial Investigation — Voyager and GraphQL

The first approach was to investigate LinkedIn's internal APIs, particularly:

* Voyager APIs
* GraphQL APIs
* Internal LinkedIn requests

The expectation was that these internal APIs would provide structured profile information directly.

However, during testing, these APIs were not useful for the intended use case.

The main limitation was that requests were primarily returning information for **the authenticated user's own profile**, rather than arbitrary LinkedIn profiles.

That made this approach unsuitable for the intended profile-extraction use case.

---

# 20. Investigating XHR Requests

The next step was to inspect LinkedIn's network traffic through the browser's Developer Tools.

We went through the XHR/fetch requests generated while loading profiles.

The expectation was:

```text
Browser
   ↓
XHR / GraphQL
   ↓
Structured Profile Data
```

However, these requests did not provide a reliable way to obtain the required profile information.

This led to investigating other request types.

---

# 21. The Important Discovery — Document Request

While examining the Network tab, we noticed a request of type:

```text
Document
```

This was different from the XHR requests we had initially been investigating.

The response to this request contained the actual LinkedIn profile HTML, including the profile information we needed.

The flow became:

```text
LinkedIn Profile
       │
       ▼
Document Request
       │
       ▼
HTML
       │
       ▼
Profile Information
```

This was the first approach that actually gave us the complete page content required for extraction.

---

# 22. Why Direct Requests Returned HTTP 999

When we initially tried to reproduce the Document request directly from our server, LinkedIn returned:

```text
HTTP 999
```

This indicated that LinkedIn was rejecting the request rather than returning the profile page.

At this point, the problem changed from:

> "How do we get the profile data?"

to:

> "Why does LinkedIn accept the browser request but reject our server request?"

---

# 23. Reproducing the Browser Request

The next step was to copy the cURL representation of the successful browser request from the Network tab.

The copied request was then imported into Postman.

This allowed us to compare a successful browser request with the failing server-side request.

The investigation focused on the request headers and session information.

Among the differences were things such as:

* Cookies
* User-Agent
* Browser-related headers
* Other request metadata

We then started removing unnecessary pieces and testing the request repeatedly.

---

# 24. Finding the Minimum Required Inputs

Through iterative testing, we found that the request could be reproduced with substantially fewer pieces of the original browser request than initially expected.

The important inputs turned out to be:

```text
Profile URL
+
LinkedIn Cookie
```

The server now constructs the required request headers itself and forwards the user's cookie when requesting LinkedIn.

This significantly simplified the API from the client's perspective.

Instead of asking users to reproduce a browser request with dozens of headers, the client only needs to provide:

```text
LinkedIn URL
LinkedIn Cookie
```

---

# 25. Making Cookie Handling User-Friendly

An additional problem appeared when we tried sending the cookie inside JSON.

A browser cookie string can contain characters such as quotes and other characters that can make manually constructed JSON awkward to send.

The goal was not to force API users to understand JSON escaping.

The desired experience was:

```text
Paste URL
Paste Cookie
Send
```

rather than:

```text
Paste URL
Manually escape cookie
Modify JSON
Send
```

The solution was to support the cookie through the HTTP headers:

```http
X-Cookie: <cookie>
```

and have the server handle the conversion into the actual `Cookie` header used for the LinkedIn request.

The server already supports both header and JSON-body input paths.

---

# 26. Why Node.js?

The initial implementation options considered were primarily:

* Java
* Python
* Node.js

## Java

Java was initially attractive because of familiarity with building production APIs and the availability of Spring Boot.

However, for this particular project, the API was extremely small:

```text
POST /api/v1/profile
```

There was no need for a large application architecture.

The original deployment idea also involved running the application on AWS or GCP with infrastructure such as:

* VM provisioning
* Static IP configuration
* Nginx reverse proxy
* HTTPS certificates
* Server configuration
* Application deployment

For a single API, this would introduce significant infrastructure overhead relative to the application itself.

The priority at the time was to get a working hosted API running quickly.

---

# 27. Why Not Python?

Python was also considered.

However, for this particular lightweight service, Node.js provided a straightforward runtime for:

* HTTP requests
* Express
* HTML parsing
* API handling
* Async I/O

There was also no requirement for a Python-specific ecosystem or heavy computation.

Node.js therefore provided a simple implementation with minimal runtime setup.

---

# 28. Why Render?

Instead of spending time building and maintaining the infrastructure manually on AWS/GCP, a managed application-hosting platform was preferred.

Render was selected because it allowed the application to be deployed without manually managing:

```text
VM
Nginx
Static IP
TLS certificates
Reverse proxy
Operating system
```

The application can simply listen on the platform-provided `PORT` environment variable.

This was a practical tradeoff:

```text
Less infrastructure
        ↓
Faster deployment
        ↓
More time for scraper development
```

---

# 29. Keeping the Render Instance Alive

The hosting setup has an idle/cooldown behavior.

After a period without requests, the service can enter a cooldown state.

For this API, that would create an undesirable first-request delay because the scraper itself already depends on an external LinkedIn request and an LLM request.

To avoid this, an external uptime monitor is used.

The application already provides:

```http
HEAD /health
```

which returns HTTP `200` when the service is available.

UptimeRobot is configured to call this endpoint every 5 minutes.

```text
                 UptimeRobot
                      │
                 every 5 min
                      │
                      ▼
              HEAD /health
                      │
                      ▼
                  HTTP 200
                      │
                      ▼
              Render instance
                 stays active
```

This keeps the API continuously warm rather than allowing it to remain idle for extended periods.

---

# 30. Why Not Build a Pure HTML Scraper?

A natural first approach would be:

```text
LinkedIn HTML
      ↓
Cheerio
      ↓
CSS selectors
      ↓
Structured JSON
```

The project does contain this implementation.

However, it became clear that maintaining it as the primary extraction mechanism would be difficult.

LinkedIn's HTML contains internal implementation-specific selectors and structures.

For example, a selector may correspond to one piece of information in one version of the page:

```text
profile-info-subheader → location
```

while another internal selector may expose information related to:

```text
company
education
```

The problem is that these are not stable public contracts.

A change in LinkedIn's frontend can therefore break a scraper even though the information is still visibly present on the page.

---

# 31. Why the LLM Became the Primary Extractor

The LLM approach changes the problem.

Instead of asking:

> "Which exact HTML selector contains the company?"

we can ask:

> "Given the readable information on this page, identify the person's company."

The page is converted into readable text and the model extracts the fields according to a predefined schema.

This makes the extraction layer less dependent on LinkedIn's internal HTML naming conventions.

The deterministic scraper is still retained as a fallback because it provides a second extraction mechanism if the LLM path fails.

---

# 32. Current Architecture Summary

The current system can therefore be summarized as:

```text
                         Client
                           │
                           │
                 URL + LinkedIn Cookie
                           │
                           ▼
                    Express API
                           │
                           ▼
                  LinkedIn Request
                           │
                           ▼
                    LinkedIn HTML
                           │
                           ▼
                 HTML → readable text
                           │
                           ▼
                    Groq LLM
                openai/gpt-oss-20b
                           │
                           ▼
                  Structured JSON
                           │
                           ▼
                  ProfileResponse
                           │
                           ▼
                       Client
```

With the fallback path:

```text
                    LinkedIn HTML
                           │
                 ┌─────────┴─────────┐
                 │                   │
                 ▼                   ▼
             LLM Parser         Cheerio Parser
             (Primary)          (Fallback)
                 │                   │
                 └─────────┬─────────┘
                           ▼
                   Normalized Schema
```

---

# 33. Current Limitations

There are several areas that are intentionally still under development.

### LinkedIn Request Restrictions

LinkedIn can reject requests or return incomplete content depending on the request context.

The scraper currently reports upstream HTTP failures and extraction failures rather than attempting to bypass them through a large collection of browser headers.

### Incomplete HTML

LinkedIn does not always return the complete profile information in every response.

Sometimes the required information is present; sometimes sections are missing.

This creates a consistency problem for downstream consumers.

### LLM Cost

The profile HTML is converted into text and sent to the LLM.

The current text limit is 60,000 characters.

Reducing unnecessary prompt and input tokens is therefore an important optimization area.

### LinkedIn HTML Changes

The deterministic extraction system depends on LinkedIn's current HTML structures and therefore requires maintenance when those structures change.

---

# 34. Future Improvements

The next development priorities are focused around three areas.

## 34.1 Application-Level Rate Limiting

The first priority is to introduce a rate-limiting layer between the public API and LinkedIn.

Current:

```text
Client
  ↓
Our API
  ↓
LinkedIn
```

Planned:

```text
Client
  ↓
Our API
  ↓
Our Rate Limiter
  ↓
LinkedIn
```

The objective is to control how frequently the service makes requests to LinkedIn and reduce the risk of repeatedly triggering LinkedIn's request restrictions.

This layer can eventually provide:

* Per-user limits
* Global request limits
* Concurrency control
* Request queues
* Retry/backoff strategies
* LinkedIn-specific failure handling

---

# 35. Prompt Optimization

The second priority is improving the extraction prompt.

The current prompt explicitly defines the output schema and instructs the model not to infer information.

The goal is to find the smallest effective prompt that still reliably extracts the complete profile.

The optimization problem is:

```text
Smaller prompt
      +
Lower token usage
      +
Same / better extraction quality
```

The prompt needs to handle variations in:

* Profile layouts
* Missing sections
* Different experience structures
* Different education formats
* Different profile descriptions
* Different languages
* Partial HTML responses

This will be an ongoing prompt-evaluation exercise rather than simply making the prompt longer.

---

# 36. Profile Data Cache / Database

The third priority is handling incomplete LinkedIn responses.

Currently, if LinkedIn returns only part of a profile, the API can only work with the information available in that particular response.

A future architecture is to persist extracted information.

For example:

```text
Request 1
   │
   ▼
LinkedIn returns:
Name + Headline + Experience
   │
   ▼
Store data
```

Later:

```text
Request 2
   │
   ▼
LinkedIn returns:
Name + Education + Skills
   │
   ▼
Merge with existing profile
   │
   ▼
Updated stored profile
```

The long-term idea is:

```text
                    LinkedIn
                       │
                       ▼
                 Extracted Data
                       │
                       ▼
                  Cache / DB
                       │
              ┌────────┴────────┐
              │                 │
              ▼                 ▼
        Existing data       New data
              │                 │
              └────────┬────────┘
                       ▼
                 Merge Profile
                       │
                       ▼
                 Complete Profile
```

This would make the system progressively more complete instead of treating every LinkedIn response as an isolated extraction.

A future implementation could also introduce:

* Profile-level caching
* Cache expiration
* Partial-field updates
* Data merging
* Last-updated timestamps
* Persistent profile history

---

# 37. Development Direction

The current project has deliberately evolved toward a relatively simple architecture:

```text
Node.js
   +
Express
   +
LinkedIn HTML retrieval
   +
LLM extraction
   +
Deterministic fallback
```

The next phase is not to make the system significantly more complicated, but to make the existing pipeline more reliable and efficient.

The immediate priorities are:

1. **Rate limiting and request control**
2. **LLM prompt/token optimization**
3. **Persistent caching / profile data accumulation**
4. **Improving extraction consistency**
5. **Reducing dependency on LinkedIn's changing HTML structure**

The underlying principle is to keep the API itself simple while making the scraping and extraction layers progressively more robust.
