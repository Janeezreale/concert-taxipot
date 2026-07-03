import {
  ArrowLeft,
  CalendarDays,
  CircleDot,
  MoreHorizontal,
  X,
  Copy,
  Menu,
  Bell,
  ChevronRight,
} from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { findOtherCategory, inferCategoryId } from "./categoryMatcher";
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
  TaxiPotFormValues,
} from "./types";

const ALL_CATEGORIES_ID = "all";

const defaultForm: TaxiPotFormValues = {
  categoryId: "",
  concertTitle: "",
  origin: "",
  destination: "",
  date: "2026-07-01",
  time: "18:00",
  openChatUrl: "https://open.kakao.com/o/...",
};

const formatDateTime = (date: string, time: string) => {
  const [, month, day] = date.split("-");
  const formattedTime = time ? time.split(":").slice(0, 2).join(":") : "";
  return `${Number(month)}/${Number(day)} ${formattedTime || time}`;
};

const getInOutLabel = (origin: string, destination: string): "IN" | "OUT" => {
  if (destination.includes("인스파이어")) {
    return "IN";
  }
  if (origin.includes("인스파이어")) {
    return "OUT";
  }
  const transitKeywords = ["역", "공항", "터미널", "정류장", "ktx", "KTX", "역무실"];
  const isOriginTransit = transitKeywords.some(kw => origin.includes(kw));
  const isDestTransit = transitKeywords.some(kw => destination.includes(kw));
  if (isOriginTransit && !isDestTransit) {
    return "IN";
  }
  if (isDestTransit && !isOriginTransit) {
    return "OUT";
  }
  return "IN";
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

function AppHeader({
  title,
  showBack = false,
  onBack,
  showMenuButton = false,
  onMenuClick,
}: {
  title: string;
  showBack?: boolean;
  onBack?: () => void;
  showMenuButton?: boolean;
  onMenuClick?: () => void;
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
      {showMenuButton && onMenuClick && (
        <button
          className="icon-button menu-toggle-btn"
          type="button"
          aria-label="메뉴 열기"
          onClick={onMenuClick}
        >
          <Menu size={22} strokeWidth={1.8} />
        </button>
      )}
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

const getCategoryColor = (categoryId: string, categories: ConcertCategory[]) => {
  const colors = [
    "#7f77dd", // Soft Purple / Indigo (Primary theme color)
    "#e88d9c", // Soft Coral / Rose
    "#6fa3ef", // Soft Sky / Blue
    "#5bc1a5", // Soft Teal / Green
    "#f5af5a", // Soft Gold / Amber
    "#c084fc", // Soft Lavender / Magenta
  ];

  const category = categories.find((c) => c.id === categoryId);
  if (!category) return colors[0];
  if (category.slug === "other") return "#8a8a8a"; // Muted grey for other/misc

  // Stable string hash of the slug
  const str = category.slug;
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  const index = Math.abs(hash) % colors.length;
  return colors[index];
};

const getMockViews = (id: string) => {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = id.charCodeAt(i) + ((hash << 5) - hash);
  }
  return (Math.abs(hash) % 75) + 12; // 12 ~ 86 views
};

const getMockFare = (origin: string, destination: string) => {
  const combined = origin + destination;
  let hash = 0;
  for (let i = 0; i < combined.length; i++) {
    hash = combined.charCodeAt(i) + ((hash << 5) - hash);
  }
  // Generate a fare between 8,000 and 28,000 won
  const baseFare = (Math.abs(hash) % 201) * 100 + 8000;
  return `${baseFare.toLocaleString()}원`;
};

const getMockRemainingSeats = (id: string) => {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = id.charCodeAt(i) + ((hash << 5) - hash);
  }
  // Generate a mock number of remaining seats between 0 and 5
  return Math.abs(hash) % 6;
};

function TaxiPotDetailScreen({
  taxiPot,
  categories,
  onBack,
  onProceed,
  showSavedActions,
  onDelete,
  onReserve,
}: {
  taxiPot: TaxiPot;
  categories: ConcertCategory[];
  onBack: () => void;
  onProceed: () => void;
  showSavedActions?: boolean;
  onDelete?: () => void;
  onReserve?: () => void;
}) {
  const bulletColor = getCategoryColor(taxiPot.categoryId, categories);

  return (
    <>
      <AppHeader title="상세 정보" showBack onBack={onBack} />
      <div className="screen-content home-content">
        <div className="detail-info-card">
          <div className="detail-row">
            <span className="detail-label">콘서트</span>
            <div className="detail-value-with-bullet">
              <span className="bullet" style={{ background: bulletColor }} />
              <span className="font-semibold">{taxiPot.concertTitle}</span>
            </div>
          </div>
          <div className="detail-row">
            <span className="detail-label">출발지</span>
            <span className="detail-value">{taxiPot.origin}</span>
          </div>
          <div className="detail-row">
            <span className="detail-label">도착지</span>
            <span className="detail-value">{taxiPot.destination}</span>
          </div>
          <div className="detail-row">
            <span className="detail-label">일시</span>
            <span className="detail-value">{formatDateTime(taxiPot.date, taxiPot.time)}</span>
          </div>
          <div className="detail-row">
            <span className="detail-label">추가사항</span>
            <span className="detail-value additional-notes">
              합승 인원 모집 중입니다. 편하게 연락주세요!
            </span>
          </div>
          <div className="detail-row">
            <span className="detail-label">팟 조회수</span>
            <span className="detail-value">{getMockViews(taxiPot.id)}회</span>
          </div>
          <div className="detail-row">
            <span className="detail-label">예상 택시비 (인당)</span>
            <span className="detail-value">{getMockFare(taxiPot.origin, taxiPot.destination)}</span>
          </div>
          <div className="detail-row detail-row-special">
            <span className="fond-semibold">마감까지 {getMockRemainingSeats(taxiPot.id)}자리 남았어요!</span>
          </div>
        </div>

        {showSavedActions ? (
          <div className="detail-actions-row">
            <button type="button" className="bottom-action" onClick={onDelete}>
              택시팟 삭제하기
            </button>
            <button type="button" className="bottom-action" onClick={onReserve}>
              택시팟 예약하기
            </button>
          </div>
        ) : (
          <div className="detail-action">
            <BottomActionButton onClick={onProceed}>
              택시팟 저장하기 ♡
            </BottomActionButton>
          </div>
        )}
      </div>
    </>
  );
}

function TaxiPotDepositScreen({
  taxiPot,
  onBack,
  onClose,
}: {
  taxiPot: TaxiPot;
  onBack: () => void;
  onClose: () => void;
}) {
  const [depositorName, setDepositorName] = useState("");
  const [depositorAccount, setDepositorAccount] = useState("");
  const [depositorPhone, setDepositorPhone] = useState("");
  const [error, setError] = useState("");
  const [isDeposited, setIsDeposited] = useState(false);
  const [copied, setCopied] = useState(false);

  // Calculate values
  const combined = taxiPot.origin + taxiPot.destination;
  let hash = 0;
  for (let i = 0; i < combined.length; i++) {
    hash = combined.charCodeAt(i) + ((hash << 5) - hash);
  }
  const estimatedFareNum = (Math.abs(hash) % 201) * 100 + 8000;
  // 선입금: 예상 택시비보다 높은 값으로 책정 (예상 택시비에 5,000원을 더한 후 5,000원 단위 올림)
  const depositAmountNum = Math.ceil((estimatedFareNum + 5000) / 5000) * 5000;
  // 예상 환급액: 선입금 - 예상 택시비
  const estimatedRefundNum = depositAmountNum - estimatedFareNum;

  // Clicks count & money calculation
  const initialCount = (Math.abs(hash) % 3) + 1; // 1, 2, or 3 initial participants
  const currentCount = isDeposited ? initialCount + 1 : initialCount;
  const collectedMoney = currentCount * depositAmountNum;
  const fillPercent = (currentCount / 5) * 100;

  const handleCopy = () => {
    navigator.clipboard.writeText("650701-01-474473");
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!depositorName.trim() || !depositorAccount.trim() || !depositorPhone.trim()) {
      setError("모든 필수 항목을 입력해 주세요.");
      return;
    }

    setError("");
    setIsDeposited(true);
  };

  const handleOpenChat = async () => {
    try {
      await trackOpenChatClick(taxiPot);
    } catch {
      // Ignore tracking failure
    }
    
    window.open(taxiPot.openChatUrl, "_blank", "noopener,noreferrer");
    onClose();
  };

  return (
    <>
      <AppHeader 
        title={isDeposited ? "선입금 완료" : "예약 페이지"} 
        showBack 
        onBack={isDeposited ? onClose : onBack} 
      />
      <div className="screen-content home-content" style={{ paddingBottom: "140px" }}>
        {!isDeposited ? (
          <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
            <div className="deposit-illustration-container">
              <img 
                src="/concert_taxi_gemini.png" 
                alt="선입금 일러스트레이션" 
                className="deposit-illustration-img"
              />
              <div className="gauge-container" aria-label={`모집 인원 ${currentCount}명, 수금액 ${collectedMoney.toLocaleString()}원`}>
                <span className="gauge-label-left">{currentCount}명</span>
                <div className="gauge-bar-outer">
                  <div className="gauge-bar-inner" style={{ height: `${fillPercent}%` }} />
                </div>
                <span className="gauge-label-right">{collectedMoney.toLocaleString()}원</span>
              </div>
            </div>

            <div className="front-deposit-reason">
              <p>
                노쇼 없는 안전한 탑승과 번거로운 현장 정산 생략을 위해,
                <br />
                예상 정산 금액을 미리 안전하게 보관합니다.
              </p>
              <p>택시팟이 결성되지 않을시 전액 환불됩니다.</p>
            </div>

            <div className="deposit-calc-card">
              <div className="calc-row highlighted-row">
                <span className="calc-label">선입금</span>
                <span className="calc-value highlight-value">{depositAmountNum.toLocaleString()}원</span>
              </div>
              <div className="calc-divider" />
              <div className="calc-row">
                <span className="calc-label">예상 정산 금액</span>
                <span className="calc-value">{estimatedFareNum.toLocaleString()}원</span>
              </div>
              <div className="calc-row">
                <span className="calc-label">예상 환급액</span>
                <span className="calc-value">{estimatedRefundNum.toLocaleString()}원</span>
              </div>
            </div>

            <div className="account-details-card">
              <div className="account-title">입금 계좌</div>
              <div className="account-grid">
                <span className="grid-label">은행</span>
                <span className="grid-value">국민은행</span>
                
                <span className="grid-label">계좌번호</span>
                <div className="account-num-wrapper">
                  <span className="grid-value">650701-01-474473</span>
                  <button 
                    type="button" 
                    className="account-copy-btn" 
                    onClick={handleCopy}
                    title="계좌번호 복사"
                  >
                    <Copy size={11} />
                    <span>{copied ? "복사됨" : "복사"}</span>
                  </button>
                </div>
                
                <span className="grid-label">예금주</span>
                <span className="grid-value">노준하</span>

                <span className="grid-label">대표자 번호</span>
                <span className="grid-value">010-7685-8902</span>

                <span className="grid-label">금액</span>
                <span className="grid-value">{depositAmountNum.toLocaleString()}원</span>
              </div>
            </div>

            <div className="account-creation-notice">
              <span> 한번 입력 후 계정 생성 완료!</span>
            </div>

            <div className="deposit-form-fields">
              <FormField label="입금자명 (필수)">
                <input
                  type="text"
                  placeholder="홍길동"
                  value={depositorName}
                  onChange={(e) => setDepositorName(e.target.value)}
                />
              </FormField>
              <FormField label="환급용 입금자 은행 / 계좌 (필수)">
                <input
                  type="text"
                  placeholder="신한은행 110-123-456789"
                  value={depositorAccount}
                  onChange={(e) => setDepositorAccount(e.target.value)}
                />
              </FormField>
              <FormField label="입금자 전화번호 (필수)">
                <input
                  type="tel"
                  placeholder="010-1234-5678"
                  value={depositorPhone}
                  onChange={(e) => setDepositorPhone(e.target.value)}
                />
              </FormField>
            </div>

            {error && <p className="form-error modal-form-error">{error}</p>}
            
            <div className="scroll-bottom-action">
              <BottomActionButton type="submit">
                입금 완료하고 오픈채팅 참여하기
              </BottomActionButton>
            </div>
          </form>
        ) : (
          <div className="deposited-state-body" style={{ padding: "10px 0" }}>
            <div className="deposit-illustration-container">
              <img 
                src="/concert_taxi_gemini.png" 
                alt="선입금 일러스트레이션" 
                className="deposit-illustration-img"
              />
              <div className="gauge-container" aria-label={`모집 인원 ${currentCount}명, 수금액 ${collectedMoney.toLocaleString()}원`}>
                <span className="gauge-label-left">{currentCount}명</span>
                <div className="gauge-bar-outer">
                  <div className="gauge-bar-inner" style={{ height: `${fillPercent}%` }} />
                </div>
                <span className="gauge-label-right">{collectedMoney.toLocaleString()}원</span>
              </div>
            </div>
            
            <div className="deposited-success-message" style={{ margin: "20px 0" }}>
              <h4>🎉 입금 확인 완료!</h4>
              <p>노준하님 계좌로 <strong>{depositAmountNum.toLocaleString()}원</strong> 선입금이 확인되었습니다.</p>
              <p className="sub-p">탑승 예약이 완료되었습니다. 아래 버튼을 눌러 오픈채팅방에 입장해 주세요.</p>
            </div>
            
            <div className="fixed-action">
              <BottomActionButton onClick={handleOpenChat}>
                오픈채팅방 입장하기
              </BottomActionButton>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

function TaxiPotItem({
  taxiPot,
  categories,
  onViewDetails,
  actionText = "참여하기",
}: {
  taxiPot: TaxiPot;
  categories: ConcertCategory[];
  onViewDetails: (taxiPot: TaxiPot) => void;
  actionText?: string;
}) {
  const bulletColor = getCategoryColor(taxiPot.categoryId, categories);

  return (
    <article className="taxi-pot-item">
      <div className="route-icon" aria-hidden="true" style={{ color: bulletColor }}>
        <CircleDot size={15} strokeWidth={2.1} />
      </div>
      <div className="taxi-pot-body">
        <h2>
          {taxiPot.origin} → {taxiPot.destination}
        </h2>
        <p>{formatDateTime(taxiPot.date, taxiPot.time)}</p>
        <p className={getInOutLabel(taxiPot.origin, taxiPot.destination) === "IN" ? "pot-label-in" : "pot-label-out"}>
          {getInOutLabel(taxiPot.origin, taxiPot.destination)}
        </p>
      </div>
      <button className="chat-button" type="button" onClick={() => onViewDetails(taxiPot)}>
        {actionText}
      </button>
    </article>
  );
}

function HomeScreen({
  categories,
  selectedCategory,
  selectedCategoryId,
  taxiPots,
  onOpenConcerts,
  onOpenMenu,
  onCreate,
  onViewDetails,
}: {
  categories: ConcertCategory[];
  selectedCategory: ConcertCategory | undefined;
  selectedCategoryId: string;
  taxiPots: TaxiPot[];
  onOpenConcerts: () => void;
  onOpenMenu: () => void;
  onCreate: () => void;
  onViewDetails: (taxiPot: TaxiPot) => void;
}) {
  const visibleTaxiPots = useMemo(() => {
    if (selectedCategoryId === ALL_CATEGORIES_ID) {
      return taxiPots;
    }

    if (!selectedCategory) {
      return taxiPots;
    }

    return taxiPots.filter(
      (taxiPot) => taxiPot.categoryId === selectedCategory.id,
    );
  }, [selectedCategory, selectedCategoryId, taxiPots]);

  return (
    <>
      <AppHeader title="콘서트 택시팟" showMenuButton onMenuClick={onOpenMenu} />
      <div className="screen-content home-content">
        <ConcertSelectCard
          selectedCategory={selectedCategory}
          selectedCategoryId={selectedCategoryId}
          onOpen={onOpenConcerts}
        />
        <div className="list-divider" />
        <section className="taxi-pot-list" aria-label="택시팟 목록">
          {visibleTaxiPots.length > 0 ? (
            visibleTaxiPots.map((taxiPot) => (
              <TaxiPotItem
                key={taxiPot.id}
                taxiPot={taxiPot}
                categories={categories}
                onViewDetails={onViewDetails}
              />
            ))
          ) : (
            <p className="empty-state">등록된 택시팟이 아직 없습니다.</p>
          )}
        </section>
      </div>
      <div className="fixed-action">
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
          <span className="bullet" style={{ background: "var(--color-purple)" }} />
          <span>전체</span>
        </button>
        {categories.map((category) => {
          const bulletColor = getCategoryColor(category.id, categories);
          return (
            <button
              key={category.id}
              className="concert-row"
              type="button"
              aria-pressed={selectedCategoryId === category.id}
              onClick={() => onSelect(category.id)}
            >
              <span className="bullet" style={{ background: bulletColor }} />
              <span>{category.title}</span>
            </button>
          );
        })}
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
  const [notes, setNotes] = useState("");
  const [estimatedFare, setEstimatedFare] = useState("");

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
        <FormField label="시간 (선택)">
          <input
            type="time"
            value={values.time}
            onChange={(event) => updateField("time", event.target.value)}
          />
        </FormField>
        <FormField label="예상 택시비">
          <input
            type="number"
            placeholder="예상 택시비를 입력해주세요 (원)"
            value={estimatedFare}
            onChange={(event) => setEstimatedFare(event.target.value)}
          />
        </FormField>
        <FormField label="추가사항 (선택)">
          <input
            placeholder="추가사항을 입력해주세요 (예: 짐이 많아요, 2명입니다)"
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
          />
        </FormField>
        <FormField label="오픈채팅 링크">
          <input
            value={values.openChatUrl}
            inputMode="url"
            onChange={(event) => updateField("openChatUrl", event.target.value)}
          />
        </FormField>
        {error ? <p className="form-error">{error}</p> : null}
        <div className="scroll-bottom-action">
          <BottomActionButton type="submit" disabled={isSaving}>
            {isSaving ? "등록 중" : "등록하기"}
          </BottomActionButton>
        </div>
      </form>
    </>
  );
}

function TaxiPotSavedScreen({
  taxiPots,
  savedTaxiPotIds,
  categories,
  onBack,
  onViewDetails,
}: {
  taxiPots: TaxiPot[];
  savedTaxiPotIds: string[];
  categories: ConcertCategory[];
  onBack: () => void;
  onViewDetails: (taxiPot: TaxiPot) => void;
}) {
  const savedPots = useMemo(() => {
    return taxiPots.filter((pot) => savedTaxiPotIds.includes(pot.id));
  }, [taxiPots, savedTaxiPotIds]);

  return (
    <>
      <AppHeader title="저장 목록" showBack onBack={onBack} />
      <div className="screen-content home-content">
        <section className="taxi-pot-list" aria-label="저장된 택시팟 목록">
          {savedPots.length > 0 ? (
            savedPots.map((taxiPot) => (
              <TaxiPotItem
                key={taxiPot.id}
                taxiPot={taxiPot}
                categories={categories}
                onViewDetails={onViewDetails}
                actionText="상세보기"
              />
            ))
          ) : (
            <p className="empty-state">저장된 택시팟이 아직 없습니다.</p>
          )}
        </section>
      </div>
    </>
  );
}

function SlideMenu({
  isOpen,
  onClose,
  onShowSaved,
}: {
  isOpen: boolean;
  onClose: () => void;
  onShowSaved: () => void;
}) {
  return (
    <>
      <div 
        className={`menu-backdrop ${isOpen ? "open" : ""}`} 
        onClick={onClose} 
      />
      <div className={`slide-menu ${isOpen ? "open" : ""}`}>
        <div className="slide-menu-header">
          <button 
            type="button" 
            className="icon-button notification-btn" 
            aria-label="알림"
            onClick={() => alert("새로운 알림이 없습니다.")}
          >
            <Bell size={22} strokeWidth={1.8} />
          </button>
          
          <button 
            type="button" 
            className="icon-button close-btn" 
            aria-label="메뉴 닫기" 
            onClick={onClose}
          >
            <X size={22} strokeWidth={1.8} />
          </button>
        </div>
        
        <nav className="slide-menu-nav">
          <button type="button" className="menu-item" onClick={() => alert("나의 정보 페이지로 이동합니다.")}>
            <span>나의 정보</span>
            <ChevronRight size={18} strokeWidth={1.8} />
          </button>
          <button type="button" className="menu-item" onClick={onShowSaved}>
            <span>저장 목록</span>
            <ChevronRight size={18} strokeWidth={1.8} />
          </button>
          <button type="button" className="menu-item" onClick={() => alert("사용내역 페이지로 이동합니다.")}>
            <span>입금 / 사용 내역</span>
            <ChevronRight size={18} strokeWidth={1.8} />
          </button>
          <button type="button" className="menu-item" onClick={() => alert("서비스 안내 페이지로 이동합니다.")}>
            <span>서비스 안내</span>
            <ChevronRight size={18} strokeWidth={1.8} />
          </button>
          <button type="button" className="menu-item" onClick={() => alert("고객센터 페이지로 이동합니다.")}>
            <span>고객센터</span>
            <ChevronRight size={18} strokeWidth={1.8} />
          </button>
        </nav>
      </div>
    </>
  );
}

export default function App() {
  const [screen, setScreen] = useState<Screen>("home");
  const [categories, setCategories] = useState<ConcertCategory[]>([]);
  const [selectedCategoryId, setSelectedCategoryId] =
    useState(ALL_CATEGORIES_ID);
  const [taxiPots, setTaxiPots] = useState<TaxiPot[]>([]);
  const [error, setError] = useState("");
  const [isSavingTaxiPot, setIsSavingTaxiPot] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [selectedTaxiPot, setSelectedTaxiPot] = useState<TaxiPot | null>(null);
  const [depositReferrer, setDepositReferrer] = useState<"details" | "home">("details");
  const [detailsReferrer, setDetailsReferrer] = useState<"home" | "saved">("home");
  const [savedTaxiPotIds, setSavedTaxiPotIds] = useState<string[]>(() => {
    const raw = localStorage.getItem("concert-taxipot:saved");
    return raw ? JSON.parse(raw) : [];
  });

  const saveTaxiPotId = (id: string) => {
    setSavedTaxiPotIds((prev) => {
      if (prev.includes(id)) {
        alert("이미 저장된 택시팟입니다.");
        return prev;
      }
      const next = [...prev, id];
      localStorage.setItem("concert-taxipot:saved", JSON.stringify(next));
      alert("저장되었습니다! 팟 인원이 다 차면 알림으로 알려드립니다! (메뉴 -> 저장 목록)");
      return next;
    });
  };

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
    const loadData = async () => {
      try {
        const [nextCategories, nextTaxiPots] = await Promise.all([
          loadConcertCategories(),
          loadTaxiPots(),
        ]);
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
        setError("데이터를 불러오지 못했습니다.");
      }
    };

    loadData();
  }, []);

  const createTaxiPot = async (values: TaxiPotFormValues) => {
    if (isSavingTaxiPot) {
      return;
    }

    const taxiPot: TaxiPot = {
      id: createTaxiPotId(),
      categoryId: values.categoryId,
      concertTitle: values.concertTitle.trim(),
      origin: values.origin.trim(),
      destination: values.destination.trim(),
      date: values.date,
      time: values.time,
      openChatUrl: values.openChatUrl.trim(),
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
      {error ? <p className="global-error">{error}</p> : null}
      {screen === "home" ? (
        <HomeScreen
          categories={categories}
          selectedCategory={selectedCategory}
          selectedCategoryId={selectedCategoryId}
          taxiPots={visibleTaxiPots}
          onOpenConcerts={() => setScreen("concerts")}
          onCreate={() => setScreen("new")}
          onOpenMenu={() => setIsMenuOpen(true)}
          onViewDetails={(taxiPot) => {
            setSelectedTaxiPot(taxiPot);
            setDetailsReferrer("home");
            setScreen("details");
          }}
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
      {screen === "details" && selectedTaxiPot ? (
        <TaxiPotDetailScreen
          taxiPot={selectedTaxiPot}
          categories={categories}
          onBack={() => {
            setScreen(detailsReferrer);
            setSelectedTaxiPot(null);
          }}
          onProceed={() => {
            saveTaxiPotId(selectedTaxiPot.id);
            setScreen(detailsReferrer);
            setSelectedTaxiPot(null);
          }}
          showSavedActions={detailsReferrer === "saved"}
          onDelete={() => {
            setSavedTaxiPotIds((prev) => {
              const next = prev.filter((item) => item !== selectedTaxiPot.id);
              localStorage.setItem("concert-taxipot:saved", JSON.stringify(next));
              return next;
            });
            setScreen("saved");
            setSelectedTaxiPot(null);
          }}
          onReserve={() => {
            setDepositReferrer("details");
            setScreen("deposit");
          }}
        />
      ) : null}
      {screen === "deposit" && selectedTaxiPot ? (
        <TaxiPotDepositScreen
          taxiPot={selectedTaxiPot}
          onBack={() => {
            if (depositReferrer === "home") {
              setScreen("home");
              setSelectedTaxiPot(null);
            } else {
              setScreen("details");
            }
          }}
          onClose={() => {
            setScreen("home");
            setSelectedTaxiPot(null);
          }}
        />
      ) : null}
      {screen === "saved" ? (
        <TaxiPotSavedScreen
          taxiPots={taxiPots}
          savedTaxiPotIds={savedTaxiPotIds}
          categories={categories}
          onBack={() => setScreen("home")}
          onViewDetails={(taxiPot) => {
            setSelectedTaxiPot(taxiPot);
            setDetailsReferrer("saved");
            setScreen("details");
          }}
        />
      ) : null}
      
      <SlideMenu
        isOpen={isMenuOpen}
        onClose={() => setIsMenuOpen(false)}
        onShowSaved={() => {
          setIsMenuOpen(false);
          setScreen("saved");
        }}
      />
    </MobileShell>
  );
}
