import { supabase } from "./supabase";
import { findOtherCategory, inferCategoryId } from "./categoryMatcher";
import { defaultCategories, initialTaxiPots } from "./data";
import { inferTaxiPotDirection } from "./directionMatcher";
import type {
  ConcertCategory,
  TaxiPot,
  TaxiPotDirection,
  TaxiPotSaveSetting,
} from "./types";

const TAXI_POTS_STORAGE_KEY = "concert-taxipot:taxis";
const CATEGORIES_STORAGE_KEY = "concert-taxipot:categories";
const HIDDEN_SEED_TAXI_POT_IDS = new Set(["taxi-pot-1"]);

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
    venueName: category.venueName ?? fallback?.venueName,
    venueAliases: category.venueAliases ?? fallback?.venueAliases ?? [],
  };
};

const normalizeTaxiPot = (taxiPot: TaxiPot & { concertId?: string }) => ({
  ...taxiPot,
  categoryId: taxiPot.categoryId ?? taxiPot.concertId ?? "other",
  direction: taxiPot.direction ?? "unknown",
});

const isVisibleTaxiPot = (taxiPot: TaxiPot) =>
  !HIDDEN_SEED_TAXI_POT_IDS.has(taxiPot.id) &&
  !(
    taxiPot.seedKey !== undefined &&
    HIDDEN_SEED_TAXI_POT_IDS.has(taxiPot.seedKey)
  );

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
    )
      .map(normalizeTaxiPot)
      .filter(isVisibleTaxiPot);

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

const asString = (value: unknown) => {
  if (value === null || value === undefined) return "";
  return typeof value === "string" ? value : String(value);
};
const asNumber = (value: unknown) =>
  typeof value === "number" ? value : Number(value) || 0;
const asBoolean = (value: unknown) =>
  typeof value === "boolean" ? value : Boolean(value);
const asStringArray = (value: unknown) =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
const asTaxiPotDirection = (value: unknown): TaxiPotDirection =>
  value === "in" || value === "out" || value === "unknown" ? value : "unknown";

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
  venueName: asString(row.venue_name) || undefined,
  venueAliases: asStringArray(row.venue_aliases),
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
  direction: asTaxiPotDirection(row.direction),
  minPeople:
    row.min_people !== undefined
      ? asString(row.min_people)
      : row.minPeople !== undefined
        ? asString(row.minPeople)
        : undefined,
  maxPeople:
    row.max_people !== undefined
      ? asString(row.max_people)
      : row.maxPeople !== undefined
        ? asString(row.maxPeople)
        : undefined,
  estimatedFare:
    row.estimated_fare !== undefined
      ? asString(row.estimated_fare)
      : row.estimatedFare !== undefined
        ? asString(row.estimatedFare)
        : undefined,
  notes: row.notes !== undefined ? asString(row.notes) : undefined,
});

const safeParseInt = (value: string | undefined | null) => {
  if (!value) return null;
  const parsed = parseInt(value, 10);
  return isNaN(parsed) ? null : parsed;
};

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
  direction: taxiPot.direction,
  min_people: safeParseInt(taxiPot.minPeople),
  max_people: safeParseInt(taxiPot.maxPeople),
  estimated_fare: safeParseInt(taxiPot.estimatedFare),
  notes: taxiPot.notes || null,
});

