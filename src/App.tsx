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
  openChatUrl: "오픈채팅 방을 첨부해주세요",
  minPeople: "",
  estimatedFare: "",
  notes: "",
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
          {selectedCategoryId === ""
            ? "콘서트 선택"
            : selectedCategoryId === ALL_CATEGORIES_ID
            ? "전체"
            : (selectedCategory?.title ?? "콘서트 선택")}
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

const getMockFareNumber = (origin: string, destination: string) => {
  const combined = origin + destination;
  let hash = 0;
  for (let i = 0; i < combined.length; i++) {
    hash = combined.charCodeAt(i) + ((hash << 5) - hash);
  }
  // Generate a fare between 8,000 and 28,000 won
  return (Math.abs(hash) % 201) * 100 + 8000;
};

const getMockFare = (origin: string, destination: string) => {
  const baseFare = getMockFareNumber(origin, destination);
  return `${baseFare.toLocaleString()}원`;
};

const getDisplayFare = (taxiPot: TaxiPot) => {
  let totalFare = 0;
  if (taxiPot.estimatedFare) {
    totalFare = parseFloat(taxiPot.estimatedFare);
  }
  if (isNaN(totalFare) || totalFare <= 0) {
    const baseFare = getMockFareNumber(taxiPot.origin, taxiPot.destination);
    totalFare = baseFare * 5;
  }
  
  const farePerPerson = Math.ceil(((totalFare + 5000) / 5) / 100) * 100;
  return `${farePerPerson.toLocaleString()}원`;
};

const getMockRemainingSeats = (id: string) => {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = id.charCodeAt(i) + ((hash << 5) - hash);
  }
  // Generate a mock number of remaining seats between 0 and 5
  return Math.abs(hash) % 6;
};

const getRemainingSeats = (taxiPot: TaxiPot) => {
  let hash = 0;
  const id = taxiPot.id;
  for (let i = 0; i < id.length; i++) {
    hash = id.charCodeAt(i) + ((hash << 5) - hash);
  }

  if (taxiPot.minPeople) {
    const minPeopleNum = parseInt(taxiPot.minPeople, 10);
    if (!isNaN(minPeopleNum) && minPeopleNum > 0) {
      // Mock initial participants: at least 1, and less than minPeopleNum (if minPeopleNum > 1)
      const maxInitial = Math.max(1, minPeopleNum - 1);
      const initialCount = (Math.abs(hash) % maxInitial) + 1;
      const remaining = minPeopleNum - initialCount;
      return Math.max(0, remaining);
    }
  }

  return getMockRemainingSeats(id);
};

