# Research methodology

How the Course Discovery Agent finds candidate courses, and the
evidence base it's instructed to anchor on. This document mirrors
the active system prompt in human-readable form. If the prompt
changes, update this file too — or the runbook stops matching
reality.

The full machine-readable source is at
`engine/src/engine/prompts/research_system.txt` (the file fallback)
and in the `prompt_versions` table (the live source of truth for
production runs).

---

## Where this lives in the agent pipeline

Every nightly agent run hits seven nodes in order:

```
feedback_ingest  →  inventory_read  →  gap_analyze
                                              │
                                              ▼
                                  needs_revision_retry
                                              │
                                              ▼   (fan-out: one per category)
                                         research_one  ◄──── this is where the prompt fires
                                              │
                                              ▼
                                         rule_engine
                                              │
                                              ▼
                                       cross_batch_dedupe
                                              │
                                              ▼
                                            persist
```

The research node is where the system prompt does its work. The
flow for **one category**:

1. **Serper search** — a category-biased query (`"Cybersecurity"
   instructor-led corporate training enterprise site:training
   OR site:academy OR site:school 2025`) returns ~10 organic
   results.
2. **Build user prompt** — the search hits become contextual
   evidence, and the system prompt (the methodology + 10 rules)
   tells the LLM how to use them.
3. **Single LLM call** to OpenRouter (`deepseek/deepseek-chat-v3.1`
   by default) asking for up to `max_candidates_per_category`
   candidates as a JSON array.
4. **Parse + validate** each candidate against `RawCandidate`.
   Malformed entries are dropped with a warning; the run never
   crashes on bad JSON.

The 10 rules in the prompt are constraints the LLM applies WHILE
drafting. The Phase 6 rule engine runs downstream as a defense in
depth — for each candidate, Rule 7 actually fetches the cited URLs
and Rule 10 actually checks the title against a blocklist file.

---

## The agent's research method, in plain language

Before drafting candidates, the agent is instructed to triangulate
on three signals:

1. **Public analyst forecasts** naming a specific skill or capability gap
2. **Enterprise hiring trends** showing organizations are budgeting for it
3. **Vendor / conference programming** showing teams are actively being trained on it

The strongest courses sit at the intersection of all three. The
agent is asked to consult these source families. The list is
guidance — when a more authoritative source exists for the topic,
the agent should use it.

### Tier-1 industry analyst reports

| Firm | Strongest signals |
|---|---|
| Gartner | Hype Cycles, Magic Quadrants, IT Spending Forecasts, Top Strategic Technology Trends |
| Forrester | Wave reports, Predictions, Tech Tide |
| IDC | FutureScape, Worldwide Spending Guides |
| McKinsey | State of AI, McKinsey Global Institute reports, Future of Work |
| BCG / Bain / Deloitte / PwC / KPMG / EY | Industry outlooks, workforce reports |
| World Economic Forum | Future of Jobs Report, Reskilling Revolution |

### Workforce + hiring market signals

| Source | What to use it for |
|---|---|
| LinkedIn Workforce Reports, "Skills on the Rise", Economic Graph | Skill-demand gradient by region/role |
| Indeed Hiring Lab, BLS occupational outlook | US/global employer demand trends |
| Burning Glass / Lightcast | Granular skill-frequency in job postings |
| Stack Overflow Developer Survey | Technologist adoption and salary signals |
| Eurostat, EU Skills Agenda, India NSDC, Singapore SkillsFuture | Regional skill-gap data |

### Domain-specific authoritative touchstones

Pick the one that fits the category being researched.

