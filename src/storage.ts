import { supabase } from "./supabase";
import { findOtherCategory, inferCategoryId } from "./categoryMatcher";
import { defaultCategories, initialTaxiPots } from "./data";
import type { ConcertCategory, TaxiPot } from "./types";

const TAXI_POTS_STORAGE_KEY = "concert-taxipot:taxis";
const CATEGORIES_STORAGE_KEY = "concert-taxipot:categories";

const sortCategories = (categories: ConcertCategory[]) =>
  [...categories]
    .filter((category) => category.isActive)
    .sort(
      (left, right) =>
        left.sortOrder - right.sortOrder ||
        left.title.localeCompare(right.title),
    );

const normalizeCategory = (
  category: Partial<ConcertCategory>,
): ConcertCategory => {
  const fallback = defaultCategories.find(
    (item) => item.slug === category.slug || item.id === category.id,
  );

  return {
    id: category.id ?? fallback?.id ?? "",
    slug: category.slug ?? fallback?.slug ?? "",
    title: category.title ?? fallback?.title ?? "",
    sortOrder: category.sortOrder ?? fallback?.sortOrder ?? 0,
    isActive: category.isActive ?? fallback?.isActive ?? true,
    keywords: category.keywords ?? fallback?.keywords ?? [],
    excludedKeywords:
      category.excludedKeywords ?? fallback?.excludedKeywords ?? [],
  };
};

const normalizeTaxiPot = (taxiPot: TaxiPot & { concertId?: string }) => ({
  ...taxiPot,
  categoryId: taxiPot.categoryId ?? taxiPot.concertId ?? "other",
});

const fromTaxiPotStorage = () => {
  const raw = localStorage.getItem(TAXI_POTS_STORAGE_KEY);
  if (!raw) {
    localStorage.setItem(
      TAXI_POTS_STORAGE_KEY,
      JSON.stringify(initialTaxiPots),
    );
    return initialTaxiPots;
  }

  try {
    const taxiPots = (
      JSON.parse(raw) as Array<TaxiPot & { concertId?: string }>
    ).map(normalizeTaxiPot);

    if (taxiPots.length === 0) {
      localStorage.setItem(
        TAXI_POTS_STORAGE_KEY,
        JSON.stringify(initialTaxiPots),
      );
      return initialTaxiPots;
    }

    return taxiPots;
  } catch {
    localStorage.setItem(
      TAXI_POTS_STORAGE_KEY,
      JSON.stringify(initialTaxiPots),
    );
    return initialTaxiPots;
  }
};

const toTaxiPotStorage = (taxiPots: TaxiPot[]) => {
  localStorage.setItem(TAXI_POTS_STORAGE_KEY, JSON.stringify(taxiPots));
};

const fromCategoryStorage = () => {
  const raw = localStorage.getItem(CATEGORIES_STORAGE_KEY);
  if (!raw) {
    localStorage.setItem(
      CATEGORIES_STORAGE_KEY,
      JSON.stringify(defaultCategories),
    );
    return defaultCategories;
  }

  try {
    const categories = sortCategories(
      (JSON.parse(raw) as Partial<ConcertCategory>[]).map(normalizeCategory),
    );

    if (categories.length === 0) {
      localStorage.setItem(
        CATEGORIES_STORAGE_KEY,
        JSON.stringify(defaultCategories),
      );
      return defaultCategories;
    }

    return categories;
  } catch {
    localStorage.setItem(
      CATEGORIES_STORAGE_KEY,
      JSON.stringify(defaultCategories),
    );
    return defaultCategories;
  }
};

const toCategoryStorage = (categories: ConcertCategory[]) => {
  localStorage.setItem(CATEGORIES_STORAGE_KEY, JSON.stringify(categories));
};

const asString = (value: unknown) => (typeof value === "string" ? value : "");
const asNumber = (value: unknown) =>
  typeof value === "number" ? value : Number(value) || 0;
const asBoolean = (value: unknown) =>
  typeof value === "boolean" ? value : Boolean(value);
const asStringArray = (value: unknown) =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];

const isUuid = (value: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );

const mapRowToCategory = (row: Record<string, unknown>): ConcertCategory => ({
  id: asString(row.id),
  slug: asString(row.slug),
  title: asString(row.title),
  sortOrder: asNumber(row.sort_order),
  isActive: row.is_active === undefined ? true : asBoolean(row.is_active),
  keywords: asStringArray(row.keywords),
  excludedKeywords: asStringArray(row.excluded_keywords),
});

