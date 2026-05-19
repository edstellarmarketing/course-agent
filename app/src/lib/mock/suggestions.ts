import type { Suggestion } from "@/lib/types";
import { mockCourses } from "@/lib/mock/courses";

const TODAY_RUN = "run-2026-05-16";
const ts = (d: string) => `${d}T07:23:00.000Z`;

/**
 * The 6 candidates surfaced for today's review queue. Each one passed all 10
 * rules — these are what reviewers see at /suggestions/today.
 *
 * `closestExistingCourse` is the cosine-similarity diff Phase 4 will compute
 * via pgvector; hand-tied here to the most plausible neighbour in
 * `mockCourses`.
 */
export const mockTodaysSuggestions: Suggestion[] = [
  {
    id: "sg-2026-05-16-001",
    runId: TODAY_RUN,
    title: "European Data Privacy & GDPR Compliance for Enterprise Teams",
    category: "Data Privacy and Security",
    proposedSubcategory: "GDPR & EU Privacy",
    rationale:
      "GDPR enforcement and post-Brexit divergence drive sustained EU privacy demand. Major B2B providers run instructor-led variants in the $3k–$3.5k range. Edstellar currently has only one privacy-adjacent course; this fills the GDPR-specific gap with a neutral title that avoids referencing any certifying body.",
    targetAudience: "Privacy officers, DPOs, Legal & compliance leads",
    durationDays: 3,
    deliveryFormat: "instructor-led",
    suggestedPriceUsd: 3200,
    priceBasis:
      "Benchmarked against three EU privacy programs in the $3,000–$3,500 range (cert and non-cert variants combined).",
    references: [
      { name: "IAPP Privacy Training & Certification Courses", url: "https://iapp.org/train/courses/" },
      { name: "InfosecTrain Privacy Training", url: "https://www.infosectrain.com/privacy-training" },
      { name: "Skillsoft Percipio Learning Platform", url: "https://www.skillsoft.com/" },
    ],
    status: "pending_review",
    createdAt: ts("2026-05-16"),
    closestExistingCourses: [{ course: mockCourses[8], similarity: 0.62 }],
  },
  {
    id: "sg-2026-05-16-002",
    runId: TODAY_RUN,
    title: "Generative AI Governance for the Enterprise",
    category: "Generative AI for Business",
    proposedSubcategory: "Governance & Policy",
    rationale:
      "Boards are asking for defensible AI-use policies. Existing Edstellar GenAI courses cover adoption and prompting; none address governance, model risk, or vendor evaluation. Three instructor-led B2B programs already operate at the $3.5k–$4k tier in this niche.",
    targetAudience: "CIOs, CISOs, AI governance leads, Risk officers",
    durationDays: 2,
    deliveryFormat: "instructor-led",
    suggestedPriceUsd: 3800,
    priceBasis:
      "Two-day cohort programs from McKinsey Academy and IAPP AI Governance trend at $3,400–$4,200.",
    references: [
      { name: "IAPP AI Governance", url: "https://iapp.org/train/ai-governance/" },
      { name: "BCG X Generative AI for Executives", url: "https://www.bcg.com/x/learning/genai-for-executives" },
      { name: "MIT Sloan AI Strategy for Leaders", url: "https://exec.mit.edu/" },
    ],
    status: "pending_review",
    createdAt: ts("2026-05-16"),
    closestExistingCourses: [{ course: mockCourses[3], similarity: 0.71 }],
  },
  {
    id: "sg-2026-05-16-003",
    runId: TODAY_RUN,
    title: "Cloud Cost Optimisation for Engineering Leaders",
    category: "Cloud Computing",
    proposedSubcategory: "FinOps Leadership",
    rationale:
      "Cloud-bill anxiety is a CFO-level conversation now. AWS/Azure run their own internal programs but no neutral, vendor-agnostic instructor-led equivalent exists in Edstellar's catalogue. The two existing cloud courses focus on architecture, not unit economics.",
    targetAudience: "Engineering directors, Platform leads, FinOps practitioners",
    durationDays: 2,
    deliveryFormat: "instructor-led",
    suggestedPriceUsd: 2900,
    priceBasis:
      "Comparable FinOps Foundation-aligned cohort training runs at $2,800–$3,100 for a two-day instructor-led format.",
    references: [
      { name: "FinOps Foundation Training Catalogue", url: "https://www.finops.org/training/" },
      { name: "ProsperOps FinOps Leadership Workshop", url: "https://www.prosperops.com/" },
      { name: "Cloudwise Cost Optimisation Training", url: "https://cloudwise.com/training" },
    ],
    status: "pending_review",
    createdAt: ts("2026-05-16"),
    closestExistingCourses: [{ course: mockCourses[4], similarity: 0.55 }],
  },
  {
    id: "sg-2026-05-16-004",
    runId: TODAY_RUN,
    title: "Secure Software Supply Chain for Engineering Teams",
    category: "Cybersecurity",
    proposedSubcategory: "Supply Chain Security",
    rationale:
      "Post-SolarWinds and post-Log4j, supply-chain attacks dominate enterprise threat models. Edstellar's two existing security courses cover application security and cloud security; neither addresses SBOM, signed builds, or third-party risk programmatically.",
    targetAudience: "Security architects, DevSecOps engineers, Platform leads",
    durationDays: 3,
    deliveryFormat: "instructor-led",
    suggestedPriceUsd: 3400,
    priceBasis:
      "Three instructor-led offerings (Chainguard Academy, SANS SEC547, Snyk SecureFlag) cluster at $3,200–$3,600 for a 3-day cohort.",
    references: [
      { name: "Chainguard Academy", url: "https://edu.chainguard.dev/" },
      { name: "SANS SEC547 Defending Product Supply Chains", url: "https://www.sans.org/cyber-security-courses/sec547" },
      { name: "Snyk Secure Software Supply Chain", url: "https://snyk.io/learn/" },
    ],
    status: "pending_review",
    createdAt: ts("2026-05-16"),
    closestExistingCourses: [{ course: mockCourses[6], similarity: 0.68 }],
  },
  {
    id: "sg-2026-05-16-005",
    runId: TODAY_RUN,
    title: "ESG Reporting under EU CSRD for Finance Leaders",
    category: "ESG & Sustainability",
    proposedSubcategory: "CSRD & Disclosure",
    rationale:
      "CSRD's 2026 phase-in puts mid-cap companies under disclosure obligations for the first time. Edstellar's one ESG course covers operations broadly; a CFO-focused CSRD program would fill a specific, time-bound gap.",
    targetAudience: "CFOs, Finance directors, Sustainability leads",
    durationDays: 2,
    deliveryFormat: "instructor-led",
    suggestedPriceUsd: 3300,
    priceBasis:
      "EFRAG-aligned CSRD trainings from PwC Academy and KPMG Business School run $3,100–$3,500 for two-day formats.",
    references: [
      { name: "PwC Academy CSRD Training", url: "https://www.pwc.com/academy/" },
      { name: "KPMG Business School ESG Programs", url: "https://kpmg.com/businessschool/" },
      { name: "EFRAG ESRS Implementation Guidance", url: "https://www.efrag.org/" },
    ],
    status: "pending_review",
    createdAt: ts("2026-05-16"),
    closestExistingCourses: [{ course: mockCourses[13], similarity: 0.64 }],
  },
  {
    id: "sg-2026-05-16-006",
    runId: TODAY_RUN,
    title: "Platform Engineering for Internal Developer Experience",
    category: "DevOps",
    proposedSubcategory: "Platform & IDP",
    rationale:
      "Platform engineering replaced 'DevOps team' in most enterprise org charts in 2025. Edstellar's Kubernetes course covers a slice; this proposal addresses the wider IDP, golden-path, and developer-experience program design space.",
    targetAudience: "Platform engineering leads, SRE managers, Engineering directors",
    durationDays: 3,
    deliveryFormat: "instructor-led",
    suggestedPriceUsd: 3500,
    priceBasis:
      "Humanitec, Backstage Open Community, and Syntasso run cohort programs in the $3,200–$3,800 range.",
    references: [
      { name: "Humanitec Platform Engineering Training", url: "https://humanitec.com/learn" },
      { name: "Syntasso Platform-as-a-Product Workshop", url: "https://syntasso.io/training" },
      { name: "Backstage.io Community Workshops", url: "https://backstage.io/" },
    ],
    status: "pending_review",
    createdAt: ts("2026-05-16"),
    closestExistingCourses: [{ course: mockCourses[16], similarity: 0.73 }],
  },
];

