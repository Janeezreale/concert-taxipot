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
  inferTaxiPotDirection,
  resolveTaxiPotDirection,
} from "./directionMatcher";
import {
  loadConcertCategories,
  loadTaxiPots,
  saveTaxiPot,
  trackOpenChatClick,
  ensureAnonymousUser,
  updateAnonymousUserProfile,
  insertTaxiPotLike,
  deleteTaxiPotLike,
  loadUserLikedPotIds,
  loadAllTaxiPotLikeCounts,
  createTaxiPotReservation,
} from "./storage";
import { supabase } from "./supabase";
import type {
  ConcertCategory,
  Screen,
  TaxiPot,
  TaxiPotDirectionFilter,
  TaxiPotFormValues,
} from "./types";

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

const readLocalStorageJson = <T,>(key: string, fallback: T): T => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
};

const getOrGenerateAnonymousKey = () => {
  let key = localStorage.getItem("concert-taxipot:anonymous-key");
  if (!key) {
    key = "anon-" + Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
    localStorage.setItem("concert-taxipot:anonymous-key", key);
  }
  return key;
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

// 사용자가 홈 화면에서 원하는 콘서트를 선택할 수 있도록 해주는 드롭다운 버튼 컴포넌트입니다.
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

// 택시팟의 행선지 방향(공연장행 또는 귀가행) 필터를 전환하는 탭 컴포넌트입니다.
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
  alertPhone,
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
  alertPhone?: string;
}) {
  const bulletColor = getCategoryColor(taxiPot.categoryId, categories);

  // 최소 탑승 인원 값을 가져옵니다. 설정되어 있지 않다면 undefined로 설정합니다.
  const minPeopleVal = taxiPot.minPeople ? parseInt(taxiPot.minPeople, 10) : undefined;
  // 최소 탑승 인원 설정이 없거나, 현재 찜하기 횟수가 최소 인원 이상인 경우 예약이 활성화됩니다.
  const canReserve = minPeopleVal === undefined || isNaN(minPeopleVal) || likeCount >= minPeopleVal;
  // 남은 자리 수 계산: 최대 5석에서 현재 찜하기 횟수(likeCount)를 뺀 값으로 설정하며, 0 미만으로 내려가지 않도록 제한합니다.
  const remainingSeats = Math.max(0, 5 - likeCount);

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
                {alertMinPeople}명 이상 시 알림 수신{alertPhone ? ` (${alertPhone})` : ""}
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
            <span className="detail-label">예상 택시비 (인당)</span>
            <span className="detail-value">{getDisplayFare(taxiPot)}</span>
          </div>
          <div className="detail-row detail-row-special">
            <span className="fond-semibold">마감까지 {remainingSeats}자리 남았어요!</span>
          </div>
        </div>

        {showReserveButton && isLiked ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: "100%", marginTop: "20px", marginBottom: "20px" }}>
            <div className="detail-actions-row" style={{ width: "100%", marginBottom: "8px" }}>
              <button
                type="button"
                className="bottom-action"
                onClick={onToggleLike}
              >
                택시팟 찜하기 {isLiked ? "♥" : "♡"}{likeCount > 0 ? ` ${likeCount}` : ""}
              </button>
              <button
                type="button"
                className="bottom-action"
                onClick={onReserve}
                disabled={!canReserve}
                style={
                  !canReserve
                    ? {
                        background: "#e4e4e4",
                        borderColor: "#d4d4d4",
                        color: "#9e9e9e",
                        cursor: "not-allowed",
                      }
                    : undefined
                }
              >
                택시팟 예약하기
              </button>
            </div>
            {!canReserve && (
              <span style={{ fontSize: "12px", color: "var(--color-muted)" }}>
                아직 인원이 모자랍니다
              </span>
            )}
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