const mapCategoryToSeedRow = (category: ConcertCategory) => ({
  slug: category.slug,
  title: category.title,
  sort_order: category.sortOrder,
  is_active: category.isActive,
  keywords: category.keywords,
  excluded_keywords: category.excludedKeywords,
  venue_name: category.venueName ?? null,
  venue_aliases: category.venueAliases,
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

const findCategoryByIdOrSlug = (
  categories: ConcertCategory[],
  categoryId: string,
) =>
  categories.find(
    (category) => category.id === categoryId || category.slug === categoryId,
  );

const loadDbTaxiPots = async () => {
  if (!supabase) {
    return null;
  }

  // 오늘 날짜 기준 이후의 택시팟만 조회합니다. (기존 active_taxi_pots 뷰 대체)
  const todayStr = new Date().toISOString().split("T")[0];

  const { data, error } = await supabase
    .from("taxi_pots")
    .select("*")
    .gte("date", todayStr)
    .order("date", { ascending: true })
    .order("time", { ascending: true });

  if (error || !data) {
    console.error("택시팟 로딩 중 오류 발생:", error);
    return null;
  }

  return data
    .map((row) => mapRowToTaxiPot(row as Record<string, unknown>))
    .filter(isVisibleTaxiPot);
};

const seedInitialTaxiPots = async () => {
  if (!supabase) {
    return false;
  }

  if (initialTaxiPots.length === 0) {
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

  const categories = await loadDbCategories();

  if (!categories || categories.length === 0) {
    throw new Error("Category not found");
  }

  const categoryId =
    findCategoryByIdOrSlug(categories, taxiPot.categoryId)?.id ||
    inferCategoryId(taxiPot.concertTitle, categories) ||
    findOtherCategory(categories)?.id ||
    "";

  if (!categoryId) {
    throw new Error("Category not found");
  }

  const category = findCategoryByIdOrSlug(categories, categoryId);

  const resolvedTaxiPot: TaxiPot = {
    ...taxiPot,
    categoryId,
    direction: inferTaxiPotDirection(taxiPot, category),
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
    event_type: "open_chat_click",
    taxi_pot_id: taxiPot.id,
    category_id: taxiPot.categoryId,
    open_chat_url: taxiPot.openChatUrl,
    concert_title: taxiPot.concertTitle,
    origin: taxiPot.origin,
    destination: taxiPot.destination,
    user_agent: navigator.userAgent,
    referrer: document.referrer || null,
  });
};

export const trackCreateTaxiPotClick = async ({
  categoryId,
  concertTitle,
}: {
  categoryId: string | null;
  concertTitle: string | null;
}) => {
  if (!supabase) return;

  await supabase.from("open_chat_click_logs").insert({
    event_type: "create_taxi_pot_click",
    taxi_pot_id: null,
    category_id: categoryId,
    open_chat_url: null,
    concert_title: concertTitle,
    origin: null,
    destination: null,
    user_agent: navigator.userAgent,
    referrer: document.referrer || null,
  });
};

/**
 * 익명 사용자 세션을 가져오거나 데이터베이스에 등록하는 함수입니다.
 */
export const ensureAnonymousUser = async (anonymousKey: string): Promise<{ id: string; display_name: string; phone: string; refund_account: string } | null> => {
  if (!supabase) return null;

  // 1. 기존 익명 사용자 정보가 있는지 확인
  const { data: existingUser, error: fetchError } = await supabase
    .from("anonymous_users")
    .select("id, display_name, phone, refund_account")
    .eq("anonymous_key", anonymousKey)
    .maybeSingle();

  if (fetchError) {
    console.error("익명 사용자 확인 중 오류 발생:", fetchError);
  }

  if (existingUser) {
    return {
      id: existingUser.id,
      display_name: existingUser.display_name || "",
      phone: existingUser.phone || "",
      refund_account: existingUser.refund_account || "",
    };
  }

  // 2. 존재하지 않으면 새로 생성
  const { data: newUser, error: insertError } = await supabase
    .from("anonymous_users")
    .insert({
      anonymous_key: anonymousKey,
    })
    .select("id, display_name, phone, refund_account")
    .single();

  if (insertError) {
    console.error("익명 사용자 생성 중 오류 발생:", insertError);
    return null;
  }

  return {
    id: newUser.id,
    display_name: newUser.display_name || "",
    phone: newUser.phone || "",
    refund_account: newUser.refund_account || "",
  };
};

/**
 * 익명 사용자의 연락처 및 계좌 기본 정보를 업데이트하는 함수입니다.
 */
export const updateAnonymousUserProfile = async (
  anonymousKey: string,
  profile: { displayName?: string; phone?: string; refundAccount?: string }
) => {
  if (!supabase) return;

  const updateData: Record<string, unknown> = {};
  if (profile.displayName !== undefined) updateData.display_name = profile.displayName;
  if (profile.phone !== undefined) updateData.phone = profile.phone;
  if (profile.refundAccount !== undefined) updateData.refund_account = profile.refundAccount;

  const { error } = await supabase
    .from("anonymous_users")
    .update(updateData)
    .eq("anonymous_key", anonymousKey);

  if (error) {
    console.error("익명 사용자 정보 업데이트 중 오류 발생:", error);
  }
};

/**
 * 택시팟 찜하기(likes) 리스트를 저장하는 함수입니다.
 */
export const insertTaxiPotLike = async (
  anonymousKey: string,
  anonymousUserId: string,
  taxiPotId: string,
  alertMinPeople?: number,
  alertPhone?: string
) => {
  if (!supabase) return;

  const { error } = await supabase
    .from("taxi_pot_saves")
    .upsert({
      anonymous_key: anonymousKey,
      anonymous_user_id: anonymousUserId || null,
      taxi_pot_id: taxiPotId,
      alert_min_people: alertMinPeople || null,
      alert_phone: alertPhone || null,
    }, {
      onConflict: "anonymous_key,taxi_pot_id"
    });

  if (error) {
    if (error.code === "42P10") {
      console.warn("Unique constraint missing on database, falling back to select-then-write");
      const { data: existing } = await supabase
        .from("taxi_pot_saves")
        .select("id")
        .eq("anonymous_key", anonymousKey)
        .eq("taxi_pot_id", taxiPotId)
        .maybeSingle();

      if (existing) {
        const { error: updateError } = await supabase
          .from("taxi_pot_saves")
          .update({
            anonymous_user_id: anonymousUserId || null,
            alert_min_people: alertMinPeople || null,
            alert_phone: alertPhone || null,
          })
          .eq("id", existing.id);
        if (updateError) {
          console.error("찜하기 업데이트 실패:", updateError);
        }
      } else {
        const { error: insertError } = await supabase
          .from("taxi_pot_saves")
          .insert({
            anonymous_key: anonymousKey,
            anonymous_user_id: anonymousUserId || null,
            taxi_pot_id: taxiPotId,
            alert_min_people: alertMinPeople || null,
            alert_phone: alertPhone || null,
          });
        if (insertError) {
          console.error("찜하기 생성 실패:", insertError);
        }
      }
    } else {
      console.error("찜하기 저장 중 오류 발생:", error);
    }
  }
};

/**
 * 택시팟 찜하기를 취소하는 함수입니다.
 */
export const deleteTaxiPotLike = async (anonymousKey: string, taxiPotId: string) => {
  if (!supabase) return;

  const { error } = await supabase
    .from("taxi_pot_saves")
    .delete()
    .eq("anonymous_key", anonymousKey)
    .eq("taxi_pot_id", taxiPotId);

  if (error) {
    console.error("찜하기 삭제 중 오류 발생:", error);
  }
};

/**
 * 해당 익명 사용자가 찜한 모든 택시팟 ID 목록을 로드하는 함수입니다.
 */
export const loadUserLikedPotIds = async (anonymousKey: string): Promise<string[]> => {
  if (!supabase) return [];

  const { data, error } = await supabase
    .from("taxi_pot_saves")
    .select("taxi_pot_id")
    .eq("anonymous_key", anonymousKey);

  if (error || !data) {
    console.error("사용자 찜 목록 로딩 실패:", error);
    return [];
  }

  return data.map((row: any) => row.taxi_pot_id);
};

/**
 * 해당 익명 사용자의 찜한 택시팟별 알림 설정을 로드하는 함수입니다.
 */
export const loadUserTaxiPotSaveSettings = async (
  anonymousKey: string,
): Promise<TaxiPotSaveSetting[]> => {
  if (!supabase) return [];

  const { data, error } = await supabase
    .from("taxi_pot_saves")
    .select("taxi_pot_id, alert_min_people, alert_phone")
    .eq("anonymous_key", anonymousKey);

  if (error || !data) {
    console.error("사용자 알림 설정 로딩 실패:", error);
    return [];
  }

  return data.map((row: any) => ({
    taxiPotId: row.taxi_pot_id,
    alertMinPeople:
      row.alert_min_people === null || row.alert_min_people === undefined
        ? undefined
        : Number(row.alert_min_people),
    alertPhone: row.alert_phone || undefined,
  }));
};

/**
 * 해당 익명 사용자가 이미 예약한 택시팟 ID 목록을 로드하는 함수입니다.
 */
export const loadUserReservedPotIds = async (
  anonymousKey: string,
): Promise<string[]> => {
  if (!supabase) return [];

  const { data, error } = await supabase
    .from("taxi_pot_reservations")
    .select("taxi_pot_id")
    .eq("anonymous_key", anonymousKey)
    .in("status", ["submitted", "deposit_confirmed", "joined_chat"]);

  if (error || !data) {
    console.error("사용자 예약 목록 로딩 실패:", error);
    return [];
  }

  return Array.from(new Set(data.map((row: any) => row.taxi_pot_id)));
};

/**
 * 각 택시팟별 실시간 찜하기(좋아요) 수 목록을 로드하는 함수입니다.
 */
export const loadAllTaxiPotLikeCounts = async (): Promise<Record<string, number>> => {
  if (!supabase) return {};

  const counts: Record<string, number> = {};

  // 데이터베이스의 모든 택시팟 ID를 가져와 기본값 0으로 초기화합니다.
  const { data: potsData } = await supabase
    .from("taxi_pots")
    .select("id");

  if (potsData) {
    potsData.forEach((pot: any) => {
      counts[pot.id] = 0;
    });
  }

  const { data, error } = await supabase
    .from("taxi_pot_saves")
    .select("taxi_pot_id");

  if (error || !data) {
    console.error("전체 찜 개수 로딩 실패:", error);
    return counts;
  }

  data.forEach((row: any) => {
    if (counts[row.taxi_pot_id] !== undefined) {
      counts[row.taxi_pot_id]++;
    } else {
      counts[row.taxi_pot_id] = 1;
    }
  });
  return counts;
};

/**
 * 택시팟 탑승 예약을 저장하는 함수입니다.
 */
export const createTaxiPotReservation = async (
  anonymousKey: string,
  _anonymousUserId: string,
  reservation: {
    taxiPotId: string;
    depositorName: string;
    depositorPhone: string;
    refundAccount: string;
    expectedFare: number;
    depositAmount: number;
    expectedRefund: number;
  }
) => {
  let resolvedAnonymousUserId: string | null = null;

  if (supabase) {
    const { data: currentUser, error: userError } = await supabase
      .from("anonymous_users")
      .select("id")
      .eq("anonymous_key", anonymousKey)
      .maybeSingle();

    if (userError) {
      console.error("예약 사용자 확인 중 오류 발생:", userError);
    } else {
      resolvedAnonymousUserId = currentUser?.id ?? null;
    }
  }

  const localRes = {
    id: Math.random().toString(36).substring(2, 9),
    taxi_pot_id: reservation.taxiPotId,
    anonymous_user_id: resolvedAnonymousUserId,
    anonymous_key: anonymousKey,
    depositor_name: reservation.depositorName,
    depositor_phone: reservation.depositorPhone,
    refund_account: reservation.refundAccount,
    expected_fare: reservation.expectedFare,
    deposit_amount: reservation.depositAmount,
    expected_refund: reservation.expectedRefund,
    status: "submitted",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  if (supabase) {
    const { error } = await supabase
      .from("taxi_pot_reservations")
      .insert({
        taxi_pot_id: reservation.taxiPotId,
        anonymous_user_id: resolvedAnonymousUserId,
        anonymous_key: anonymousKey,
        depositor_name: reservation.depositorName,
        depositor_phone: reservation.depositorPhone,
        refund_account: reservation.refundAccount,
        expected_fare: reservation.expectedFare,
        deposit_amount: reservation.depositAmount,
        expected_refund: reservation.expectedRefund,
        status: "submitted",
      });

    if (error) {
      console.error("예약 생성 중 오류 발생:", error);
      throw error;
    }
  }

  try {
    const raw = localStorage.getItem("concert-taxipot:reservations");
    const current = raw ? JSON.parse(raw) : [];
    current.push(localRes);
    localStorage.setItem("concert-taxipot:reservations", JSON.stringify(current));
  } catch (e) {
    console.error("Local reservation save failed:", e);
  }
};

/**
 * 해당 익명 사용자의 모든 탑승 예약 내역(택시팟 정보 포함)을 가져오는 함수입니다.
 */
export const loadUserReservations = async (
  anonymousKey: string,
): Promise<any[]> => {
  if (!supabase) {
    try {
      const raw = localStorage.getItem("concert-taxipot:reservations") || "[]";
      const localReservations = JSON.parse(raw);
      const taxiPots = fromTaxiPotStorage();
      return localReservations
        .filter((res: any) => res.anonymous_key === anonymousKey)
        .map((res: any) => ({
          id: res.id,
          taxiPotId: res.taxi_pot_id,
          anonymousUserId: res.anonymous_user_id,
          anonymousKey: res.anonymous_key,
          depositorName: res.depositor_name,
          depositorPhone: res.depositor_phone,
          refundAccount: res.refund_account,
          expectedFare: res.expected_fare,
          depositAmount: res.deposit_amount,
          expectedRefund: res.expected_refund,
          status: res.status,
          createdAt: res.created_at,
          updatedAt: res.updated_at,
          taxi_pot: taxiPots.find((pot) => pot.id === res.taxi_pot_id) || null,
        }))
        .sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    } catch (e) {
      console.error("오프라인 예약 내역 조회 실패:", e);
      return [];
    }
  }

  const { data, error } = await supabase
    .from("taxi_pot_reservations")
    .select(`
      *,
      taxi_pots (
        *
      )
    `)
    .eq("anonymous_key", anonymousKey)
    .order("created_at", { ascending: false });

  if (error || !data) {
    console.error("사용자 예약 목록 로딩 실패:", error);
    return [];
  }

  return data.map((row: any) => {
    let taxiPot = null;
    if (row.taxi_pots) {
      taxiPot = mapRowToTaxiPot(row.taxi_pots);
    }
    return {
      id: row.id,
      taxiPotId: row.taxi_pot_id,
      anonymousUserId: row.anonymous_user_id,
      anonymousKey: row.anonymous_key,
      depositorName: row.depositor_name,
      depositorPhone: row.depositor_phone,
      refundAccount: row.refund_account,
      expectedFare: row.expected_fare,
      depositAmount: row.deposit_amount,
      expectedRefund: row.expected_refund,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      taxi_pot: taxiPot,
    };
  });
};

/**
 * 예약 상태를 업데이트하는 함수입니다. (관리자 확인 처리용 테스트)
 */
export const updateReservationStatus = async (
  reservationId: string,
  status: string,
): Promise<void> => {
  try {
    const raw = localStorage.getItem("concert-taxipot:reservations") || "[]";
    const localReservations = JSON.parse(raw);
    const index = localReservations.findIndex((r: any) => r.id === reservationId);
    if (index !== -1) {
      localReservations[index].status = status;
      localReservations[index].updated_at = new Date().toISOString();
      localStorage.setItem("concert-taxipot:reservations", JSON.stringify(localReservations));
    }
  } catch (e) {
    console.error("Local reservation update failed:", e);
  }

  if (!supabase) return;

  const { error } = await supabase
    .from("taxi_pot_reservations")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", reservationId);

  if (error) {
    console.error("예약 상태 업데이트 중 오류 발생:", error);
    throw error;
  }
};