const mapRowToTaxiPot = (row: Record<string, unknown>): TaxiPot => ({
  id: asString(row.id),
  seedKey: asString(row.seed_key) || undefined,
  categoryId: asString(row.category_id || row.concert_id || "other"),
  concertTitle: asString(row.concert_title),
  origin: asString(row.origin),
  destination: asString(row.destination),
  date: asString(row.date),
  time: asString(row.time).split(":").slice(0, 2).join(":"),
  openChatUrl: asString(row.open_chat_url),
  minPeople: row.min_people !== undefined ? asString(row.min_people) : (row.minPeople !== undefined ? asString(row.minPeople) : undefined),
  estimatedFare: row.estimated_fare !== undefined ? asString(row.estimated_fare) : (row.estimatedFare !== undefined ? asString(row.estimatedFare) : undefined),
  notes: row.notes !== undefined ? asString(row.notes) : undefined,
});

const mapTaxiPotToRow = (taxiPot: TaxiPot) => ({
  ...(isUuid(taxiPot.id) ? { id: taxiPot.id } : {}),
  ...(taxiPot.seedKey ? { seed_key: taxiPot.seedKey } : {}),
  category_id: taxiPot.categoryId,
  concert_title: taxiPot.concertTitle,
  origin: taxiPot.origin,
  destination: taxiPot.destination,
  date: taxiPot.date,
  time: taxiPot.time,
  open_chat_url: taxiPot.openChatUrl,
});

const mapCategoryToSeedRow = (category: ConcertCategory) => ({
  slug: category.slug,
  title: category.title,
  sort_order: category.sortOrder,
  is_active: category.isActive,
  keywords: category.keywords,
  excluded_keywords: category.excludedKeywords,
});

const mapCategoryToLegacySeedRow = (category: ConcertCategory) => ({
  slug: category.slug,
  title: category.title,
  sort_order: category.sortOrder,
  is_active: category.isActive,
  keywords: category.keywords,
});

const selectDbCategories = async () => {
  if (!supabase) {
    return null;
  }

  const client = supabase;
  const query = (columns: string) =>
    client
      .from("concert_categories")
      .select(columns)
      .eq("is_active", true)
      .order("sort_order", { ascending: true })
      .order("title", { ascending: true });

  const { data, error } = await query("*");

  if (!error && data) {
    return sortCategories(
      data.map((row) =>
        normalizeCategory(
          mapRowToCategory(row as unknown as Record<string, unknown>),
        ),
      ),
    );
  }

  const { data: legacyData, error: legacyError } = await query(
    "id, slug, title, sort_order, is_active, keywords",
  );

  if (legacyError || !legacyData) {
    return null;
  }

  return sortCategories(
    legacyData.map((row) =>
      normalizeCategory(
        mapRowToCategory(row as unknown as Record<string, unknown>),
      ),
    ),
  );
};

const seedDefaultCategories = async () => {
  if (!supabase) {
    return null;
  }

  const { error: insertError } = await supabase
    .from("concert_categories")
    .upsert(defaultCategories.map(mapCategoryToSeedRow), {
      ignoreDuplicates: true,
      onConflict: "slug",
    });

  if (insertError) {
    const { error: legacyInsertError } = await supabase
      .from("concert_categories")
      .upsert(defaultCategories.map(mapCategoryToLegacySeedRow), {
        ignoreDuplicates: true,
        onConflict: "slug",
      });

    if (legacyInsertError) {
      return null;
    }
  }

  const categories = await selectDbCategories();
  return categories && categories.length > 0 ? categories : null;
};

const loadDbCategories = async () => {
  if (!supabase) {
    return null;
  }

  const categories = await selectDbCategories();

  if (!categories) {
    return null;
  }

  if (categories.length === 0) {
    return seedDefaultCategories();
  }

  return categories;
};

const resolveTaxiPotCategoryId = async (taxiPot: TaxiPot) => {
  const categories = await loadDbCategories();

  if (!categories || categories.length === 0) {
    throw new Error("Category not found");
  }

  if (taxiPot.categoryId) {
    const selectedCategory = categories.find(
      (category) =>
        category.id === taxiPot.categoryId ||
        category.slug === taxiPot.categoryId,
    );

    if (selectedCategory) {
      return selectedCategory.id;
    }
  }

  const inferredCategoryId = inferCategoryId(taxiPot.concertTitle, categories);
  if (inferredCategoryId) {
    return inferredCategoryId;
  }

  const otherCategory = findOtherCategory(categories);
  if (otherCategory) {
    return otherCategory.id;
  }

  throw new Error("Category not found");
};

