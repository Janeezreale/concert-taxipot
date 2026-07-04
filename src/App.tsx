import {
  ArrowLeft,
  CalendarDays,
  CircleDot,
  MoreHorizontal,
} from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { findOtherCategory, inferCategoryId } from "./categoryMatcher";
import {
  inferTaxiPotDirection,
  resolveTaxiPotDirection,
} from "./directionMatcher";
import {
  loadConcertCategories,
  loadTaxiPots,
  saveTaxiPot,
  trackOpenChatClick,
} from "./storage";
import type {
  ConcertCategory,
  Screen,
  TaxiPot,
  TaxiPotDirectionFilter,
  TaxiPotFormValues,
} from "./types";

const TIME_PRESETS = [
  "13:00",
  "13:30",
  "14:00",
  "14:30",
  "18:00",
  "18:30",
  "19:00",
  "21:30",
  "22:00",
];
const ALL_CATEGORIES_ID = "all";
const LOADING_SCREEN_MIN_MS = 1500;
const loadingImageUrl = new URL("../logo.png", import.meta.url).href;
const DIRECTION_FILTERS: Array<{
  id: TaxiPotDirectionFilter;
  label: string;
}> = [
  { id: "all", label: "ALL" },
  { id: "in", label: "IN" },
  { id: "out", label: "OUT" },
];

const defaultForm: TaxiPotFormValues = {
  categoryId: "",
  concertTitle: "",
  origin: "",
  destination: "",
  date: "",
  time: "",
  openChatUrl: "",
};

const formatDateTime = (date: string, time: string) => {
  const [, month, day] = date.split("-");
  return `${Number(month)}/${Number(day)} ${time}`;
};

const createTaxiPotId = () => {
  if ("crypto" in window && "randomUUID" in window.crypto) {
    return window.crypto.randomUUID();
  }

  return `taxi-pot-${Date.now()}`;
};

const isValidUrl = (value: string) => {
  try {
    const url = new URL(value);
    return url.protocol === "https:";
  } catch {
    return false;
  }
};

const getUrlHost = (value: string) => {
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return "";
  }
};

const isKakaoOpenChatUrl = (value: string) => {
  const host = getUrlHost(value);
  return host === "open.kakao.com";
};

const isXUrl = (value: string) => {
  const host = getUrlHost(value);
  return (
    host === "x.com" ||
    host === "www.x.com" ||
    host === "twitter.com" ||
    host === "www.twitter.com"
  );
};

const getErrorMessage = (error: unknown) => {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "object" && error && "message" in error) {
    return String(error.message);
  }

  return "알 수 없는 오류";
};

function MobileShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="app-bg">
      <section className="phone-shell">{children}</section>
    </main>
  );
}

function LoadingScreen() {
  return (
    <div className="loading-screen" aria-label="로딩 중">
      <img className="loading-image" src={loadingImageUrl} alt="" />
    </div>
  );
}

function AppHeader({
  title,
  showBack = false,
  onBack,
}: {
  title: string;
  showBack?: boolean;
  onBack?: () => void;
}) {
  return (
    <header className="app-header">
      {showBack ? (
        <button
          className="icon-button"
          type="button"
          aria-label="뒤로가기"
          onClick={onBack}
        >
          <ArrowLeft size={22} strokeWidth={1.8} />
        </button>
      ) : (
        <div className="brand-mark" aria-hidden="true">
          T
        </div>
      )}
      <h1>{title}</h1>
    </header>
  );
}