| Category | Touchstones |
|---|---|
| Cybersecurity | Verizon DBIR, IBM Cost of a Data Breach Report, MITRE ATT&CK adoption, SANS surveys, ENISA Threat Landscape |
| Cloud / DevOps / Platform | CNCF Annual Survey, AWS/Azure/GCP state-of-cloud reports, Puppet State of DevOps |
| AI / Data | Stanford HAI AI Index, MIT Sloan Management Review AI research, Kaggle State of ML, OpenAI/Anthropic/Google Research publications, NIST AI RMF |
| HR / L&D / Talent | ATD State of the Industry, SHRM Future of HR, Mercer / Aon talent reports, Josh Bersin's research |
| Finance / Audit / Risk | ACCA / IFAC reports, Big-Four audit committee briefings, COSO ERM, IIA Risk in Focus |
| Operations / Supply Chain | Gartner Supply Chain Top 25, Deloitte Industry 4.0, APICS surveys |
| Marketing / Customer | Gartner CMO Spend Survey, HubSpot State of Marketing, Salesforce State of the Connected Customer |
| Sustainability / ESG | SBTi reports, MSCI ESG ratings methodology, GRI standards updates |
| Healthcare / Life Sciences | HIMSS, Deloitte Global Health Care Outlook, FDA digital health guidance |

### Vendor + conference programming (real-time demand signal)

- Major vendor certification track changes — AWS, Azure, GCP, Salesforce, ServiceNow, SAP, Oracle, Cisco
- Annual conference keynote tracks — RSA Conference, KubeCon + CloudNativeCon, Gartner ITxpo / Symposium, World HR Congress, Money 20/20, NRF Big Show
- What top enterprise training providers are currently selling — PwC Academy, BCG U, McKinsey Forward, Deloitte University, EY Academy, INSEAD Executive Education, Wharton Executive Education, MIT Sloan Executive Education

---

## How the agent must USE these sources

These are not just suggestions — the system prompt encodes them as
requirements that show up downstream in the rule engine and on
`/suggestions/today`:

### In `price_basis`

Cite **at least one specific competitor program** with its published
price, AND at minimum **one authoritative report** that explains
WHY this skill is in demand right now.

Example the agent is shown:

> PwC Academy charges roughly $4,500 per seat for a 3-day Cyber
> Resilience workshop; Gartner's 2024 Top Strategic Technology
> Trends names AI-augmented threat detection as a top-five
> priority, so this candidate sits in a defensible $3,200–$4,800
> range.

### In `references`

Of the 3+ URLs cited per candidate, at least ONE should be a
tier-1 analyst report OR a domain-specific touchstone — not just a
competitor course listing. Course-listing-only references are weak
evidence; readers can't tell whether a topic is rising or fading
from one course page alone.

### In `rationale`

The rationale must reflect a story plausible to a CIO / CISO / CHRO:

- Explain the gap in plain language
- Name the demand signal (analyst report + hiring trend)
- Identify which functional buyer's budget this would land on

---

## Recency, regional, and honesty rules

### Recency

Prefer 2024–2025 reports. A five-year-old Gartner Hype Cycle is
still useful to understand TRAJECTORY but is no longer evidence of
CURRENT spend. When an older report has to be cited, the agent
must say so in the rationale rather than presenting it as current.

### Regional

Edstellar's customers are global but skew **APAC + Middle East**
enterprise. When two sources disagree (e.g., US-centric LinkedIn
data vs. APAC-focused Gartner), favor the broader / global signal.
Courses justified ONLY by US-specific regulations must be framed
explicitly as compliance training for organizations operating in
the US.

### Intellectual honesty

When no real cited program can be found at the right price, the
agent is told to flag this in the rationale rather than invent a
provider. An honest "I couldn't price-anchor this confidently
against published programs" is more valuable to the reviewer than
a fabricated provider name. (The downstream rule engine doesn't
yet detect fabricated provider names; this is the agent's
self-honesty bar.)

---

## The 10 hard constraints

These are the rules in the system prompt. Every candidate must
clear all ten before the LLM returns it. The rule engine then
re-validates rules that can be checked mechanically (URL fetch
for Rule 7, blocklist match for Rule 10).