// 사용자 입금 및 예약 관련 기능을 처리하는 스크린 컴포넌트입니다.
function TaxiPotDepositScreen({
  taxiPot,
  likeCount,
  anonymousKey,
  anonymousUserId,
  defaultDisplayName,
  defaultPhone,
  defaultRefundAccount,
  onProfileUpdated,
  onBack,
  onClose,
}: {
  taxiPot: TaxiPot;
  likeCount: number;
  anonymousKey: string;
  anonymousUserId: string;
  defaultDisplayName: string;
  defaultPhone: string;
  defaultRefundAccount: string;
  onProfileUpdated: (name: string, phone: string, account: string) => void;
  onBack: () => void;
  onClose: () => void;
}) {
  const [depositorName, setDepositorName] = useState(defaultDisplayName || "");
  const [depositorAccount, setDepositorAccount] = useState(defaultRefundAccount || "");
  const [depositorPhone, setDepositorPhone] = useState(defaultPhone || "");

  useEffect(() => {
    if (defaultDisplayName) setDepositorName(defaultDisplayName);
  }, [defaultDisplayName]);

  useEffect(() => {
    if (defaultRefundAccount) setDepositorAccount(defaultRefundAccount);
  }, [defaultRefundAccount]);

  useEffect(() => {
    if (defaultPhone) setDepositorPhone(defaultPhone);
  }, [defaultPhone]);
  const [error, setError] = useState("");
  const [showSuccessPopup, setShowSuccessPopup] = useState(false);
  const [copied, setCopied] = useState(false);

  // 한국 휴대폰 번호 형식(010-XXXX-XXXX)으로 입력값을 자동 변환해 주는 포맷터 함수입니다.
  const formatPhoneNumber = (value: string) => {
    const cleaned = value.replace(/\D/g, "");
    if (cleaned.length <= 3) {
      return cleaned;
    }
    if (cleaned.length <= 6) {
      return `${cleaned.slice(0, 3)}-${cleaned.slice(3)}`;
    }
    if (cleaned.length <= 10) {
      return `${cleaned.slice(0, 3)}-${cleaned.slice(3, 6)}-${cleaned.slice(6)}`;
    }
    return `${cleaned.slice(0, 3)}-${cleaned.slice(3, 7)}-${cleaned.slice(7, 11)}`;
  };

  // Calculate values
  const combined = taxiPot.origin + taxiPot.destination;
  let hash = 0;
  for (let i = 0; i < combined.length; i++) {
    hash = combined.charCodeAt(i) + ((hash << 5) - hash);
  }

  // 예상 택시비 총액 계산 (기존에 입력된 값이 없으면 출발/도착지 기반 mock 요금 생성)
  let totalFare = 0;
  if (taxiPot.estimatedFare) {
    const totalFareParsed = parseFloat(taxiPot.estimatedFare);
    if (!isNaN(totalFareParsed) && totalFareParsed > 0) {
      totalFare = totalFareParsed;
    }
  }
  if (totalFare <= 0) {
    const baseFare = getMockFareNumber(taxiPot.origin, taxiPot.destination);
    totalFare = baseFare * 5;
  }

  // 참여 인원 수(n) 결정: 찜하기 횟수(likeCount)로 설정하며, 0인 경우에는 최소 1로 설정하여 0 나누기 오류를 방지합니다.
  const n = Math.max(1, likeCount);

  // 예상 정산 금액: [예상 택시비 (총액) + 1,000 * n] / n (100원 단위 올림)
  const estimatedFareNum = Math.ceil(((totalFare + (1000 * n)) / n) / 100) * 100;

  // 선입금: 예상 정산 금액 + 2000원
  const depositAmountNum = estimatedFareNum + 2000;

  // 예상 환급액: 선입금 - 예상 정산 금액 (항상 2000원)
  const estimatedRefundNum = depositAmountNum - estimatedFareNum;

  // Clicks count & money calculation
  const initialCount = (Math.abs(hash) % 3) + 1; // 1, 2, or 3 initial participants
  const currentCount = initialCount;
  const collectedMoney = currentCount * depositAmountNum;
  const fillPercent = (currentCount / 5) * 100;

  const handleCopy = () => {
    navigator.clipboard.writeText("650701-01-474473");
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    // 모든 필수 값이 입력되었는지 확인합니다.
    if (!depositorName.trim() || !depositorAccount.trim() || !depositorPhone.trim()) {
      setError("모든 필수 항목을 입력해 주세요.");
      return;
    }

    // 입금자명은 한글, 영문, 공백만 입력 가능합니다. (숫자나 특수문자 금지)
    const nameRegex = /^[a-zA-Z가-힣\s]+$/;
    if (!nameRegex.test(depositorName.trim())) {
      setError("입금자명은 한글, 영문, 공백만 입력 가능합니다.");
      return;
    }

    // 은행 및 계좌번호 필드는 한글/영문 텍스트와 숫자를 모두 포함해야 합니다.
    const hasText = /[a-zA-Z가-힣]/.test(depositorAccount);
    const hasNumber = /\d/.test(depositorAccount);
    if (!hasText || !hasNumber) {
      setError("은행/계좌는 은행명(텍스트)과 계좌번호(숫자)를 모두 포함해야 합니다.");
      return;
    }

    // 입금자 전화번호는 01로 시작하는 10~11자리 한국 휴대폰 번호 형태여야 합니다.
    const cleanedPhone = depositorPhone.replace(/\D/g, "");
    if (!cleanedPhone.startsWith("01") || (cleanedPhone.length !== 10 && cleanedPhone.length !== 11)) {
      setError("올바른 한국 휴대폰 번호 형식을 입력해 주세요. (예: 010-XXXX-XXXX)");
      return;
    }

    setError("");

    // 비동기 함수들을 실행하여 Supabase에 예약 및 프로필 정보를 저장합니다.
    (async () => {
      try {
        await createTaxiPotReservation(anonymousKey, anonymousUserId, {
          taxiPotId: taxiPot.id,
          depositorName: depositorName.trim(),
          depositorPhone: depositorPhone,
          refundAccount: depositorAccount.trim(),
          expectedFare: estimatedFareNum,
          depositAmount: depositAmountNum,
          expectedRefund: estimatedRefundNum,
        });

        await updateAnonymousUserProfile(anonymousKey, {
          displayName: depositorName.trim(),
          phone: depositorPhone,
          refundAccount: depositorAccount.trim(),
        });

        // 부모 컴포넌트의 기본값 캐시를 업데이트합니다.
        onProfileUpdated(depositorName.trim(), depositorPhone, depositorAccount.trim());

        setShowSuccessPopup(true);
      } catch (err: any) {
        console.error("예약 등록 중 오류 발생:", err);
        setError("예약 등록에 실패했습니다. 다시 시도해 주세요.");
      }
    })();
  };

  return (
    <>
      <AppHeader
        title="예약 페이지"
        showBack
        onBack={onBack}
      />
      <div className="screen-content home-content" style={{ paddingBottom: "140px" }}>
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
                onChange={(e) => setDepositorPhone(formatPhoneNumber(e.target.value))}
              />
            </FormField>
          </div>

          {error && <p className="form-error modal-form-error">{error}</p>}

          <div className="scroll-bottom-action">
            <BottomActionButton type="submit">
              입금 확인 완료
            </BottomActionButton>
          </div>
        </form>
      </div>

      {showSuccessPopup && (
        <div className="modal-backdrop">
          <div className="modal-content" style={{ padding: "24px", textAlign: "center", borderRadius: "16px", background: "var(--color-bg)", width: "90%", maxWidth: "340px", boxShadow: "0 8px 30px rgba(0, 0, 0, 0.15)" }}>
            <h4 style={{ margin: "0 0 12px 0", fontSize: "17px", fontWeight: "600", color: "var(--color-purple)" }}>
              입금 및 예약 확인 안내
            </h4>
            <p style={{ margin: "0 0 20px 0", fontSize: "13px", lineHeight: "1.6", color: "var(--color-text)", textAlign: "left" }}>
              입금 및 예약 정보가 정상적으로 접수되었습니다.
              <br /><br />
              <strong>10분 이내</strong>에 입금 확인 처리가 완료된 후, 입력하신 연락처를 통해 <strong>택시팟 단톡방 그룹 채팅 링크</strong>로 개별 초대해 드릴 예정입니다.
            </p>
            <BottomActionButton
              type="button"
              onClick={() => {
                setShowSuccessPopup(false);
                onClose();
              }}
            >
              확인
            </BottomActionButton>
          </div>
        </div>
      )}
    </>
  );
}

