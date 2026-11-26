// NIAT Academic Programs & Campuses Catalog
// Used by the public admissions form, lead management, and filters.
export const PRODUCT_GROUPS: { label: string; products: string[] }[] = [
  {
    label: "Undergraduate Technology Programs",
    products: [
      "B.Tech Computer Science & AI",
      "B.Tech Artificial Intelligence & Machine Learning",
      "B.Tech Data Science",
      "B.Tech Robotics & Autonomous Systems",
      "B.Tech Computer Science & Engineering",
      "B.Tech Electronics & Intelligent Hardware",
      "Industry 5.0 Upskilling Programme",
    ],
  },
  {
    label: "Collaborating Hyderabad Campuses",
    products: [
      "Chaitanya Deemed University (Hyderabad)",
      "Aurora Deemed University (Hyderabad)",
      "SMR University (Hyderabad)",
      "Collaborating Campuses (15+ Cities)",
    ],
  },
  {
    label: "Admissions & Assessments",
    products: [
      "NAT Entrance Assessment (₹1,200)",
      "1-on-1 Career Counselling Session",
      "Campus Visit & Lab Tour",
    ],
  },
]

export const COMMON_LOAN_TYPES = [
  "B.Tech Computer Science & AI",
  "B.Tech Artificial Intelligence & Machine Learning",
  "B.Tech Data Science",
  "B.Tech Robotics & Autonomous Systems",
  "B.Tech Computer Science & Engineering",
  "Chaitanya Deemed University",
  "Aurora Deemed University",
  "SMR University",
  "NAT Entrance Assessment",
]

export const LOAN_TYPES = PRODUCT_GROUPS.flatMap((g) => g.products)