function BottomActionButton({
  children,
  onClick,
  type = "button",
  disabled = false,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  type?: "button" | "submit";
  disabled?: boolean;
}) {
  return (
    <button
      className="bottom-action"
      type={type}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}

function ConcertSelectCard({
  selectedCategory,
  selectedCategoryId,
  onOpen,
}: {
  selectedCategory: ConcertCategory | undefined;
  selectedCategoryId: string;
  onOpen: () => void;
}) {
  return (
    <section
      className="concert-control"
      aria-labelledby="selected-concert-label"
    >
      <p id="selected-concert-label" className="section-label">
        콘서트 선택
      </p>
      <button className="selected-concert" type="button" onClick={onOpen}>
        <span>
          {selectedCategoryId === ALL_CATEGORIES_ID
            ? "전체"
            : (selectedCategory?.title ?? "전체")}
        </span>
        <MoreHorizontal size={23} aria-hidden="true" />
      </button>
    </section>
  );
}

function DirectionFilterTabs({
  value,
  onChange,
}: {
  value: TaxiPotDirectionFilter;
  onChange: (value: TaxiPotDirectionFilter) => void;
}) {
  return (
    <div className="direction-tabs" role="tablist" aria-label="택시팟 방향">
      {DIRECTION_FILTERS.map((filter) => (
        <button
          key={filter.id}
          className="direction-tab"
          type="button"
          role="tab"
          aria-selected={value === filter.id}
          onClick={() => onChange(filter.id)}
        >
          {filter.label}
        </button>
      ))}
    </div>
  );
}

function TaxiPotItem({ taxiPot }: { taxiPot: TaxiPot }) {
  const openChat = async () => {
    const isKakaoOpenChat = isKakaoOpenChatUrl(taxiPot.openChatUrl);
    const isXProfile = isXUrl(taxiPot.openChatUrl);

    if (isXProfile && !isKakaoOpenChat) {
      const shouldOpen = window.confirm(
        `출발지: ${taxiPot.origin}\n목적지: ${taxiPot.destination}\n\n오픈채팅 링크가 없습니다. 해당 사용자의 X 링크로 이동할까요?`,
      );

      if (!shouldOpen) return;
    } else {
      const shouldOpen = window.confirm(
        `출발지: ${taxiPot.origin}\n목적지: ${taxiPot.destination}\n\n이 택시팟의 오픈채팅 링크로 이동할까요?`,
      );

      if (!shouldOpen) return;
    }

    try {
      await trackOpenChatClick(taxiPot);
    } catch {
      // 로그 실패해도 사용자는 이동시킴
    }

    window.open(taxiPot.openChatUrl, "_blank", "noopener,noreferrer");
  };

  return (
    <article className="taxi-pot-item">
      <div className="route-icon" aria-hidden="true">
        <CircleDot size={15} strokeWidth={2.1} />
      </div>
      <div className="taxi-pot-body">
        <h2>
          {taxiPot.origin} → {taxiPot.destination}
        </h2>
        <p>{formatDateTime(taxiPot.date, taxiPot.time)}</p>
      </div>
      <button className="chat-button" type="button" onClick={openChat}>
        오픈채팅
      </button>
    </article>
  );
}

function HomeScreen({
  categories,
  selectedCategory,
  selectedCategoryId,
  selectedDirectionFilter,
  taxiPots,
  onOpenConcerts,
  onChangeDirectionFilter,
  onCreate,
}: {
  categories: ConcertCategory[];
  selectedCategory: ConcertCategory | undefined;
  selectedCategoryId: string;
  selectedDirectionFilter: TaxiPotDirectionFilter;
  taxiPots: TaxiPot[];
  onOpenConcerts: () => void;
  onChangeDirectionFilter: (filter: TaxiPotDirectionFilter) => void;
  onCreate: () => void;
}) {
  const visibleTaxiPots = useMemo(() => {
    const categoryById = new Map(
      categories.map((category) => [category.id, category]),
    );
    const categoryFilteredTaxiPots =
      selectedCategoryId === ALL_CATEGORIES_ID || !selectedCategory
        ? taxiPots
        : taxiPots.filter(
            (taxiPot) => taxiPot.categoryId === selectedCategory.id,
          );

    if (selectedDirectionFilter === "all") {
      return categoryFilteredTaxiPots;
    }

    return categoryFilteredTaxiPots.filter(
      (taxiPot) =>
        resolveTaxiPotDirection(
          taxiPot,
          categoryById.get(taxiPot.categoryId) ?? selectedCategory,
        ) === selectedDirectionFilter,
    );
  }, [
    categories,
    selectedCategory,
    selectedCategoryId,
    selectedDirectionFilter,
    taxiPots,
  ]);

  return (
    <>
      <AppHeader title="콘서트 택시팟" />
      <div className="screen-content home-content">
        <ConcertSelectCard
          selectedCategory={selectedCategory}
          selectedCategoryId={selectedCategoryId}
          onOpen={onOpenConcerts}
        />
        <DirectionFilterTabs
          value={selectedDirectionFilter}
          onChange={onChangeDirectionFilter}
        />
        <div className="list-divider" />
        <section className="taxi-pot-list" aria-label="택시팟 목록">
          {visibleTaxiPots.length > 0 ? (
            visibleTaxiPots.map((taxiPot) => (
              <TaxiPotItem key={taxiPot.id} taxiPot={taxiPot} />
            ))
          ) : (
            <p className="empty-state">조건에 맞는 택시팟이 없습니다.</p>
          )}
        </section>
      </div>
      <div className="fixed-action">
        <p className="delete-note">
          콘서트 분류 추가 혹은 팟 삭제는 관리자에게 문의바랍니다
        </p>
        <BottomActionButton onClick={onCreate}>
          + 택시팟 만들기
        </BottomActionButton>
      </div>
    </>
  );
}

function ConcertScreen({
  categories,
  selectedCategoryId,
  onBack,
  onSelect,
}: {
  categories: ConcertCategory[];
  selectedCategoryId: string;
  onBack: () => void;
  onSelect: (categoryId: string) => void;
}) {
  return (
    <>
      <AppHeader title="콘서트 선택" showBack onBack={onBack} />
      <div className="screen-content concert-list">
        <button
          className="concert-row"
          type="button"
          aria-pressed={selectedCategoryId === ALL_CATEGORIES_ID}
          onClick={() => onSelect(ALL_CATEGORIES_ID)}
        >
          <span className="bullet" />
          <span>전체</span>
        </button>
        {categories.map((category) => (
          <button
            key={category.id}
            className="concert-row"
            type="button"
            aria-pressed={selectedCategoryId === category.id}
            onClick={() => onSelect(category.id)}
          >
            <span className="bullet" />
            <span>{category.title}</span>
          </button>
        ))}
      </div>
    </>
  );
}

function FormField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="form-field">
      <span>{label}</span>
      {children}
    </label>
  );
}