const loadDbTaxiPots = async () => {
  if (!supabase) {
    return null;
  }

  const { data, error } = await supabase
    .from("active_taxi_pots")
    .select("*")
    .order("date", { ascending: true })
    .order("time", { ascending: true });

  if (error || !data) {
    return null;
  }

  return data.map((row) => mapRowToTaxiPot(row as Record<string, unknown>));
};

const seedInitialTaxiPots = async () => {
  if (!supabase) {
    return false;
  }

  const categories = await loadDbCategories();
  if (!categories || categories.length === 0) {
    return false;
  }

  const categoryIdBySlug = new Map(
    categories.map((category) => [category.slug, category.id]),
  );
  const seedKeys = initialTaxiPots.map((taxiPot) => taxiPot.id);

  const { data: existingRows, error: existingError } = await supabase
    .from("taxi_pots")
    .select("seed_key")
    .in("seed_key", seedKeys);

  if (existingError) {
    return false;
  }

  const existingSeedKeys = new Set(
    (existingRows ?? [])
      .map((row) => asString((row as Record<string, unknown>).seed_key))
      .filter(Boolean),
  );

  const rows = initialTaxiPots
    .filter((taxiPot) => !existingSeedKeys.has(taxiPot.id))
    .map((taxiPot) => {
      const categoryId = categoryIdBySlug.get(taxiPot.categoryId);

      if (!categoryId) {
        return null;
      }

      return mapTaxiPotToRow({
        ...taxiPot,
        id: "",
        seedKey: taxiPot.id,
        categoryId,
      });
    })
    .filter((row): row is NonNullable<typeof row> => row !== null);

  if (rows.length === 0) {
    return true;
  }

  const { error } = await supabase.from("taxi_pots").insert(rows);

  if (error) {
    return false;
  }

  return true;
};

export const loadConcertCategories = async () => {
  if (!supabase) {
    return fromCategoryStorage();
  }

  const categories = await loadDbCategories();
  if (!categories) {
    return fromCategoryStorage();
  }

  toCategoryStorage(categories);
  return categories;
};

export const loadTaxiPots = async () => {
  if (!supabase) {
    return fromTaxiPotStorage();
  }

  const dbTaxiPots = await loadDbTaxiPots();

  if (!dbTaxiPots) {
    return fromTaxiPotStorage();
  }

  const didSeedTaxiPots = await seedInitialTaxiPots();

  if (didSeedTaxiPots) {
    const seededTaxiPots = await loadDbTaxiPots();

    if (seededTaxiPots) {
      toTaxiPotStorage(seededTaxiPots);
      return seededTaxiPots;
    }
  }

  if (dbTaxiPots.length === 0) {
    return fromTaxiPotStorage();
  }

  toTaxiPotStorage(dbTaxiPots);
  return dbTaxiPots;
};

export const saveTaxiPot = async (
  taxiPot: TaxiPot,
  currentTaxiPots: TaxiPot[],
) => {
  if (!supabase) {
    const nextTaxiPots = [taxiPot, ...currentTaxiPots];
    toTaxiPotStorage(nextTaxiPots);
    return nextTaxiPots;
  }

  const categoryId = await resolveTaxiPotCategoryId(taxiPot);

  const resolvedTaxiPot: TaxiPot = {
    ...taxiPot,
    categoryId,
  };

  const { error } = await supabase
    .from("taxi_pots")
    .insert(mapTaxiPotToRow(resolvedTaxiPot));

  if (error) {
    throw error;
  }

  const nextTaxiPots = [resolvedTaxiPot, ...currentTaxiPots];
  toTaxiPotStorage(nextTaxiPots);
  return nextTaxiPots;
};

export const trackOpenChatClick = async (taxiPot: TaxiPot) => {
  if (!supabase) return;

  await supabase.from("open_chat_click_logs").insert({
    taxi_pot_id: taxiPot.id,
    open_chat_url: taxiPot.openChatUrl,
    concert_title: taxiPot.concertTitle,
    origin: taxiPot.origin,
    destination: taxiPot.destination,
    user_agent: navigator.userAgent,
    referrer: document.referrer,
  });
};