| # | Rule | Where it's enforced |
|---|---|---|
| 1 | Not a near-duplicate of another candidate in the same response | LLM only |
| 2 | Not already in Edstellar's catalogue | LLM + Phase 6 dedupe vs `courses` table |
| 3 | Suggested price strictly > $2,500 USD | LLM + `RawCandidate` validator |
| 4 | Delivery format MUST be "instructor-led" | LLM + validator |
| 5 | Price defensible via ≥2 competitor data points in `price_basis` | LLM only |
| 6 | Proposed category must match the one being researched | LLM + post-validation |
| 7 | At least 3 references; URLs supporting demand or pricing | LLM + `rule_07.ref_verify` (fetches each URL, asks an LLM judge to assess relevance) |
| 8 | Sources may be global — no region restriction | LLM only |
| 9 | Avoid declining topics; favour rising 12-month demand | LLM only; Research Methodology section above is how the agent tells the difference |
| 10 | **No certification names / acronyms / certifying-body names in titles** | LLM + `rule_10.cert_judge` (LLM-based against the blocklist file) |

**Example of Rule 10 in action** the agent is shown:

> BAD title:  "CIPP/E Certification Prep"
> GOOD title: "European Data Privacy & GDPR Compliance for Enterprise Teams"

The IAPP CIPP/E page can be cited in `references` as market
validation, but never appear in the title.

---

## Output format the agent returns

A JSON array of candidate objects. No prose before or after, no
markdown fences, no preamble — pure JSON. Per-candidate schema:

```json
{
  "title": "<descriptive neutral course title>",
  "rationale": "<2-3 sentences explaining the demand signal and gap in Edstellar's catalogue; reference the analyst report or hiring data that motivates it>",
  "proposed_subcategory": "<short subcategory label, or null>",
  "target_audience": "<who this course is for — name the functional buyer when possible>",
  "duration_days": "<integer, must be > 0>",
  "delivery_format": "instructor-led",
  "suggested_price_usd": "<integer, must be > 2500>",
  "price_basis": "<2-3 sentences citing at least two real comparable programs and their approximate prices, plus one authoritative demand signal>",
  "references": [
    {"name": "<short readable source name>", "url": "<absolute URL>"},
    "...at least three entries; at least one should be a tier-1 analyst report or domain touchstone..."
  ]
}
```

---

## Quality bar the agent is held to

- Propose candidates that an enterprise buyer (CIO, CISO, CHRO,
  CFO, COO, head of risk, head of operations, head of L&D) would
  actively budget for. Not consumer or hobbyist topics.
- Cite real providers in `price_basis` (PwC Academy, SANS
  Institute, FinOps Foundation, BCG X). Do not invent provider
  names.
- Every reference URL must be plausibly valid — real organisation
  domains. The agent verifies them downstream (Rule 7).
- Vary subcategories and audiences across candidates — don't
  propose 10 variants of the same idea.
- The strongest candidates feel "obvious in hindsight" — once a
  reviewer reads the rationale they think *"of course, given
  Gartner's prediction X and the hiring data Y, this course
  belongs in our catalogue."*

---

## Updating the methodology

The prompt is **DB-driven** in production (Phase 8 Step 6). The
active row in `prompt_versions` is what the agent uses at run
time; the file is a fallback for tests and offline tools.

To change the methodology:

1. Edit `engine/src/engine/prompts/research_system.txt`
2. Update this `docs/research-methodology.md` in the same PR so
   docs and prompt stay in sync.
3. Seed the new text as a candidate row:
   ```powershell
   uv --directory engine run seed_research_prompt
   ```
   Or promote immediately:
   ```powershell
   uv --directory engine run seed_research_prompt --promote
   ```
4. Watch `/learning` for the next handful of runs — approval-rate
   trend and rejection-tag mix tell you whether the change helped.

To roll back without code changes: in Supabase Studio SQL Editor,
re-activate a prior version. See `docs/runbook.md` → "Roll back a
prompt version".
