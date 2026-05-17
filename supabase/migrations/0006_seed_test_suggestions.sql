--
-- Migration 0006 — seed one synthetic agent_run + 10 pending suggestions.
--
-- Purpose: give Phase 5's review workflow something to click on. Phase 6
-- will start producing real rows via the engine; this seed exists purely
-- so two reviewers can drive the approve / reject / needs-revision UI
-- end-to-end while the engine is still being built.
--
-- Idempotent. Re-running is a no-op once the synthetic run id is present:
--   • agent_runs row is `on conflict (id) do nothing`
--   • each suggestion row is `on conflict (id) do nothing`
--
-- Audit query — find everything this migration inserted:
--   select * from "course-agent".agent_runs   where model_used = 'seed-data';
--   select * from "course-agent".suggestions
--    where run_id = '11111111-1111-1111-1111-111111111111';
--
-- All 10 suggestion rows satisfy the CHECK constraints from 0001:
--   • duration_days > 0
--   • delivery_format = 'instructor-led'
--   • suggested_price_usd > 2500
--   • jsonb_array_length("references") >= 3
-- Every `category` value is an exact match for a row already present in
-- "course-agent".categories so the FK resolves.
--

insert into "course-agent".agent_runs (
  id,
  started_at, finished_at,
  model_used,
  categories_targeted,
  candidates_produced, candidates_persisted
)
values (
  '11111111-1111-1111-1111-111111111111',
  now() - interval '6 hours',
  now() - interval '5 hours 30 minutes',
  'seed-data',
  array[
    'Data Privacy and Security',
    'Artificial Intelligence',
    'Cloud Computing',
    'Cybersecurity',
    'DevOps',
    'Project Management',
    'Risk Management',
    'Leadership Communication',
    'Data Analytics',
    'Workplace Diversity and Inclusion'
  ],
  10, 10
)
on conflict (id) do nothing;

