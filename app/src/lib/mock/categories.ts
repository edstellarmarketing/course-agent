import type { Category } from "@/lib/types";

/**
 * Edstellar's 43 categories. Counts and demand scores are illustrative
 * stand-ins for what Phase 4 will compute from the live database.
 */
export const mockCategories: Category[] = [
  { id: "c-001", name: "Artificial Intelligence",       courseCount: 92, targetCount: 110, demandScore: 0.96, isPinned: true,  notes: null },
  { id: "c-002", name: "Cloud Computing",                courseCount: 78, targetCount: 100, demandScore: 0.91, isPinned: false, notes: null },
  { id: "c-003", name: "Data Science",                   courseCount: 64, targetCount: 90,  demandScore: 0.89, isPinned: false, notes: null },
  { id: "c-004", name: "Cybersecurity",                  courseCount: 58, targetCount: 95,  demandScore: 0.94, isPinned: true,  notes: "Pinned ahead of Q3 enterprise pipeline" },
  { id: "c-005", name: "Software Engineering",           courseCount: 121, targetCount: 130, demandScore: 0.74, isPinned: false, notes: null },
  { id: "c-006", name: "Project Management",             courseCount: 88, targetCount: 80,  demandScore: 0.68, isPinned: false, notes: null },
  { id: "c-007", name: "Leadership & Management",        courseCount: 102, targetCount: 95,  demandScore: 0.71, isPinned: false, notes: null },
  { id: "c-008", name: "Sales & Marketing",              courseCount: 64, targetCount: 75,  demandScore: 0.66, isPinned: false, notes: null },
  { id: "c-009", name: "Human Resources",                courseCount: 41, targetCount: 60,  demandScore: 0.62, isPinned: false, notes: null },
  { id: "c-010", name: "Finance & Accounting",           courseCount: 38, targetCount: 60,  demandScore: 0.70, isPinned: false, notes: null },
  { id: "c-011", name: "Operations & Supply Chain",      courseCount: 33, targetCount: 55,  demandScore: 0.73, isPinned: false, notes: null },
  { id: "c-012", name: "Data Privacy and Security",      courseCount: 19, targetCount: 50,  demandScore: 0.92, isPinned: true,  notes: "Under-supplied; GDPR demand sustained" },
  { id: "c-013", name: "DevOps",                         courseCount: 47, targetCount: 65,  demandScore: 0.82, isPinned: false, notes: null },
  { id: "c-014", name: "Machine Learning Operations",    courseCount: 12, targetCount: 40,  demandScore: 0.88, isPinned: false, notes: null },
  { id: "c-015", name: "Web Development",                courseCount: 81, targetCount: 70,  demandScore: 0.58, isPinned: false, notes: null },
  { id: "c-016", name: "Mobile Development",             courseCount: 39, targetCount: 50,  demandScore: 0.64, isPinned: false, notes: null },
  { id: "c-017", name: "UX & Design",                    courseCount: 36, targetCount: 50,  demandScore: 0.69, isPinned: false, notes: null },
  { id: "c-018", name: "Networking",                     courseCount: 28, targetCount: 45,  demandScore: 0.67, isPinned: false, notes: null },
  { id: "c-019", name: "Database Administration",        courseCount: 22, targetCount: 35,  demandScore: 0.59, isPinned: false, notes: null },
  { id: "c-020", name: "Quality Assurance & Testing",    courseCount: 31, targetCount: 40,  demandScore: 0.56, isPinned: false, notes: null },
  { id: "c-021", name: "Business Analysis",              courseCount: 27, targetCount: 45,  demandScore: 0.72, isPinned: false, notes: null },
  { id: "c-022", name: "Agile & Scrum",                  courseCount: 35, targetCount: 35,  demandScore: 0.61, isPinned: false, notes: null },
  { id: "c-023", name: "ITIL & Service Management",      courseCount: 17, targetCount: 30,  demandScore: 0.54, isPinned: false, notes: null },
  { id: "c-024", name: "Customer Experience",            courseCount: 14, targetCount: 35,  demandScore: 0.79, isPinned: false, notes: null },
  { id: "c-025", name: "Supply Chain Analytics",         courseCount: 9,  targetCount: 30,  demandScore: 0.83, isPinned: false, notes: null },
  { id: "c-026", name: "Manufacturing & Lean",           courseCount: 21, targetCount: 35,  demandScore: 0.60, isPinned: false, notes: null },
  { id: "c-027", name: "Healthcare & Pharma Compliance", courseCount: 11, targetCount: 35,  demandScore: 0.81, isPinned: false, notes: null },
  { id: "c-028", name: "ESG & Sustainability",           courseCount: 8,  targetCount: 30,  demandScore: 0.86, isPinned: true,  notes: "Strong growth across EU clients" },
  { id: "c-029", name: "Diversity, Equity & Inclusion",  courseCount: 16, targetCount: 30,  demandScore: 0.65, isPinned: false, notes: null },
  { id: "c-030", name: "Coaching & Mentoring",           courseCount: 19, targetCount: 30,  demandScore: 0.57, isPinned: false, notes: null },
  { id: "c-031", name: "Negotiation Skills",             courseCount: 13, targetCount: 25,  demandScore: 0.63, isPinned: false, notes: null },
  { id: "c-032", name: "Public Speaking",                courseCount: 11, targetCount: 25,  demandScore: 0.52, isPinned: false, notes: null },
  { id: "c-033", name: "Change Management",              courseCount: 22, targetCount: 30,  demandScore: 0.66, isPinned: false, notes: null },
  { id: "c-034", name: "Risk Management",                courseCount: 24, targetCount: 35,  demandScore: 0.74, isPinned: false, notes: null },
  { id: "c-035", name: "Compliance & Governance",        courseCount: 26, targetCount: 40,  demandScore: 0.77, isPinned: false, notes: null },
  { id: "c-036", name: "Blockchain & Web3",              courseCount: 7,  targetCount: 20,  demandScore: 0.42, isPinned: false, notes: "Demand cooling; low priority" },
  { id: "c-037", name: "Quantum Computing",              courseCount: 4,  targetCount: 15,  demandScore: 0.51, isPinned: false, notes: null },
  { id: "c-038", name: "Robotics & Automation",          courseCount: 13, targetCount: 30,  demandScore: 0.69, isPinned: false, notes: null },
  { id: "c-039", name: "IoT & Embedded Systems",         courseCount: 18, targetCount: 30,  demandScore: 0.61, isPinned: false, notes: null },
  { id: "c-040", name: "Game Development",               courseCount: 6,  targetCount: 15,  demandScore: 0.39, isPinned: false, notes: null },
  { id: "c-041", name: "Digital Marketing",              courseCount: 44, targetCount: 50,  demandScore: 0.72, isPinned: false, notes: null },
  { id: "c-042", name: "Content & Communications",       courseCount: 23, targetCount: 30,  demandScore: 0.55, isPinned: false, notes: null },
  { id: "c-043", name: "Generative AI for Business",     courseCount: 14, targetCount: 50,  demandScore: 0.97, isPinned: true,  notes: "Highest demand signal across regions" },
];

/**
 * Under-supply score: low course count × high demand × pin boost.
 * Larger = more under-supplied. Mirrors what Phase 4's view will compute.
 */
export function underSupplyScore(c: Category): number {
  if (c.targetCount == null || c.demandScore == null) return 0;
  const gap = Math.max(0, c.targetCount - c.courseCount);
  const pinBoost = c.isPinned ? 1.25 : 1;
  return gap * c.demandScore * pinBoost;
}
