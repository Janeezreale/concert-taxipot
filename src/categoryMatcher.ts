import type { ConcertCategory } from "./types";

const COMMON_TOKENS = new Set([
  "2026",
  "2027",
  "in",
  "seoul",
  "concert",
  "tour",
  "live",
  "world",
  "club",
]);

const normalize = (value: string) =>
  value
    .toLowerCase()
    .replace(/[()[\]{}'"<>]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const tokenize = (value: string) =>
  normalize(value)
    .split(" ")
    .map((token) => token.trim())
    .filter(Boolean)
    .filter((token) => !COMMON_TOKENS.has(token));

export const findOtherCategory = (categories: ConcertCategory[]) =>
  categories.find((category) => category.slug === "other") ?? categories[categories.length - 1];

export const inferCategoryId = (title: string, categories: ConcertCategory[]) => {
  const normalizedTitle = normalize(title);
  const titleTokens = new Set(tokenize(title));
  const otherCategory = findOtherCategory(categories);

  const scoredCategories = categories
    .filter((category) => category.isActive && category.slug !== "other")
    .map((category) => {
      const keywords = category.keywords.map(normalize).filter(Boolean);
      const excludedKeywords = category.excludedKeywords.map(normalize).filter(Boolean);

      if (excludedKeywords.some((keyword) => normalizedTitle.includes(keyword))) {
        return { category, score: 0 };
      }

      const score = keywords.reduce((total, keyword) => {
        if (normalizedTitle.includes(keyword)) {
          return total + 2;
        }

        return titleTokens.has(keyword) ? total + 1 : total;
      }, 0);

      return { category, score };
    })
    .filter(({ score }) => score > 0)
    .sort((left, right) => right.score - left.score);

  if (scoredCategories.length === 0) {
    return otherCategory?.id ?? "";
  }

  const [best, second] = scoredCategories;
  if (second && best.score === second.score) {
    return otherCategory?.id ?? "";
  }

  return best.category.id;
};
