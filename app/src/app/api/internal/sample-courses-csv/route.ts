/**
 * GET /api/internal/sample-courses-csv
 *
 * Returns the canonical sample CSV for the /inventory bulk-upload
 * flow. Static content; no auth required (it's a template, not data).
 *
 * Sample shape matches docs/adding-courses.md §4 — keep them in sync
 * if the column set changes.
 */

import { NextResponse } from "next/server";

const SAMPLE_CSV = `num,name,category,subcategory,link
2001,Phishing Awareness Training,Cybersecurity,Threat Awareness,https://www.edstellar.com/course/phishing-awareness-training
2002,Effective Stakeholder Management,Leadership Communication,Communication,
,AWS Lambda for Enterprise Teams,Cloud Computing,,https://www.edstellar.com/course/aws-lambda-for-enterprise-teams
2003,"Negotiation Skills, Advanced",Sales,Influence,https://www.edstellar.com/course/negotiation-skills-advanced
`;

export function GET() {
  return new NextResponse(SAMPLE_CSV, {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition":
        'attachment; filename="course-agent-sample.csv"',
      // Templates rarely change — let CDN cache for a day, browser
      // 10 min. The data never depends on the request.
      "cache-control": "public, max-age=600, s-maxage=86400",
    },
  });
}
