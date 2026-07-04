import type { ConcertCategory, TaxiPot, TaxiPotDirection } from "./types";

const FALLBACK_VENUE_KEYWORDS = [
  "kspo dome",
  "kspo돔",
  "kspo",
  "케이스포돔",
  "체조경기장",
  "올림픽공원",
  "올림픽홀",
  "핸드볼경기장",
  "고척스카이돔",
  "고척 돔",
  "고척돔",
  "잠실실내체육관",
  "잠실 실내체육관",
  "잠실종합운동장",
  "상암월드컵경기장",
  "월드컵경기장",
  "인스파이어 아레나",
  "인스파이어",
  "무신사 개러지",
  "무신사개러지",
  "yes24 라이브홀",
  "예스24 라이브홀",
  "블루스퀘어",
  "벡스코",
  "킨텍스",
  "송도컨벤시아",
  "엑스코",
  "디오디아",
];

const normalizePlaceName = (value: string) =>
  value
    .toLowerCase()
    .replace(/[()[\]{}'"<>·.,]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const uniq = (values: string[]) => Array.from(new Set(values));

const getVenueKeywords = (category?: ConcertCategory) => {
  const categoryKeywords = [
    category?.venueName ?? "",
    ...(category?.venueAliases ?? []),
  ].filter(Boolean);

  return uniq([...categoryKeywords, ...FALLBACK_VENUE_KEYWORDS])
    .map(normalizePlaceName)
    .filter(Boolean);
};

const isConcertVenue = (place: string, category?: ConcertCategory) => {
  const normalizedPlace = normalizePlaceName(place);

  if (!normalizedPlace) {
    return false;
  }

  return getVenueKeywords(category).some((keyword) =>
    normalizedPlace.includes(keyword),
  );
};

export const inferTaxiPotDirection = (
  taxiPot: Pick<TaxiPot, "origin" | "destination">,
  category?: ConcertCategory,
): TaxiPotDirection => {
  const originIsVenue = isConcertVenue(taxiPot.origin, category);
  const destinationIsVenue = isConcertVenue(taxiPot.destination, category);

  if (!originIsVenue && destinationIsVenue) {
    return "in";
  }

  if (originIsVenue && !destinationIsVenue) {
    return "out";
  }

  return "unknown";
};

export const resolveTaxiPotDirection = (
  taxiPot: Pick<TaxiPot, "origin" | "destination" | "direction">,
  category?: ConcertCategory,
) => {
  if (taxiPot.direction === "in" || taxiPot.direction === "out") {
    return taxiPot.direction;
  }

  return inferTaxiPotDirection(taxiPot, category);
};