export const mockTodaysRun = {
  id: TODAY_RUN,
  startedAt: "2026-05-16T00:05:00.000Z",
  finishedAt: "2026-05-16T00:43:00.000Z",
  modelUsed: "deepseek/deepseek-v3.2-exp",
  promptVersionId: "pv-014",
  categoriesTargeted: [
    "Data Privacy and Security",
    "Generative AI for Business",
    "Cloud Computing",
    "Cybersecurity",
    "ESG & Sustainability",
    "DevOps",
  ],
  candidatesProduced: 28,
  candidatesPersisted: 6,
  approvalRate: null,
};

/**
 * Index of all suggestions ever (today + historical) so /history and
 * /suggestions/[id] both have something to render.
 */
export const mockAllSuggestions: Suggestion[] = [
  ...mockTodaysSuggestions,
  // Historical (Phase 1 stub — Phase 5 reads from `feedback` join)
  {
    id: "sg-2026-05-15-001",
    runId: "run-2026-05-15",
    title: "AI-Driven Customer Support Operations",
    category: "Customer Experience",
    proposedSubcategory: "AI Operations",
    rationale: "Approved last week.",
    targetAudience: "Support directors, CX leaders",
    durationDays: 2,
    deliveryFormat: "instructor-led",
    suggestedPriceUsd: 3100,
    priceBasis: "Three benchmark vendors at $2,900–$3,300.",
    references: [
      { name: "Forrester CX Research", url: "https://forrester.com/" },
      { name: "Gartner CX Conference", url: "https://gartner.com/" },
      { name: "Zendesk Training", url: "https://www.zendesk.com/training/" },
    ],
    status: "approved",
    createdAt: "2026-05-15T07:23:00.000Z",
  },
  {
    id: "sg-2026-05-14-002",
    runId: "run-2026-05-14",
    title: "CIPP/E European Privacy Certification Prep",
    category: "Data Privacy and Security",
    proposedSubcategory: "Certification",
    rationale: "Rejected — used certifying-body credential name.",
    targetAudience: "Privacy professionals",
    durationDays: 3,
    deliveryFormat: "instructor-led",
    suggestedPriceUsd: 3500,
    priceBasis: "IAPP benchmark.",
    references: [
      { name: "IAPP CIPP/E", url: "https://iapp.org/certify/cippe/" },
      { name: "InfoSec Privacy Training", url: "https://www.infosectrain.com/" },
      { name: "Skillsoft Compliance Courses", url: "https://www.skillsoft.com/" },
    ],
    status: "rejected",
    createdAt: "2026-05-14T07:23:00.000Z",
  },
  {
    id: "sg-2026-05-13-003",
    runId: "run-2026-05-13",
    title: "Quantum Computing for Strategic Leaders",
    category: "Quantum Computing",
    proposedSubcategory: "Executive Briefing",
    rationale: "Rejected — audience too small to justify a B2B program.",
    targetAudience: "CTOs, Innovation leads",
    durationDays: 1,
    deliveryFormat: "instructor-led",
    suggestedPriceUsd: 3000,
    priceBasis: "IBM Quantum Leadership Program benchmark.",
    references: [
      { name: "IBM Quantum Network", url: "https://www.ibm.com/quantum-network" },
      { name: "MIT xPRO Quantum Programs", url: "https://xpro.mit.edu/" },
      { name: "QuEra Computing", url: "https://www.quera.com/" },
    ],
    status: "rejected",
    createdAt: "2026-05-13T07:23:00.000Z",
  },
  {
    id: "sg-2026-05-12-004",
    runId: "run-2026-05-12",
    title: "Negotiation Skills for Procurement Teams",
    category: "Negotiation Skills",
    proposedSubcategory: "Procurement",
    rationale: "Needs revision — pitch at senior buyers, not generalists.",
    targetAudience: "Procurement managers",
    durationDays: 2,
    deliveryFormat: "instructor-led",
    suggestedPriceUsd: 2800,
    priceBasis: "Three procurement-skills programs at $2,600–$3,000.",
    references: [
      { name: "CIPS Procurement Training", url: "https://www.cips.org/" },
      { name: "ISM Negotiation Programs", url: "https://www.ismworld.org/" },
      { name: "Kellogg Executive Negotiation", url: "https://www.kellogg.northwestern.edu/executive-education.aspx" },
    ],
    status: "needs_revision",
    createdAt: "2026-05-12T07:23:00.000Z",
  },
];