function TimePresetPicker({
  value,
  onSelect,
}: {
  value: string;
  onSelect: (time: string) => void;
}) {
  return (
    <div className="time-presets" aria-label="빠른 시간 선택">
      {TIME_PRESETS.map((time) => (
        <button
          key={time}
          className="time-chip"
          type="button"
          aria-pressed={value === time}
          onClick={() => onSelect(time)}
        >
          {time}
        </button>
      ))}
    </div>
  );
}

function TaxiPotForm({
  categories,
  selectedCategory,
  onBack,
  onSubmit,
  isSaving = false,
}: {
  categories: ConcertCategory[];
  selectedCategory: ConcertCategory | undefined;
  onBack: () => void;
  onSubmit: (values: TaxiPotFormValues) => void;
  isSaving?: boolean;
}) {
  const [values, setValues] = useState<TaxiPotFormValues>({
    ...defaultForm,
    categoryId: selectedCategory?.id ?? categories[0]?.id ?? "",
    concertTitle:
      selectedCategory?.slug === "other" || !selectedCategory
        ? defaultForm.concertTitle
        : selectedCategory.title,
  });
  const [error, setError] = useState("");

  const updateField = (field: keyof TaxiPotFormValues, value: string) => {
    setValues((current) => ({ ...current, [field]: value }));
  };

  const updateConcertTitle = (value: string) => {
    setValues((current) => ({
      ...current,
      concertTitle: value,
      categoryId: inferCategoryId(value, categories),
    }));
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (
      !values.concertTitle.trim() ||
      !values.origin.trim() ||
      !values.destination.trim() ||
      !values.date ||
      !values.time ||
      !values.openChatUrl.trim()
    ) {
      setError("모든 항목을 입력해 주세요.");
      return;
    }

    if (!isValidUrl(values.openChatUrl.trim())) {
      setError("오픈채팅 링크는 https://로 시작하는 올바른 주소여야 합니다.");
      return;
    }

    const fallbackCategory = findOtherCategory(categories) ?? categories[0];
    const categoryId =
      values.categoryId ||
      inferCategoryId(values.concertTitle, categories) ||
      fallbackCategory?.id ||
      "";

    if (!categoryId) {
      setError(
        "콘서트 분류 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.",
      );
      return;
    }

    onSubmit({ ...values, categoryId });
  };

  return (
    <>
      <AppHeader title="콘서트 택시팟" showBack onBack={onBack} />
      <form className="screen-content taxi-form" onSubmit={handleSubmit}>
        <FormField label="콘서트">
          <input
            value={values.concertTitle}
            onChange={(event) => updateConcertTitle(event.target.value)}
          />
        </FormField>
        <FormField label="출발지">
          <input
            value={values.origin}
            onChange={(event) => updateField("origin", event.target.value)}
          />
        </FormField>
        <FormField label="목적지">
          <input
            value={values.destination}
            onChange={(event) => updateField("destination", event.target.value)}
          />
        </FormField>
        <FormField label="날짜">
          <div className="date-field">
            <input
              type="date"
              value={values.date}
              onChange={(event) => updateField("date", event.target.value)}
            />
            <CalendarDays size={22} aria-hidden="true" />
          </div>
        </FormField>
        <FormField label="시간">
          <input
            type="time"
            value={values.time}
            onChange={(event) => updateField("time", event.target.value)}
          />
        </FormField>
        <TimePresetPicker
          value={values.time}
          onSelect={(time) => updateField("time", time)}
        />
        <FormField label="오픈채팅 링크">
          <input
            value={values.openChatUrl}
            inputMode="url"
            placeholder="오픈채팅 링크를 첨부해 주세요"
            onChange={(event) => updateField("openChatUrl", event.target.value)}
          />
        </FormField>
        {error ? <p className="form-error">{error}</p> : null}
        <BottomActionButton type="submit" disabled={isSaving}>
          {isSaving ? "등록 중" : "등록하기"}
        </BottomActionButton>
      </form>
    </>
  );
}

