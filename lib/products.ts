// Product catalog of Right Agent Group, taken from rightagentgroup.com
// (/loan, /insurances, /realestate — spelling normalized). Grouped the same
// way the site groups them. Used by the public application form and the
// dashboard lead forms/filters; `product_interest` on a lead holds one of
// these strings, so renaming an entry only affects new leads.
export const PRODUCT_GROUPS: { label: string; products: string[] }[] = [
  {
    label: "Loans",
    products: [
      "Home Loan",
      "Personal Loan",
      "Business Loan",
      "Mortgage Loan",
      "Loan Against Property",
      "Four Wheeler Loan",
      "House Renovation Loan",
      "Home Extension Loan",
      "Home Loan Balance Transfer",
      "Top Up Loan",
      "Home Loan Takeover Top Up",
      "Self Construction Loan",
      "Commercial Plot Loan",
      "Commercial Buildings Loan",
      "Residential Plot / Land Loan",
      "Apartment Flat Loan",
      "Independent House Loan",
      "Home Loan for Pensioners",
      "Home Loan for NRI",
    ],
  },
  {
    label: "Insurance",
    products: [
      "Health Insurance",
      "Term Life Insurance",
      "Accident Insurance",
      "Travel Insurance",
      "Corporate Insurance",
      "Savings Plan",
      "Retirement Plan",
      "Unit Linked Insurance (ULIP)",
      "Child Education Plan",
      "Endowment Plan",
      "Money Back Income Plan",
      "Wealth Creation Plan",
      "Protection Plan",
    ],
  },
  {
    label: "Real Estate",
    products: ["Property Purchase (Real Estate)", "Property Sale (Real Estate)"],
  },
]

export const LOAN_TYPES = PRODUCT_GROUPS.flatMap((g) => g.products)
