import type { ConcertCategory, TaxiPot } from "./types";

export const defaultCategories: ConcertCategory[] = [
  {
    id: "andteam-blaze",
    slug: "andteam-blaze",
    title: "2026 &TEAM CONCERT TOUR 'BLAZE THE WAY' in INCHEON",
    sortOrder: 3,
    isActive: true,
    keywords: ["&team", "andteam", "blaze"],
    excludedKeywords: [],
    venueName: "INSPIRE ARENA",
    venueAliases: [
      "인스파이어",
      "인천 인스파이어",
      "인스파이어 아레나",
      "inspire",
      "inspire arena",
    ],
  },
  {
    id: "other",
    slug: "other",
    title: "기타",
    sortOrder: 999,
    isActive: true,
    keywords: [],
    excludedKeywords: [],
    venueName: undefined,
    venueAliases: [],
  },
];

export const initialTaxiPots: TaxiPot[] = [];