export default function App() {
  const [screen, setScreen] = useState<Screen>("home");
  const [categories, setCategories] = useState<ConcertCategory[]>([]);
  const [selectedCategoryId, setSelectedCategoryId] =
    useState(ALL_CATEGORIES_ID);
  const [selectedDirectionFilter, setSelectedDirectionFilter] =
    useState<TaxiPotDirectionFilter>("all");
  const [taxiPots, setTaxiPots] = useState<TaxiPot[]>([]);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSavingTaxiPot, setIsSavingTaxiPot] = useState(false);

  const selectedCategory =
    selectedCategoryId === ALL_CATEGORIES_ID
      ? undefined
      : categories.find((category) => category.id === selectedCategoryId);

  const visibleTaxiPots = useMemo(() => {
    if (categories.length === 0) {
      return taxiPots;
    }

    return taxiPots.map((taxiPot) => {
      const matchingCategory = categories.find(
        (category) =>
          category.id === taxiPot.categoryId ||
          category.slug === taxiPot.categoryId,
      );

      return matchingCategory
        ? { ...taxiPot, categoryId: matchingCategory.id }
        : taxiPot;
    });
  }, [categories, taxiPots]);

  useEffect(() => {
    const loadingStartedAt = Date.now();
    let isMounted = true;
    let loadingTimeout: number | undefined;

    const loadData = async () => {
      try {
        const [nextCategories, nextTaxiPots] = await Promise.all([
          loadConcertCategories(),
          loadTaxiPots(),
        ]);

        if (!isMounted) {
          return;
        }

        setCategories(nextCategories);
        setSelectedCategoryId((current) => {
          if (
            current === ALL_CATEGORIES_ID ||
            nextCategories.some((category) => category.id === current)
          ) {
            return current;
          }
          return ALL_CATEGORIES_ID;
        });
        setTaxiPots(nextTaxiPots);
      } catch {
        if (isMounted) {
          setError("데이터를 불러오지 못했습니다.");
        }
      } finally {
        const elapsedMs = Date.now() - loadingStartedAt;
        const remainingMs = Math.max(LOADING_SCREEN_MIN_MS - elapsedMs, 0);

        loadingTimeout = window.setTimeout(() => {
          if (isMounted) {
            setIsLoading(false);
          }
        }, remainingMs);
      }
    };

    loadData();

    return () => {
      isMounted = false;

      if (loadingTimeout !== undefined) {
        window.clearTimeout(loadingTimeout);
      }
    };
  }, []);

  const createTaxiPot = async (values: TaxiPotFormValues) => {
    if (isSavingTaxiPot) {
      return;
    }

    const category = categories.find(
      (item) =>
        item.id === values.categoryId || item.slug === values.categoryId,
    );
    const taxiPot: TaxiPot = {
      id: createTaxiPotId(),
      categoryId: values.categoryId,
      concertTitle: values.concertTitle.trim(),
      origin: values.origin.trim(),
      destination: values.destination.trim(),
      date: values.date,
      time: values.time,
      openChatUrl: values.openChatUrl.trim(),
      direction: inferTaxiPotDirection(values, category),
    };

    try {
      setIsSavingTaxiPot(true);
      const nextTaxiPots = await saveTaxiPot(taxiPot, taxiPots);
      setTaxiPots(nextTaxiPots);
      setSelectedCategoryId(nextTaxiPots[0]?.categoryId ?? "");
      setError("");
      setScreen("home");
    } catch (saveError) {
      setError(`택시팟을 저장하지 못했습니다: ${getErrorMessage(saveError)}`);
    } finally {
      setIsSavingTaxiPot(false);
    }
  };

  return (
    <MobileShell>
      {isLoading ? <LoadingScreen /> : null}
      {error ? <p className="global-error">{error}</p> : null}
      {screen === "home" ? (
        <HomeScreen
          categories={categories}
          selectedCategory={selectedCategory}
          selectedCategoryId={selectedCategoryId}
          selectedDirectionFilter={selectedDirectionFilter}
          taxiPots={visibleTaxiPots}
          onOpenConcerts={() => setScreen("concerts")}
          onChangeDirectionFilter={setSelectedDirectionFilter}
          onCreate={() => setScreen("new")}
        />
      ) : null}
      {screen === "concerts" ? (
        <ConcertScreen
          categories={categories}
          selectedCategoryId={selectedCategoryId}
          onBack={() => setScreen("home")}
          onSelect={(categoryId) => {
            setSelectedCategoryId(categoryId);
            setScreen("home");
          }}
        />
      ) : null}
      {screen === "new" ? (
        <TaxiPotForm
          categories={categories}
          selectedCategory={selectedCategory}
          onBack={() => setScreen("home")}
          onSubmit={createTaxiPot}
          isSaving={isSavingTaxiPot}
        />
      ) : null}
    </MobileShell>
  );
}
