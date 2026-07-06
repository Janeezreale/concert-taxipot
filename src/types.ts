export type ConcertCategory = {
  id: string;
  slug: string;
  title: string;
  sortOrder: number;
  isActive: boolean;
  keywords: string[];
  excludedKeywords: string[];
  venueName?: string;
  venueAliases: string[];
};

export type TaxiPotDirection = "in" | "out" | "unknown";

export type TaxiPot = {
  id: string;
  seedKey?: string;
  categoryId: string;
  concertTitle: string;
  origin: string;
  destination: string;
  date: string;
  time: string;
  openChatUrl: string;
  direction: TaxiPotDirection;
  minPeople?: string;
  estimatedFare?: string;
  notes?: string;
};

export type TaxiPotDirectionFilter =
  | "all"
  | Exclude<TaxiPotDirection, "unknown">;

export type TaxiPotFormValues = {
  categoryId: string;
  concertTitle: string;
  origin: string;
  destination: string;
  date: string;
  time: string;
  openChatUrl: string;
  minPeople?: string;
  estimatedFare?: string;
  notes?: string;
};

export type Screen =
  | "home"
  | "concerts"
  | "new"
  | "details"
  | "deposit"
  | "saved"
  | "guide";