function TaxiPotDetailScreen({
  taxiPot,
  categories,
  onBack,
  isLiked,
  likeCount,
  onToggleLike,
  showReserveButton,
  onReserve,
  alertMinPeople,
}: {
  taxiPot: TaxiPot;
  categories: ConcertCategory[];
  onBack: () => void;
  isLiked: boolean;
  likeCount: number;
  onToggleLike: () => void;
  showReserveButton: boolean;
  onReserve: () => void;
  alertMinPeople?: string;
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
            <span className="detail-label">최소 인원</span>
            <span className="detail-value">{taxiPot.minPeople ? `${taxiPot.minPeople}명` : "없음"}</span>
          </div>
          {isLiked && alertMinPeople && (
            <div className="detail-row">
              <span className="detail-label">알림 설정</span>
              <span className="detail-value" style={{ color: "var(--color-purple)", fontWeight: "600" }}>
                {alertMinPeople}명 이상 시 알림 수신
              </span>
            </div>
          )}
          <div className="detail-row">
            <span className="detail-label">추가사항</span>
            <span className="detail-value additional-notes">
              {taxiPot.notes && taxiPot.notes.trim() ? taxiPot.notes : "합승 인원 모집 중입니다. 편하게 연락주세요!"}
            </span>
          </div>
          <div className="detail-row">
            <span className="detail-label">팟 조회수</span>
            <span className="detail-value">{getMockViews(taxiPot.id)}회</span>
          </div>
          <div className="detail-row">
            <span className="detail-label">예상 택시비 (인당)</span>
            <span className="detail-value">{getDisplayFare(taxiPot)}</span>
          </div>
          <div className="detail-row detail-row-special">
            <span className="fond-semibold">마감까지 {getRemainingSeats(taxiPot)}자리 남았어요!</span>
          </div>
        </div>

        {showReserveButton && isLiked ? (
          <div className="detail-actions-row" style={{ marginTop: "20px", marginBottom: "20px" }}>
            <button 
              type="button" 
              className="bottom-action" 
              onClick={onToggleLike}
            >
              택시팟 찜하기 {isLiked ? "♥" : "♡"}{likeCount > 0 ? ` ${likeCount}` : ""}
            </button>
            <button type="button" className="bottom-action" onClick={onReserve}>
              택시팟 예약하기
            </button>
          </div>
        ) : (
          <div className="detail-action" style={{ marginTop: "20px", marginBottom: "20px" }}>
            <button 
              type="button" 
              className="bottom-action" 
              onClick={onToggleLike}
            >
              택시팟 찜하기 {isLiked ? "♥" : "♡"}{likeCount > 0 ? ` ${likeCount}` : ""}
            </button>
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
  
  let estimatedFareNum = 0;
  if (taxiPot.estimatedFare) {
    const totalFare = parseFloat(taxiPot.estimatedFare);
    if (!isNaN(totalFare) && totalFare > 0) {
      const people = taxiPot.minPeople ? parseInt(taxiPot.minPeople, 10) : 4;
      const validPeople = !isNaN(people) && people > 0 ? people : 4;
      estimatedFareNum = Math.ceil((totalFare / validPeople) / 100) * 100;
    }
  }
  if (estimatedFareNum <= 0) {
    estimatedFareNum = (Math.abs(hash) % 201) * 100 + 8000;
  }
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

            <div className="front-deposit-reason">
              <p>
                노쇼 방지와 정산 간소화 차원에서 선불 제도를 운영합니다. 
                <br />
                해당 금액은 환급될 금액까지 포함되면, 안전하게 보관됩니다.
              </p>
              <p>택시팟이 결성되지 않을시 전액 환불됩니다.</p>
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
  alertMinPeople,
}: {
  taxiPot: TaxiPot;
  categories: ConcertCategory[];
  onViewDetails: (taxiPot: TaxiPot) => void;
  actionText?: string;
  alertMinPeople?: string;
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
        {alertMinPeople && (
          <p className="pot-alert-setting" style={{ color: "var(--color-purple)", fontSize: "11px", marginTop: "4px", fontWeight: "500" }}>
            알림 수신: {alertMinPeople}명 이상
          </p>
        )}
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
    if (selectedCategoryId === "") {
      return [];
    }

    if (selectedCategoryId === ALL_CATEGORIES_ID) {
      return taxiPots;
    }

    if (!selectedCategory) {
      return taxiPots.filter(
        (taxiPot) => taxiPot.categoryId === selectedCategoryId,
      );
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
          ) : selectedCategoryId === "" ? null : (
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
      !values.openChatUrl.trim() ||
      !values.minPeople ||
      !values.minPeople.trim() ||
      !values.estimatedFare ||
      !values.estimatedFare.trim()
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
        <FormField label="최소 인원 (필수)">
          <input
            type="number"
            value={values.minPeople || ""}
            onChange={(event) => updateField("minPeople", event.target.value)}
          />
        </FormField>
        <FormField label="예상 택시비 (총액) (필수)">
          <input
            type="number"
            placeholder="예상 택시비를 입력해주세요 (원)"
            value={values.estimatedFare || ""}
            onChange={(event) => updateField("estimatedFare", event.target.value)}
          />
        </FormField>
        <FormField label="추가사항 (선택)">
          <input
            placeholder="추가사항을 입력해주세요 (예: 짐이 많아요, 2명입니다)"
            value={values.notes || ""}
            onChange={(event) => updateField("notes", event.target.value)}
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
  alertSettings,
}: {
  taxiPots: TaxiPot[];
  savedTaxiPotIds: string[];
  categories: ConcertCategory[];
  onBack: () => void;
  onViewDetails: (taxiPot: TaxiPot) => void;
  alertSettings: Record<string, string>;
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
                alertMinPeople={alertSettings[taxiPot.id]}
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

function LikeAlertModal({
  taxiPot,
  onClose,
  onSave,
}: {
  taxiPot: TaxiPot;
  onClose: () => void;
  onSave: (count: string) => void;
}) {
  const [count, setCount] = useState(() => {
    return taxiPot.minPeople || "4";
  });

  const getAlertOptionText = (n: number) => {
    let totalFare = 0;
    if (taxiPot.estimatedFare) {
      totalFare = parseFloat(taxiPot.estimatedFare);
    }
    if (isNaN(totalFare) || totalFare <= 0) {
      const baseFare = getMockFareNumber(taxiPot.origin, taxiPot.destination);
      totalFare = baseFare * 5;
    }
    const priceForN = Math.ceil(((totalFare + (1000 * n)) / n) / 100) * 100;
    return `${n}명 (인당 ${priceForN.toLocaleString()}원)`;
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>알림 수신 최소 인원 설정</h3>
          <button type="button" className="modal-close" onClick={onClose} aria-label="닫기">
            <X size={18} />
          </button>
        </div>
        <div className="modal-body" style={{ fontSize: "14px", lineHeight: "1.6", color: "var(--color-text)" }}>
          <p style={{ margin: 0, fontWeight: "600", color: "var(--color-purple)", fontSize: "15px" }}>
            선택하신 택시팟이 저장 목록에 추가되었습니다.
          </p>
          <p style={{ margin: 0, fontSize: "13px", color: "var(--color-muted)" }}>
            해당 택시팟은 [메뉴 &gt; 저장 목록]에서 확인하실 수 있습니다.
          </p>
          <div style={{ height: "1px", background: "var(--color-line)", margin: "8px 0" }} />
          <p style={{ margin: 0 }}>
            탑승 인원에 따라 개인 부담 금액이 변동됩니다. 알림을 수신할 최소 인원을 설정해 주세요.
          </p>
          
          <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginTop: "8px" }}>
            <label htmlFor="alert-min-people-select" style={{ fontSize: "12px", fontWeight: "600", color: "var(--color-muted)" }}>
              알림 수신 인원
            </label>
            <select
              id="alert-min-people-select"
              value={count}
              onChange={(e) => setCount(e.target.value)}
              style={{
                width: "100%",
                padding: "10px 12px",
                borderRadius: "10px",
                border: "1px solid var(--color-line)",
                background: "var(--color-page)",
                color: "var(--color-text)",
                fontSize: "14px",
                outline: "none",
              }}
            >
              <option value="2">{getAlertOptionText(2)}</option>
              <option value="3">{getAlertOptionText(3)}</option>
              <option value="4">{getAlertOptionText(4)}</option>
              <option value="5">{getAlertOptionText(5)}</option>
            </select>
          </div>
        </div>
        <div className="modal-footer" style={{ padding: "12px 20px 20px" }}>
          <BottomActionButton onClick={() => onSave(count)}>
            설정 완료
          </BottomActionButton>
        </div>
      </div>
    </div>
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
    useState("");
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

  const [likeCounts, setLikeCounts] = useState<Record<string, number>>(() => {
    const raw = localStorage.getItem("concert-taxipot:likes");
    return raw ? JSON.parse(raw) : {};
  });

  const [alertSettings, setAlertSettings] = useState<Record<string, string>>(() => {
    const raw = localStorage.getItem("concert-taxipot:alert-settings");
    return raw ? JSON.parse(raw) : {};
  });

  const [likePopupTaxiPot, setLikePopupTaxiPot] = useState<TaxiPot | null>(null);

  const toggleLikeTaxiPot = (id: string) => {
    const isCurrentlyLiked = savedTaxiPotIds.includes(id);
    let nextSavedIds: string[];
    let nextLikeCounts: Record<string, number>;

    if (isCurrentlyLiked) {
      nextSavedIds = savedTaxiPotIds.filter((item) => item !== id);
      const currentCount = likeCounts[id] ?? 1;
      nextLikeCounts = {
        ...likeCounts,
        [id]: Math.max(0, currentCount - 1),
      };

      const nextAlertSettings = { ...alertSettings };
      delete nextAlertSettings[id];
      setAlertSettings(nextAlertSettings);
      localStorage.setItem("concert-taxipot:alert-settings", JSON.stringify(nextAlertSettings));

      alert("찜하기가 취소되었습니다.");
    } else {
      nextSavedIds = [...savedTaxiPotIds, id];
      const currentCount = likeCounts[id] ?? 0;
      nextLikeCounts = {
        ...likeCounts,
        [id]: currentCount + 1,
      };

      const pot = taxiPots.find((p) => p.id === id) || null;
      if (pot) {
        setLikePopupTaxiPot(pot);
      }
    }

    setSavedTaxiPotIds(nextSavedIds);
    setLikeCounts(nextLikeCounts);
    localStorage.setItem("concert-taxipot:saved", JSON.stringify(nextSavedIds));
    localStorage.setItem("concert-taxipot:likes", JSON.stringify(nextLikeCounts));
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
          if (current === "") {
            return "";
          }
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
      minPeople: values.minPeople,
      estimatedFare: values.estimatedFare,
      notes: values.notes ? values.notes.trim() : undefined,
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
          isLiked={savedTaxiPotIds.includes(selectedTaxiPot.id)}
          likeCount={likeCounts[selectedTaxiPot.id] ?? 0}
          onToggleLike={() => toggleLikeTaxiPot(selectedTaxiPot.id)}
          showReserveButton={detailsReferrer === "saved"}
          onReserve={() => {
            setDepositReferrer("details");
            setScreen("deposit");
          }}
          alertMinPeople={alertSettings[selectedTaxiPot.id]}
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
          alertSettings={alertSettings}
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

      {likePopupTaxiPot && (
        <LikeAlertModal
          taxiPot={likePopupTaxiPot}
          onClose={() => setLikePopupTaxiPot(null)}
          onSave={(count) => {
            const nextAlertSettings = {
              ...alertSettings,
              [likePopupTaxiPot.id]: count,
            };
            setAlertSettings(nextAlertSettings);
            localStorage.setItem("concert-taxipot:alert-settings", JSON.stringify(nextAlertSettings));
            setLikePopupTaxiPot(null);
          }}
        />
      )}
    </MobileShell>
  );
}