function TaxiPotItem({
  taxiPot,
  categories,
  onViewDetails,
  actionText = "참여하기",
  alertMinPeople,
  alertPhone,
  likeCount = 0,
}: {
  taxiPot: TaxiPot;
  categories: ConcertCategory[];
  onViewDetails: (taxiPot: TaxiPot) => void;
  actionText?: string;
  alertMinPeople?: string;
  alertPhone?: string;
  likeCount?: number;
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
        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginTop: "2px" }}>
          <span className={getInOutLabel(taxiPot.origin, taxiPot.destination) === "IN" ? "pot-label-in" : "pot-label-out"}>
            {getInOutLabel(taxiPot.origin, taxiPot.destination)}
          </span>
          {likeCount > 0 && (
            <span className="pot-like-badge">
              ♥ {likeCount}
            </span>
          )}
        </div>
        {alertMinPeople && (
          <p className="pot-alert-setting" style={{ color: "var(--color-purple)", fontSize: "11px", marginTop: "4px", fontWeight: "500" }}>
            알림 수신: {alertMinPeople}명 이상{alertPhone ? ` (${alertPhone})` : ""}
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
  selectedDirectionFilter,
  taxiPots,
  onOpenConcerts,
  onChangeDirectionFilter,
  onOpenMenu,
  onCreate,
  onViewDetails,
  likeCounts,
}: {
  categories: ConcertCategory[];
  selectedCategory: ConcertCategory | undefined;
  selectedCategoryId: string;
  selectedDirectionFilter: TaxiPotDirectionFilter;
  taxiPots: TaxiPot[];
  onOpenConcerts: () => void;
  onChangeDirectionFilter: (filter: TaxiPotDirectionFilter) => void;
  onOpenMenu: () => void;
  onCreate: () => void;
  onViewDetails: (taxiPot: TaxiPot) => void;
  likeCounts: Record<string, number>;
}) {
  const visibleTaxiPots = useMemo(() => {
    const categoryById = new Map(
      categories.map((category) => [category.id, category]),
    );

    const categoryFilteredTaxiPots =
      selectedCategoryId === ""
        ? []
        : selectedCategoryId === ALL_CATEGORIES_ID
          ? taxiPots
          : selectedCategory
            ? taxiPots.filter(
                (taxiPot) => taxiPot.categoryId === selectedCategory.id,
              )
            : taxiPots.filter(
                (taxiPot) => taxiPot.categoryId === selectedCategoryId,
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
      <AppHeader title="콘서트 택시팟" showMenuButton onMenuClick={onOpenMenu} />
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
              <TaxiPotItem
                key={taxiPot.id}
                taxiPot={taxiPot}
                categories={categories}
                onViewDetails={onViewDetails}
                likeCount={likeCounts[taxiPot.id] ?? 0}
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
            placeholder="오픈채팅 링크를 첨부해 주세요"
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

// 사용자가 찜하여 저장해둔 택시팟 목록을 조회하는 저장 목록 스크린 컴포넌트입니다.
function TaxiPotSavedScreen({
  taxiPots,
  savedTaxiPotIds,
  categories,
  onBack,
  onViewDetails,
  alertSettings,
  likeCounts,
}: {
  taxiPots: TaxiPot[];
  savedTaxiPotIds: string[];
  categories: ConcertCategory[];
  onBack: () => void;
  onViewDetails: (taxiPot: TaxiPot) => void;
  alertSettings: Record<string, { count: string; phone: string } | string>;
  likeCounts: Record<string, number>;
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
            savedPots.map((taxiPot) => {
              const setting = alertSettings[taxiPot.id];
              const alertMinPeople = typeof setting === "string" ? setting : setting?.count;
              return (
                <TaxiPotItem
                  key={taxiPot.id}
                  taxiPot={taxiPot}
                  categories={categories}
                  onViewDetails={onViewDetails}
                  actionText="상세보기"
                  alertMinPeople={alertMinPeople}
                  likeCount={likeCounts[taxiPot.id] ?? 0}
                />
              );
            })
          ) : (
            <p className="empty-state">저장된 택시팟이 아직 없습니다.</p>
          )}
        </section>
      </div>
    </>
  );
}

// 택시팟을 찜할 때, 알림을 받을 탑승객 수 기준 및 알림용 전화번호를 설정하는 모달 컴포넌트입니다.
function LikeAlertModal({
  taxiPot,
  onClose,
  onSave,
}: {
  taxiPot: TaxiPot;
  onClose: () => void;
  onSave: (count: string, phone: string) => void;
}) {
  const [count, setCount] = useState(() => {
    return taxiPot.minPeople || "4";
  });

  const [phone, setPhone] = useState(() => {
    return localStorage.getItem("concert-taxipot:user-phone") || "";
  });

  const [phoneError, setPhoneError] = useState("");

  const formatPhoneNumber = (value: string) => {
    const cleaned = value.replace(/\D/g, "");
    if (cleaned.length <= 3) {
      return cleaned;
    }
    if (cleaned.length <= 6) {
      return `${cleaned.slice(0, 3)}-${cleaned.slice(3)}`;
    }
    if (cleaned.length <= 10) {
      return `${cleaned.slice(0, 3)}-${cleaned.slice(3, 6)}-${cleaned.slice(6)}`;
    }
    return `${cleaned.slice(0, 3)}-${cleaned.slice(3, 7)}-${cleaned.slice(7, 11)}`;
  };

  const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const formatted = formatPhoneNumber(e.target.value);
    setPhone(formatted);
    
    const cleaned = formatted.replace(/\D/g, "");
    if (cleaned.length > 0 && !cleaned.startsWith("01")) {
      setPhoneError("올바른 휴대폰 번호를 입력해 주세요. (예: 010-XXXX-XXXX)");
    } else if (cleaned.length > 0 && cleaned.length < 10) {
      setPhoneError("전화번호가 너무 짧습니다.");
    } else {
      setPhoneError("");
    }
  };

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

  const handleSave = () => {
    const cleaned = phone.replace(/\D/g, "");
    if (!phone.trim()) {
      setPhoneError("전화번호를 입력해 주세요.");
      return;
    }
    if (!cleaned.startsWith("01") || (cleaned.length !== 10 && cleaned.length !== 11)) {
      setPhoneError("올바른 휴대폰 번호를 입력해 주세요. (예: 010-XXXX-XXXX)");
      return;
    }
    
    localStorage.setItem("concert-taxipot:user-phone", phone);
    onSave(count, phone);
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
            탑승 인원에 따라 개인 부담 금액이 변동됩니다. 알림을 수신할 최소 인원과 연락처를 입력해 주세요.
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

          <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginTop: "16px" }}>
            <label htmlFor="alert-phone-input" style={{ fontSize: "12px", fontWeight: "600", color: "var(--color-muted)" }}>
              전화번호
            </label>
            <input
              id="alert-phone-input"
              type="tel"
              placeholder="010-XXXX-XXXX"
              value={phone}
              onChange={handlePhoneChange}
              style={{
                width: "100%",
                padding: "10px 12px",
                borderRadius: "10px",
                border: phoneError ? "1px solid red" : "1px solid var(--color-line)",
                background: "var(--color-page)",
                color: "var(--color-text)",
                fontSize: "14px",
                outline: "none",
              }}
            />
            {phoneError && (
              <span style={{ fontSize: "11px", color: "red", marginTop: "-2px" }}>
                {phoneError}
              </span>
            )}
          </div>
        </div>
        <div className="modal-footer" style={{ padding: "12px 20px 20px" }}>
          <BottomActionButton onClick={handleSave}>
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

function MaintenanceScreen({ onBypass }: { onBypass: () => void }) {
  const [clicks, setClicks] = useState(0);

  const handleLogoClick = () => {
    setClicks((prev) => {
      const next = prev + 1;
      if (next >= 5) {
        onBypass();
        localStorage.setItem("concert-taxipot:dev-bypass", "true");
        alert("개발자 디버그 모드가 활성화되었습니다.");
        return 0;
      }
      return next;
    });
  };

  return (
    <div className="maintenance-screen">
      <div 
        className="maintenance-logo-container" 
        onClick={handleLogoClick}
      >
        <img 
          className="maintenance-logo" 
          src={loadingImageUrl} 
          alt="" 
        />
      </div>

      <div className="maintenance-text-container">
        <h2 className="maintenance-title">서비스 점검 및 업데이트 중</h2>
        <p className="maintenance-desc">
          더 나은 서비스 제공을 위해 준비 중입니다.
          <br />
          곧 돌아오겠습니다!
        </p>
      </div>
    </div>
  );
}

export default function App() {
  const [screen, setScreen] = useState<Screen>("home");
  const [isDev, setIsDev] = useState<boolean>(() => {
    const hasParam = typeof window !== "undefined" && window.location.search.includes("dev=true");
    const hasLocal = typeof window !== "undefined" && localStorage.getItem("concert-taxipot:dev-bypass") === "true";
    if (hasParam && typeof window !== "undefined") {
      localStorage.setItem("concert-taxipot:dev-bypass", "true");
    }
    return hasParam || hasLocal;
  });
  const [anonymousKey] = useState<string>(() => getOrGenerateAnonymousKey());
  const [anonymousUserId, setAnonymousUserId] = useState<string>("");
  const [defaultDisplayName, setDefaultDisplayName] = useState<string>("");
  const [defaultPhone, setDefaultPhone] = useState<string>("");
  const [defaultRefundAccount, setDefaultRefundAccount] = useState<string>("");
  const [categories, setCategories] = useState<ConcertCategory[]>([]);
  const [selectedCategoryId, setSelectedCategoryId] =
    useState("");
  const [selectedDirectionFilter, setSelectedDirectionFilter] =
    useState<TaxiPotDirectionFilter>("all");
  const [taxiPots, setTaxiPots] = useState<TaxiPot[]>([]);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSavingTaxiPot, setIsSavingTaxiPot] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [selectedTaxiPot, setSelectedTaxiPot] = useState<TaxiPot | null>(null);
  const [depositReferrer, setDepositReferrer] = useState<"details" | "home">("details");
  const [detailsReferrer, setDetailsReferrer] = useState<"home" | "saved">("home");
  const [savedTaxiPotIds, setSavedTaxiPotIds] = useState<string[]>(() => {
    return readLocalStorageJson<string[]>("concert-taxipot:saved", []);
  });

  const [likeCounts, setLikeCounts] = useState<Record<string, number>>(() => {
    return readLocalStorageJson<Record<string, number>>(
      "concert-taxipot:likes",
      {},
    );
  });

  const [alertSettings, setAlertSettings] = useState<Record<string, { count: string; phone: string } | string>>(() => {
    return readLocalStorageJson<Record<string, { count: string; phone: string } | string>>(
      "concert-taxipot:alert-settings",
      {},
    );
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

      // 데이터베이스에서 찜하기 정보를 삭제합니다.
      deleteTaxiPotLike(anonymousKey, id);

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
    const loadingStartedAt = Date.now();
    let isMounted = true;
    let loadingTimeout: number | undefined;

    const loadData = async () => {
      try {
        const [nextCategories, nextTaxiPots, dbLikeCounts, anonUser] = await Promise.all([
          loadConcertCategories(),
          loadTaxiPots(),
          loadAllTaxiPotLikeCounts(),
          ensureAnonymousUser(anonymousKey),
        ]);

        if (!isMounted) {
          return;
        }

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

        // 실시간 찜 개수 동기화
        setLikeCounts((prev) => ({ ...prev, ...dbLikeCounts }));

        // 익명 사용자 프로필 및 찜한 목록 동기화
        if (anonUser) {
          setAnonymousUserId(anonUser.id);
          setDefaultDisplayName(anonUser.display_name);
          setDefaultPhone(anonUser.phone);
          setDefaultRefundAccount(anonUser.refund_account);

          // 데이터베이스에서 사용자의 찜 목록을 가져옵니다.
          const dbSavedIds = await loadUserLikedPotIds(anonymousKey);
          setSavedTaxiPotIds(dbSavedIds);
        }
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

    // 실시간 Supabase Postgres 변경 사항 구독 (찜하기 수 실시간 동기화)
    let subscription: any = null;
    if (supabase) {
      subscription = supabase
        .channel("taxi-pot-saves-realtime")
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "taxi_pot_saves",
          },
          async () => {
            try {
              const freshCounts = await loadAllTaxiPotLikeCounts();
              if (isMounted) {
                setLikeCounts((prev) => ({ ...prev, ...freshCounts }));
              }
            } catch (err) {
              console.error("실시간 찜 개수 동기화 실패:", err);
            }
          }
        )
        .subscribe();
    }

    // 폴링 백업: 실시간 변경 사항을 확실하게 동기화하기 위해 5초 주기 폴링을 추가합니다.
    const pollInterval = window.setInterval(async () => {
      try {
        const freshCounts = await loadAllTaxiPotLikeCounts();
        if (isMounted) {
          setLikeCounts((prev) => ({ ...prev, ...freshCounts }));
        }
      } catch (err) {
        console.error("폴링으로 찜 개수 동기화 실패:", err);
      }
    }, 5000);

    return () => {
      isMounted = false;

      if (loadingTimeout !== undefined) {
        window.clearTimeout(loadingTimeout);
      }

      window.clearInterval(pollInterval);

      if (subscription && supabase) {
        supabase.removeChannel(subscription);
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
      {isLoading ? <LoadingScreen /> : null}
      {error ? <p className="global-error">{error}</p> : null}
      
      {!isLoading && !isDev ? (
        <MaintenanceScreen onBypass={() => setIsDev(true)} />
      ) : (
        <>
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
              onOpenMenu={() => setIsMenuOpen(true)}
              onViewDetails={(taxiPot) => {
                setSelectedTaxiPot(taxiPot);
                setDetailsReferrer("home");
                setScreen("details");
              }}
              likeCounts={likeCounts}
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
              alertMinPeople={
                typeof alertSettings[selectedTaxiPot.id] === "string"
                  ? (alertSettings[selectedTaxiPot.id] as string)
                  : (alertSettings[selectedTaxiPot.id] as { count: string; phone: string })?.count
              }
              alertPhone={
                typeof alertSettings[selectedTaxiPot.id] === "string"
                  ? undefined
                  : (alertSettings[selectedTaxiPot.id] as { count: string; phone: string })?.phone
              }
            />
          ) : null}
          {screen === "deposit" && selectedTaxiPot ? (
            <TaxiPotDepositScreen
              taxiPot={selectedTaxiPot}
              likeCount={likeCounts[selectedTaxiPot.id] ?? 0}
              anonymousKey={anonymousKey}
              anonymousUserId={anonymousUserId}
              defaultDisplayName={defaultDisplayName}
              defaultPhone={defaultPhone}
              defaultRefundAccount={defaultRefundAccount}
              onProfileUpdated={(name, phone, account) => {
                setDefaultDisplayName(name);
                setDefaultPhone(phone);
                setDefaultRefundAccount(account);
              }}
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
              likeCounts={likeCounts}
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
              onClose={() => {
                // 알림 모달을 취소하면 임시로 추가된 로컬 찜 상태와 개수를 되돌립니다.
                const revertedSavedIds = savedTaxiPotIds.filter((item) => item !== likePopupTaxiPot.id);
                const currentCount = likeCounts[likePopupTaxiPot.id] ?? 1;
                const revertedLikeCounts = {
                  ...likeCounts,
                  [likePopupTaxiPot.id]: Math.max(0, currentCount - 1),
                };
                setSavedTaxiPotIds(revertedSavedIds);
                setLikeCounts(revertedLikeCounts);
                localStorage.setItem("concert-taxipot:saved", JSON.stringify(revertedSavedIds));
                localStorage.setItem("concert-taxipot:likes", JSON.stringify(revertedLikeCounts));
                setLikePopupTaxiPot(null);
              }}
              onSave={async (count, phone) => {
                const nextAlertSettings = {
                  ...alertSettings,
                  [likePopupTaxiPot.id]: { count, phone },
                };
                setAlertSettings(nextAlertSettings);
                localStorage.setItem("concert-taxipot:alert-settings", JSON.stringify(nextAlertSettings));

                // 데이터베이스에 찜 정보 및 알림 설정을 저장합니다.
                await insertTaxiPotLike(
                  anonymousKey,
                  anonymousUserId,
                  likePopupTaxiPot.id,
                  parseInt(count, 10),
                  phone
                );

                // 사용자의 연락처 정보를 데이터베이스 프로필에 업데이트하고 캐시합니다.
                await updateAnonymousUserProfile(anonymousKey, { phone });
                setDefaultPhone(phone);

                setLikePopupTaxiPot(null);
              }}
            />
          )}
        </>
      )}
    </MobileShell>
  );
}