insert into "course-agent".suggestions (
  id, run_id, title, rationale, category, proposed_subcategory,
  target_audience, duration_days, delivery_format,
  suggested_price_usd, price_basis, "references", status
)
values
  -- 1. Data Privacy and Security
  ('22222222-2222-2222-2222-222222222201',
   '11111111-1111-1111-1111-111111111111',
   'European Data Privacy & GDPR Compliance for Enterprise Teams',
   'Sustained Q4 demand from EU clients; existing catalogue under-supplied in this niche. Three B2B comparables run instructor-led 3-day variants at $2,900–$3,500.',
   'Data Privacy and Security', 'GDPR Compliance',
   'Mid-to-senior data, privacy, and legal practitioners',
   3, 'instructor-led', 3200,
   'Two market comparables at $2,900 and $3,400; both instructor-led 3-day.',
   '[
     {"name":"IAPP CIPP/E Body of Knowledge","url":"https://iapp.org/cert/cippe/"},
     {"name":"ICO GDPR Guide","url":"https://ico.org.uk/for-organisations/guide-to-data-protection/"},
     {"name":"EU Commission GDPR portal","url":"https://commission.europa.eu/law/law-topic/data-protection_en"}
   ]'::jsonb,
   'pending_review'),

  -- 2. Artificial Intelligence
  ('22222222-2222-2222-2222-222222222202',
   '11111111-1111-1111-1111-111111111111',
   'Generative AI Governance for the Enterprise',
   'Reviewer interest spike + regulatory pressure (EU AI Act, NIST AI RMF). Boards now demand defensible AI-use policies; no comparable program in the catalogue.',
   'Artificial Intelligence', 'Governance',
   'CTO office, IT risk, compliance leadership',
   2, 'instructor-led', 3800,
   'NIST AI RMF training providers price 2-day at $3,500–$4,000.',
   '[
     {"name":"NIST AI Risk Management Framework","url":"https://www.nist.gov/itl/ai-risk-management-framework"},
     {"name":"EU AI Act text","url":"https://artificialintelligenceact.eu/the-act/"},
     {"name":"ISO/IEC 42001 AI management","url":"https://www.iso.org/standard/81230.html"}
   ]'::jsonb,
   'pending_review'),

  -- 3. Cloud Computing
  ('22222222-2222-2222-2222-222222222203',
   '11111111-1111-1111-1111-111111111111',
   'Cloud Cost Optimisation for Engineering Leaders',
   'Cloud-bill anxiety is a CFO-level conversation now. No neutral, vendor-agnostic FinOps program in the existing catalogue.',
   'Cloud Computing', 'FinOps Leadership',
   'Engineering directors, Platform leads, FinOps practitioners',
   2, 'instructor-led', 2900,
   'FinOps Foundation-aligned cohort training runs $2,800–$3,100 for 2-day instructor-led.',
   '[
     {"name":"FinOps Foundation Training Catalogue","url":"https://www.finops.org/training/"},
     {"name":"AWS Cloud Financial Management","url":"https://aws.amazon.com/aws-cost-management/"},
     {"name":"State of FinOps 2025 Report","url":"https://www.finops.org/insights/state-of-finops/"}
   ]'::jsonb,
   'pending_review'),

  -- 4. Cybersecurity
  ('22222222-2222-2222-2222-222222222204',
   '11111111-1111-1111-1111-111111111111',
   'Secure Software Supply Chain for Engineering Teams',
   'Post-SolarWinds and post-Log4j, supply-chain attacks dominate enterprise threat models. Existing security courses cover appsec and cloud security; neither addresses SBOM, signed builds, or third-party risk programmatically.',
   'Cybersecurity', 'Supply Chain Security',
   'Security architects, DevSecOps engineers, Platform leads',
   3, 'instructor-led', 3400,
   'Three instructor-led offerings (Chainguard Academy, SANS SEC547, Snyk SecureFlag) cluster at $3,200–$3,600 for 3-day cohort.',
   '[
     {"name":"Chainguard Academy","url":"https://edu.chainguard.dev/"},
     {"name":"SANS SEC547 Defending Product Supply Chains","url":"https://www.sans.org/cyber-security-courses/sec547"},
     {"name":"NIST SSDF Practices","url":"https://csrc.nist.gov/Projects/ssdf"}
   ]'::jsonb,
   'pending_review'),

  -- 5. DevOps
  ('22222222-2222-2222-2222-222222222205',
   '11111111-1111-1111-1111-111111111111',
   'Platform Engineering for Internal Developer Experience',
   'Platform engineering replaced the "DevOps team" in most enterprise org charts during 2025. Existing K8s course covers a slice; this addresses IDP, golden-path, and developer-experience program design.',
   'DevOps', 'Platform & IDP',
   'Platform engineering leads, SRE managers, Engineering directors',
   3, 'instructor-led', 3500,
   'Humanitec, Syntasso, and Backstage community programs run $3,200–$3,800.',
   '[
     {"name":"Humanitec Platform Engineering Training","url":"https://humanitec.com/learn"},
     {"name":"Syntasso Platform-as-a-Product Workshop","url":"https://syntasso.io/training"},
     {"name":"CNCF Platforms White Paper","url":"https://tag-app-delivery.cncf.io/whitepapers/platforms/"}
   ]'::jsonb,
   'pending_review'),

  -- 6. Project Management
  ('22222222-2222-2222-2222-222222222206',
   '11111111-1111-1111-1111-111111111111',
   'Agile Transformation for Enterprise PMOs',
   'Mid-size enterprises are re-running Agile transformations after first-wave attempts stalled. PMO-led cohorts price 3-day instructor-led around $2,700–$3,200; nothing currently targets PMO directors specifically.',
   'Project Management', 'Agile Transformation',
   'PMO directors, Programme managers, Transformation leads',
   3, 'instructor-led', 2950,
   'Two comparable PMO-focused programs (PMI Disciplined Agile, ICAgile ICP-ENT) at $2,800–$3,100.',
   '[
     {"name":"PMI Disciplined Agile","url":"https://www.pmi.org/disciplined-agile"},
     {"name":"ICAgile ICP-ENT Curriculum","url":"https://www.icagile.com/certification/icp-ent-enterprise-coaching"},
     {"name":"SAFe for Lean Enterprises","url":"https://scaledagileframework.com/"}
   ]'::jsonb,
   'pending_review'),

  -- 7. Risk Management
  ('22222222-2222-2222-2222-222222222207',
   '11111111-1111-1111-1111-111111111111',
   'Operational Resilience under EU DORA',
   'DORA enforcement deadline (Jan 2025) put financial-services firms under explicit operational-resilience obligations. Existing risk course is generic; this targets the testing, third-party, and ICT-incident pillars of DORA specifically.',
   'Risk Management', 'Regulatory Resilience',
   'Heads of operational risk, ICT risk officers, BCM leads',
   2, 'instructor-led', 3600,
   'Two EU-focused DORA programs (PwC Risk Academy, Deloitte Resilience) price 2-day instructor-led at $3,400–$3,800.',
   '[
     {"name":"EU DORA Regulation 2022/2554","url":"https://eur-lex.europa.eu/eli/reg/2022/2554/oj"},
     {"name":"EBA DORA Guidelines","url":"https://www.eba.europa.eu/regulation-and-policy/operational-resilience"},
     {"name":"BIS Principles for Operational Resilience","url":"https://www.bis.org/bcbs/publ/d516.htm"}
   ]'::jsonb,
   'pending_review'),

  -- 8. Leadership Communication
  ('22222222-2222-2222-2222-222222222208',
   '11111111-1111-1111-1111-111111111111',
   'Difficult Conversations for Engineering Leaders',
   'Engineering managers ask for this more than any other soft-skills topic in 2025 internal surveys. The two existing leadership programs are general; this is engineering-context specific (perf reviews, layoffs, attrition risk).',
   'Leadership Communication', 'Performance Conversations',
   'Engineering managers, Tech leads moving to management',
   2, 'instructor-led', 2800,
   'Three comparable programs (Crucial Conversations, Bravely Coaching, Manager Tools) run 2-day at $2,600–$3,000.',
   '[
     {"name":"Crucial Conversations Methodology","url":"https://cruciallearning.com/crucial-conversations-for-mastering-dialogue/"},
     {"name":"HBR Tough Talks Playbook","url":"https://hbr.org/2016/01/how-to-handle-difficult-conversations-at-work"},
     {"name":"Radical Candor Framework","url":"https://www.radicalcandor.com/"}
   ]'::jsonb,
   'pending_review'),

  -- 9. Data Analytics
  ('22222222-2222-2222-2222-222222222209',
   '11111111-1111-1111-1111-111111111111',
   'Self-Service Analytics Governance for Data Teams',
   'Looker/Power BI sprawl is the new shadow IT. Existing analytics catalogue covers tooling; this targets the governance + semantic-layer discipline data leaders now need.',
   'Data Analytics', 'Analytics Governance',
   'Heads of analytics, Data platform leads, Analytics engineers',
   2, 'instructor-led', 3100,
   'Two governance-focused programs from dbt Labs and Atlan run 2-day at $2,900–$3,300.',
   '[
     {"name":"dbt Labs Analytics Governance Guide","url":"https://www.getdbt.com/analytics-engineering/transformation/governance"},
     {"name":"Atlan Data Governance Playbook","url":"https://atlan.com/data-governance/"},
     {"name":"DAMA-DMBOK Knowledge Areas","url":"https://www.dama.org/cpages/body-of-knowledge"}
   ]'::jsonb,
   'pending_review'),

  -- 10. Workplace Diversity and Inclusion
  ('22222222-2222-2222-2222-22222222220a',
   '11111111-1111-1111-1111-111111111111',
   'Inclusive Hiring for Hiring Managers',
   'Three Edstellar enterprise clients flagged hiring-manager training as a 2026 priority; the existing DEI course is HR-centric, not hiring-manager-specific. Two B2B comparables run instructor-led 2-day at $2,700–$3,000.',
   'Workplace Diversity and Inclusion', 'Inclusive Hiring',
   'Hiring managers, Recruiters, Talent acquisition leads',
   2, 'instructor-led', 2750,
   'Catalyst and Paradigm IQ run 2-day instructor-led programs at $2,600–$2,900.',
   '[
     {"name":"Catalyst Inclusive Leadership Research","url":"https://www.catalyst.org/research/inclusive-leadership/"},
     {"name":"Paradigm IQ Inclusive Hiring Curriculum","url":"https://www.paradigmiq.com/"},
     {"name":"SHRM Inclusive Recruiting Toolkit","url":"https://www.shrm.org/topics-tools/tools/toolkits"}
   ]'::jsonb,
   'pending_review')

on conflict (id) do nothing;
