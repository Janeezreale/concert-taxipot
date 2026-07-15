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
  Search,
  Heart,
  Wallet,
  Car,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  User,
  Check,
  Edit2,
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
  loadUserTaxiPotSaveSettings,
  loadUserReservedPotIds,
  loadAllTaxiPotLikeCounts,
  createTaxiPotReservation,
  loadUserReservations,
  trackCreateTaxiPotClick,
} from "./storage";
import { supabase } from "./supabase";
import type {
  ConcertCategory,
  Screen,
  TaxiPot,
  TaxiPotDirectionFilter,
  TaxiPotFormValues,
  TaxiPotNotification,
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

type AlertSettings = Record<string, { count: string; phone: string } | string>;

const defaultForm: TaxiPotFormValues = {
  categoryId: "",
  concertTitle: "",
  origin: "",
  destination: "",
  date: "",
  time: "",
  openChatUrl: "",
  minPeople: "",
  maxPeople: "",
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
  const transitKeywords = [
    "역",
    "공항",
    "터미널",
    "정류장",
    "ktx",
    "KTX",
    "역무실",
  ];
  const isOriginTransit = transitKeywords.some((kw) => origin.includes(kw));
  const isDestTransit = transitKeywords.some((kw) => destination.includes(kw));
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

const getAlertSettingCount = (setting: AlertSettings[string] | undefined) => {
  const rawValue = typeof setting === "string" ? setting : setting?.count;
  if (!rawValue) return null;

  const parsed = parseInt(rawValue, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const buildTaxiPotNotifications = (
  taxiPots: TaxiPot[],
  savedTaxiPotIds: string[],
  alertSettings: AlertSettings,
  likeCounts: Record<string, number>,
  reservedTaxiPotIds: string[],
): TaxiPotNotification[] => {
  const savedIds = new Set(savedTaxiPotIds);
  const reservedIds = new Set(reservedTaxiPotIds);

  return taxiPots
    .filter((taxiPot) => savedIds.has(taxiPot.id))
    .filter((taxiPot) => !reservedIds.has(taxiPot.id))
    .map((taxiPot) => {
      const maxPeopleVal = taxiPot.maxPeople ? parseInt(taxiPot.maxPeople, 10) : 5;
      const maxPeople = isNaN(maxPeopleVal) || maxPeopleVal <= 0 ? 5 : maxPeopleVal;

      const rawCurrentCount = likeCounts[taxiPot.id] ?? 0;
      const currentCount = Math.min(rawCurrentCount, maxPeople);
      const alertMinPeople = getAlertSettingCount(alertSettings[taxiPot.id]);

      if (rawCurrentCount >= maxPeople) {
        return {
          id: `${taxiPot.id}:full`,
          taxiPotId: taxiPot.id,
          type: "full" as const,
          message: `${taxiPot.concertTitle}(${taxiPot.origin}→${taxiPot.destination}) 팟의 인원이 다 찼습니다.(${currentCount}/${maxPeople}) 지금 바로 예약해 주세요!`,
          currentCount,
          targetCount: maxPeople,
          createdAt: taxiPot.date,
          taxiPot,
        };
      }

      if (alertMinPeople !== null && rawCurrentCount >= alertMinPeople) {
        return {
          id: `${taxiPot.id}:threshold_met`,
          taxiPotId: taxiPot.id,
          type: "threshold_met" as const,
          message: `${taxiPot.concertTitle}(${taxiPot.origin}→${taxiPot.destination}) 팟의 희망 인원이 충족되었습니다.(${currentCount}/${maxPeople}) 지금 바로 예약해 주세요!`,
          currentCount,
          targetCount: alertMinPeople,
          createdAt: taxiPot.date,
          taxiPot,
        };
      }

      return null;
    })
    .filter((item): item is TaxiPotNotification => item !== null);
};

const getOrGenerateAnonymousKey = () => {
  let key = localStorage.getItem("concert-taxipot:anonymous-key");
  if (!key) {
    key =
      "anon-" +
      Math.random().toString(36).substring(2, 15) +
      Math.random().toString(36).substring(2, 15);
    localStorage.setItem("concert-taxipot:anonymous-key", key);
  }
  return key;
};

const handleOpenChatClick = async (taxiPot: TaxiPot) => {
  await trackOpenChatClick(taxiPot);
  window.open(taxiPot.openChatUrl, "_blank", "noopener,noreferrer");
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
  onLogoClick,
  showGuideBubble = false,
  onCloseGuideBubble,
}: {
  title: string;
  showBack?: boolean;
  onBack?: () => void;
  showMenuButton?: boolean;
  onMenuClick?: () => void;
  onLogoClick?: () => void;
  showGuideBubble?: boolean;
  onCloseGuideBubble?: () => void;
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
      ) : onLogoClick ? (
        <button
          className="brand-logo-button"
          type="button"
          aria-label="홈으로 이동"
          onClick={onLogoClick}
        >
          <img
            className="brand-logo"
            src="/con-taxi_words.png"
            alt=""
            aria-hidden="true"
          />
        </button>
      ) : (
        <img
          className="brand-logo"
          src="/con-taxi_words.png"
          alt="콘서트 택시팟 로고"
        />
      )}
      {title !== "콘서트 택시팟" ? (
        <h1>{title}</h1>
      ) : (
        <div style={{ flex: 1 }} />
      )}
      {showMenuButton && onMenuClick && (
        <div style={{ position: "relative", display: "inline-flex" }}>
          <button
            className="icon-button menu-toggle-btn"
            type="button"
            aria-label="메뉴 열기"
            onClick={onMenuClick}
          >
            <Menu size={22} strokeWidth={1.8} />
          </button>
          {showGuideBubble && onCloseGuideBubble && (
            <div
              className="guide-bubble"
              onClick={(e) => {
                e.stopPropagation();
                onCloseGuideBubble();
              }}
            >
              <span>
                서비스 안내가 필요하시면 메뉴 버튼을 눌러{" "}
                <strong>서비스 안내</strong>를 확인해 보세요!
              </span>
              <button
                type="button"
                className="bubble-close-btn"
                aria-label="닫기"
                onClick={(e) => {
                  e.stopPropagation();
                  onCloseGuideBubble();
                }}
              >
                &times;
              </button>
              <div className="bubble-arrow" />
            </div>
          )}
        </div>
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

const getCategoryColor = (
  categoryId: string,
  categories: ConcertCategory[],
) => {
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
  const maxPeopleVal = taxiPot.maxPeople ? parseInt(taxiPot.maxPeople, 10) : 5;
  const maxPeopleNum = isNaN(maxPeopleVal) || maxPeopleVal <= 0 ? 5 : maxPeopleVal;

  let totalFare = 0;
  if (taxiPot.estimatedFare) {
    totalFare = parseFloat(taxiPot.estimatedFare);
  }
  if (isNaN(totalFare) || totalFare <= 0) {
    return "산정 중";
  }

  const farePerPerson = Math.ceil((totalFare + 1000 * maxPeopleNum) / maxPeopleNum / 100) * 100;
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
  isFromHome,
  isReserved,
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
  isFromHome: boolean;
  isReserved: boolean;
  onReserve: () => void;
  alertMinPeople?: string;
  alertPhone?: string;
}) {
  const bulletColor = getCategoryColor(taxiPot.categoryId, categories);

  // 최소 탑승 인원 값을 가져옵니다. 설정되어 있지 않다면 undefined로 설정합니다.
  const minPeopleVal = taxiPot.minPeople
    ? parseInt(taxiPot.minPeople, 10)
    : undefined;
  // 최대 탑승 인원 값을 가져옵니다. 설정되어 있지 않다면 5로 설정합니다.
  const maxPeopleVal = taxiPot.maxPeople
    ? parseInt(taxiPot.maxPeople, 10)
    : 5;
  const maxPeopleNum = isNaN(maxPeopleVal) || maxPeopleVal <= 0 ? 5 : maxPeopleVal;

  // 최소 탑승 인원 설정이 없거나, 현재 찜하기 횟수가 최소 인원 이상인 경우 예약이 활성화됩니다.
  const canReserve =
    !isReserved &&
    (minPeopleVal === undefined ||
      isNaN(minPeopleVal) ||
      likeCount >= minPeopleVal);
  // 실제 찜 개수는 유지하면서, 정원이 찰 때마다 다음 팟 모집 인원으로 순환해 표시합니다.
  const remainingSeats = maxPeopleNum - (likeCount % maxPeopleNum);

  // 최소 탑승 인원 기준 충족 여부 (최소 인원 설정이 없으면 0으로 간주하여 항상 충족)
  const effectiveMinPeople =
    minPeopleVal === undefined || isNaN(minPeopleVal) ? 0 : minPeopleVal;
  const isMeetMinPeople = likeCount >= effectiveMinPeople;

  // 두 버튼을 가로로 함께 보여주는 조건: (홈에서 진입했거나) 또는 (상세정보를 저장 목록에서 진입했고 + 찜하기를 한 상태) 또는 (최소 인원을 이미 충족한 상태)
  const shouldShowTwoButtons =
    isFromHome || (showReserveButton && isLiked) || isMeetMinPeople;

  const isFareNotAssigned =
    !taxiPot.estimatedFare ||
    isNaN(parseFloat(taxiPot.estimatedFare)) ||
    parseFloat(taxiPot.estimatedFare) <= 0;

  const isDisableReserveButton =
    isFareNotAssigned || (isFromHome ? isReserved : !canReserve);
  const reserveButtonStyle = isDisableReserveButton
    ? {
        background: "#eeeeee",
        borderColor: "#d4d4d4",
        color: "#8a8a8a",
        cursor: "not-allowed",
      }
    : undefined;

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
            <span className="detail-value">
              {formatDateTime(taxiPot.date, taxiPot.time)}
            </span>
          </div>
          <div className="detail-row">
            <span className="detail-label">최소 인원</span>
            <span className="detail-value">
              {taxiPot.minPeople ? `${taxiPot.minPeople}명` : "없음"}
            </span>
          </div>
          <div className="detail-row">
            <span className="detail-label">최대 인원</span>
            <span className="detail-value">
              {taxiPot.maxPeople ? `${taxiPot.maxPeople}명` : "5명"}
            </span>
          </div>
          {isLiked && alertMinPeople && (
            <div className="detail-row">
              <span className="detail-label">알림 설정</span>
              <span
                className="detail-value"
                style={{ color: "var(--color-purple)", fontWeight: "600" }}
              >
                {alertMinPeople}명 이상 시 알림 수신
                {alertPhone ? ` (${alertPhone})` : ""}
              </span>
            </div>
          )}
          <div className="detail-row">
            <span className="detail-label">추가사항</span>
            <span className="detail-value additional-notes">
              {taxiPot.notes && taxiPot.notes.trim()
                ? taxiPot.notes
                : "합승 인원 모집 중입니다. 편하게 연락주세요!"}
            </span>
          </div>

          <div className="detail-row">
            <span className="detail-label">인당 예상 요금 (만석 기준)</span>
            <span className="detail-value">{getDisplayFare(taxiPot)}</span>
          </div>
          <div className="detail-row detail-row-special">
            <span className="fond-semibold">
              마감까지 {remainingSeats}자리 남았어요!
            </span>
          </div>
        </div>

        {shouldShowTwoButtons ? (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              width: "100%",
              marginTop: "20px",
              marginBottom: "20px",
            }}
          >
            <div
              className="detail-actions-row"
              style={{ width: "100%", marginBottom: "8px" }}
            >
              <button
                type="button"
                className="bottom-action"
                onClick={onToggleLike}
              >
                택시팟 찜하기 {isLiked ? "♥" : "♡"}
                {likeCount > 0 ? ` ${likeCount}` : ""}
              </button>
              <button
                type="button"
                className="bottom-action"
                onClick={() => {
                  if (isFromHome && !canReserve) {
                    if (!isLiked) {
                      onToggleLike();
                    } else {
                      alert("아직 인원이 모자랍니다");
                    }
                  } else {
                    onReserve();
                  }
                }}
                disabled={isDisableReserveButton}
                style={reserveButtonStyle}
              >
                {isReserved ? "예약 완료" : "택시팟 예약하기"}
              </button>
            </div>
            {isReserved ? (
              <span style={{ fontSize: "12px", color: "var(--color-muted)" }}>
                이미 예약한 택시팟입니다
              </span>
            ) : isFareNotAssigned ? (
              <span style={{ fontSize: "12px", color: "var(--color-muted)" }}>
                예상 택시비가 산정된 후 예약이 가능합니다.
              </span>
            ) : !canReserve ? (
              <span style={{ fontSize: "12px", color: "var(--color-muted)" }}>
                아직 인원이 모자랍니다
              </span>
            ) : null}
          </div>
        ) : (
          <div
            className="detail-action"
            style={{ marginTop: "20px", marginBottom: "20px" }}
          >
            <button
              type="button"
              className="bottom-action"
              onClick={onToggleLike}
            >
              택시팟 찜하기 {isLiked ? "♥" : "♡"}
              {likeCount > 0 ? ` ${likeCount}` : ""}
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
  onReservationCreated,
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
  onReservationCreated: (taxiPotId: string, phone: string) => void;
  onBack: () => void;
  onClose: () => void;
}) {
  const [depositorName, setDepositorName] = useState(defaultDisplayName || "");
  const [depositorAccount, setDepositorAccount] = useState(
    defaultRefundAccount || "",
  );
  const [depositorPhone, setDepositorPhone] = useState(defaultPhone || "");
  const [showTooltip, setShowTooltip] = useState(true);

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

  const maxPeopleVal = taxiPot.maxPeople ? parseInt(taxiPot.maxPeople, 10) : 5;
  const maxPeopleNum = isNaN(maxPeopleVal) || maxPeopleVal <= 0 ? 5 : maxPeopleVal;

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
    totalFare = baseFare * maxPeopleNum;
  }

  // 참여 인원 수(n) 결정: 찜하기 횟수(likeCount)로 설정하되, 최대인원(maxPeopleNum)을 넘지 않도록 제한합니다. 0인 경우에는 최소 1로 설정하여 0 나누기 오류를 방지합니다.
  const n = Math.min(maxPeopleNum, Math.max(1, likeCount));

  // 예약 확정금은 1,000원으로 고정
  const depositAmountNum = 1000;

  // Clicks count & money calculation
  const initialCount = (Math.abs(hash) % 3) + 1; // 1, 2, or 3 initial participants
  const currentCount = initialCount;
  const collectedMoney = currentCount * depositAmountNum;
  const fillPercent = (currentCount / maxPeopleNum) * 100;

  const handleCopy = () => {
    navigator.clipboard.writeText("650701-01-474473");
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    // 모든 필수 값이 입력되었는지 확인합니다.
    if (
      !depositorName.trim() ||
      !depositorAccount.trim() ||
      !depositorPhone.trim()
    ) {
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
      setError(
        "은행/계좌는 은행명(텍스트)과 계좌번호(숫자)를 모두 포함해야 합니다.",
      );
      return;
    }

    // 입금자 전화번호는 01로 시작하는 10~11자리 한국 휴대폰 번호 형태여야 합니다.
    const cleanedPhone = depositorPhone.replace(/\D/g, "");
    if (
      !cleanedPhone.startsWith("01") ||
      (cleanedPhone.length !== 10 && cleanedPhone.length !== 11)
    ) {
      setError(
        "올바른 한국 휴대폰 번호 형식을 입력해 주세요. (예: 010-XXXX-XXXX)",
      );
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
          expectedFare: 0,
          depositAmount: 1000,
          expectedRefund: 0,
        });

        await updateAnonymousUserProfile(anonymousKey, {
          displayName: depositorName.trim(),
          phone: depositorPhone,
          refundAccount: depositorAccount.trim(),
        });

        // 부모 컴포넌트의 기본값 캐시를 업데이트합니다.
        onProfileUpdated(
          depositorName.trim(),
          depositorPhone,
          depositorAccount.trim(),
        );
        onReservationCreated(taxiPot.id, depositorPhone);

        setShowSuccessPopup(true);
      } catch (err: any) {
        console.error("예약 등록 중 오류 발생:", err);
        const errorCode =
          typeof err?.code === "string" && err.code.trim()
            ? err.code.trim()
            : "UNKNOWN";
        const errorMessage =
          typeof err?.message === "string" && err.message.trim()
            ? err.message.trim()
            : "알 수 없는 오류";
        setError(
          `예약 등록에 실패했습니다. (${errorCode}) ${errorMessage}`,
        );
      }
    })();
  };

  return (
    <>
      <AppHeader title="예약 페이지" showBack onBack={onBack} />
      <div
        className="screen-content home-content"
        style={{ paddingBottom: "140px" }}
      >
        <form
          onSubmit={handleSubmit}
          style={{ display: "flex", flexDirection: "column", gap: "20px" }}
        >
          <div className="deposit-calc-card">
            <div className="calc-row highlighted-row">
              <span className="calc-label">예약 확정금</span>
              <span className="calc-value highlight-value">
                1,000원
              </span>
            </div>
          </div>

          <div className="front-deposit-reason">
            <p>
              예약 확정 후, 즉시 이용 관련 사항을 바로 전달해 드립니다.
              <br />
              <br />
              노쇼 방지 차원에서 선불 제도를 운영합니다.
              <br />
              입금하신 예약 확정금은 안전하게 보관됩니다.
            </p>
          </div>

          <div className="account-details-card">
            <div className="account-title">입금 계좌</div>
            <div className="account-grid">
              <span className="grid-label">은행</span>
              <span className="grid-value">하나은행</span>

              <span className="grid-label">계좌번호</span>
              <div className="account-num-wrapper">
                <span className="grid-value">21191088234407</span>
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
              <span className="grid-value">고나영</span>

              <span className="grid-label">대표자 번호</span>
              <span className="grid-value">010-6899-6406</span>

              <span className="grid-label">금액</span>
              <span className="grid-value">
                {depositAmountNum.toLocaleString()}원
              </span>
            </div>
          </div>

          <div className="account-creation-notice">
            <span>입력된 정보는 이 기기에 자동으로 저장됩니다.</span>
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
                onChange={(e) =>
                  setDepositorPhone(formatPhoneNumber(e.target.value))
                }
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
          <div
            className="modal-content"
            style={{
              padding: "24px",
              textAlign: "center",
              borderRadius: "16px",
              background: "var(--color-bg)",
              width: "90%",
              maxWidth: "340px",
              boxShadow: "0 8px 30px rgba(0, 0, 0, 0.15)",
            }}
          >
            <h4
              style={{
                margin: "0 0 12px 0",
                fontSize: "17px",
                fontWeight: "600",
                color: "var(--color-purple)",
              }}
            >
              입금 및 예약 확인 안내
            </h4>
            <p
              style={{
                margin: "0 0 20px 0",
                fontSize: "13px",
                lineHeight: "1.6",
                color: "var(--color-text)",
                textAlign: "left",
              }}
            >
              입금 및 예약 정보가 정상적으로 접수되었습니다.
              <br />
              <br />
              아래 링크를 통해 해당 택시팟에 입장하신 후 <br />상세한 안내를 받아보시기 바랍니다.
            </p>
            <BottomActionButton
              type="button"
              onClick={() => {
                window.open("https://open.kakao.com/o/sO4swcEi", "_blank", "noopener,noreferrer");
                setShowSuccessPopup(false);
                onClose();
              }}
            >
              입장하기
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
      <div
        className="route-icon"
        aria-hidden="true"
        style={{ color: bulletColor }}
      >
        <CircleDot size={15} strokeWidth={2.1} />
      </div>
      <div className="taxi-pot-body">
        <h2>
          {taxiPot.origin} → {taxiPot.destination}
        </h2>
        <p>{formatDateTime(taxiPot.date, taxiPot.time)}</p>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            marginTop: "2px",
          }}
        >
          <span
            className={
              getInOutLabel(taxiPot.origin, taxiPot.destination) === "IN"
                ? "pot-label-in"
                : "pot-label-out"
            }
          >
            {getInOutLabel(taxiPot.origin, taxiPot.destination)}
          </span>
          {likeCount > 0 && (
            <span className="pot-like-badge">♥ {likeCount}</span>
          )}
        </div>
        {alertMinPeople && (
          <p
            className="pot-alert-setting"
            style={{
              color: "var(--color-purple)",
              fontSize: "11px",
              marginTop: "4px",
              fontWeight: "500",
            }}
          >
            알림 수신: {alertMinPeople}명 이상
            {alertPhone ? ` (${alertPhone})` : ""}
          </p>
        )}
      </div>
      <button
        className="chat-button"
        type="button"
        onClick={() => onViewDetails(taxiPot)}
      >
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
  onLogoClick,
  onOpenMenu,
  onCreate,
  onViewDetails,
  likeCounts,
  showGuideBubble,
  onCloseGuideBubble,
}: {
  categories: ConcertCategory[];
  selectedCategory: ConcertCategory | undefined;
  selectedCategoryId: string;
  selectedDirectionFilter: TaxiPotDirectionFilter;
  taxiPots: TaxiPot[];
  onOpenConcerts: () => void;
  onChangeDirectionFilter: (filter: TaxiPotDirectionFilter) => void;
  onLogoClick: () => void;
  onOpenMenu: () => void;
  onCreate: () => void;
  onViewDetails: (taxiPot: TaxiPot) => void;
  likeCounts: Record<string, number>;
  showGuideBubble: boolean;
  onCloseGuideBubble: () => void;
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
      <AppHeader
        title="콘서트 택시팟"
        showMenuButton
        onMenuClick={onOpenMenu}
        onLogoClick={onLogoClick}
        showGuideBubble={showGuideBubble}
        onCloseGuideBubble={onCloseGuideBubble}
      />
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
          <span
            className="bullet"
            style={{ background: "var(--color-purple)" }}
          />
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
      !values.minPeople ||
      !values.minPeople.trim() ||
      !values.maxPeople ||
      !values.maxPeople.trim()
    ) {
      setError("모든 필수 항목을 입력해 주세요.");
      return;
    }

    const minPeopleNum = parseInt(values.minPeople.trim(), 10);
    const maxPeopleNum = parseInt(values.maxPeople.trim(), 10);

    if (isNaN(minPeopleNum) || minPeopleNum < 1) {
      setError("최소 인원은 1명 이상이어야 합니다.");
      return;
    }

    if (isNaN(maxPeopleNum) || maxPeopleNum < 2) {
      setError("최대 인원은 2명 이상이어야 합니다.");
      return;
    }

    if (minPeopleNum > maxPeopleNum) {
      setError("최소 인원은 최대 인원보다 클 수 없습니다.");
      return;
    }

    if (maxPeopleNum > 5) {
      setError("최대 인원은 5명 이하여야 합니다.");
      return;
    }

    const selectedDateTime = new Date(`${values.date}T${values.time}`);
    if (isNaN(selectedDateTime.getTime())) {
      setError("올바른 날짜와 시간을 입력해 주세요.");
      return;
    }

    if (selectedDateTime < new Date()) {
      setError("출발 일시는 현재 시간 이후여야 합니다.");
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
              min={(() => {
                const today = new Date();
                const yyyy = today.getFullYear();
                const mm = String(today.getMonth() + 1).padStart(2, "0");
                const dd = String(today.getDate()).padStart(2, "0");
                return `${yyyy}-${mm}-${dd}`;
              })()}
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
        <FormField label="최소 인원">
          <input
            type="number"
            value={values.minPeople || ""}
            onChange={(event) => updateField("minPeople", event.target.value)}
          />
        </FormField>
        <FormField label="최대 인원">
          <input
            placeholder="2-5"
            type="number"
            value={values.maxPeople || ""}
            onChange={(event) => updateField("maxPeople", event.target.value)}
          />
        </FormField>
        <FormField label="추가사항 (선택)">
          <input
            placeholder="예: 여자만, 여유 있게 콘서트 보고 가실 분"
            value={values.notes || ""}
            onChange={(event) => updateField("notes", event.target.value)}
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
              const alertMinPeople =
                typeof setting === "string" ? setting : setting?.count;
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

function NotificationScreen({
  notifications,
  onBack,
  onReserve,
}: {
  notifications: TaxiPotNotification[];
  onBack: () => void;
  onReserve: (taxiPot: TaxiPot) => void;
}) {
  return (
    <>
      <AppHeader title="알림" showBack onBack={onBack} />
      <div className="screen-content notification-content">
        <section className="notification-list" aria-label="알림 목록">
          {notifications.length > 0 ? (
            notifications.map((notification) => {
              const isFareNotAssigned = !notification.taxiPot.estimatedFare ||
                isNaN(parseFloat(notification.taxiPot.estimatedFare)) ||
                parseFloat(notification.taxiPot.estimatedFare) <= 0;
              return (
                <article className="notification-item" key={notification.id}>
                  <span className="notification-bullet" aria-hidden="true" />
                  <div className="notification-body">
                    <p className="notification-message">{notification.message}</p>
                    <button
                      type="button"
                      className="notification-reserve-button"
                      onClick={() => onReserve(notification.taxiPot)}
                      disabled={isFareNotAssigned}
                      style={
                        isFareNotAssigned
                          ? {
                              background: "#eeeeee",
                              borderColor: "#d4d4d4",
                              color: "#8a8a8a",
                              cursor: "not-allowed",
                            }
                          : undefined
                      }
                    >
                      예약하기
                    </button>
                    {isFareNotAssigned && (
                      <span style={{ fontSize: "11px", color: "var(--color-muted)", marginTop: "4px", display: "block" }}>
                        예상 택시비가 산정된 후 예약이 가능합니다.
                      </span>
                    )}
                  </div>
                </article>
              );
            })
          ) : (
            <p className="empty-state">새로운 알림이 없습니다.</p>
          )}
        </section>
      </div>
    </>
  );
}

function ServiceGuideScreen({ onBack }: { onBack: () => void }) {
  const [openIndexes, setOpenIndexes] = useState<Record<number, boolean>>({
    0: true, // first QA open by default
  });

  const toggleIndex = (index: number) => {
    setOpenIndexes((prev) => ({
      ...prev,
      [index]: !prev[index],
    }));
  };

  const steps = [
    {
      title: "팟 검색",
      desc: "내가 원하는 목적지와 시간대의 팟을 찾습니다.",
      icon: <Search size={16} className="step-icon-svg" />,
      colorClass: "step-search",
    },
    {
      title: "찜하기",
      desc: "마음에 드는 팟을 미리 찜해두고 비교합니다.",
      icon: <Heart size={16} className="step-icon-svg" />,
      colorClass: "step-like",
    },
    {
      title: "예약 확정금 입금",
      desc: "예약 확정금 1,000원을 입금하면 최종 참여 및 채팅방 입장이 완료됩니다.",
      icon: <Wallet size={16} className="step-icon-svg" />,
      colorClass: "step-payment",
    },
    {
      title: "동승 및 출발",
      desc: "콘서트 종료 후 약속된 장소에서 만나 택시에 탑승합니다.",
      icon: <Car size={16} className="step-icon-svg" />,
      colorClass: "step-ride",
    },
    {
      title: "현장 정산",
      desc: "실제 발생한 택시비를 탑승 인원수만큼 나누어 현장에서 정산합니다.",
      icon: <RefreshCw size={16} className="step-icon-svg" />,
      colorClass: "step-refund",
    },
  ];

  const qas = [
    {
      q: "왜 예약 확정금을 입금해야 하나요?",
      a: "당일 갑작스러운 잠수(노쇼) 피해를 원천 차단하고 신뢰할 수 있는 팟 참여를 보장하기 위함입니다.",
    },
    {
      q: "택시비 정산은 어떻게 진행되나요?",
      a: "목적지 하차 후 동승자들과 실제 발생한 택시비를 인원수대로 나누어 현장에서 정산합니다.",
    },
    {
      q: "동승자 중 한 명이 당일에 안 오면 어떻게 되나요?",
      a: "노쇼 유저의 예약 확정금은 환불되지 않으며, 택시팟이 결성되지 않거나 취소될 경우 예약 확정금은 전액 환불됩니다.",
    },
  ];

  return (
    <>
      <AppHeader title="서비스 안내" showBack onBack={onBack} />
      <div className="screen-content guide-content">
        <section className="guide-intro">
          <h2>안심 택시 팟 이용 가이드</h2>
          <p>
            콘서트 종료 후 안전하고 편안하게 귀가할 수 있도록, 노쇼 없는 안심
            택시 팟의 전반적인 이용 흐름을 안내해 드립니다.
          </p>
        </section>

        <section className="guide-process-section">
          <div className="process-timeline">
            {steps.map((step, idx) => (
              <div className="timeline-item" key={idx}>
                <div className={`timeline-icon ${step.colorClass}`}>
                  {step.icon}
                </div>
                <div className="timeline-content">
                  <div className="step-number">Step {idx + 1}</div>
                  <h4>{step.title}</h4>
                  <p>{step.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="guide-qa-section">
          <h3 className="section-title">💬 자주 묻는 질문 (Q&A)</h3>
          <div className="qa-accordion">
            {qas.map((qa, idx) => {
              const isOpen = !!openIndexes[idx];
              return (
                <div key={idx} className={`qa-item ${isOpen ? "open" : ""}`}>
                  <button
                    type="button"
                    className="qa-question"
                    onClick={() => toggleIndex(idx)}
                    aria-expanded={isOpen}
                  >
                    <div className="qa-q-container">
                      <span className="qa-q-prefix">Q.</span>
                      <span className="qa-q-text">{qa.q}</span>
                    </div>
                    <ChevronDown className="qa-chevron" size={18} />
                  </button>
                  <div className="qa-answer-container">
                    <div className="qa-answer">
                      <span className="qa-a-prefix">A.</span>
                      <p className="qa-a-text">{qa.a}</p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <div className="guide-bottom-spacer" />
      </div>
    </>
  );
}

interface MyInfoScreenProps {
  anonymousKey: string;
  anonymousUserId: string;
  onBack: () => void;
  isDev: boolean;
}

function MyInfoScreen({ anonymousKey, anonymousUserId, onBack, isDev }: MyInfoScreenProps) {
  const [customIdInfo, setCustomIdInfo] = useState<{ customWord: string; editCount: number }>(() => {
    return readLocalStorageJson("concert-taxipot:custom-id-info", { customWord: "", editCount: 0 });
  });

  const [isIdModalOpen, setIsIdModalOpen] = useState(false);
  const [inputWord, setInputWord] = useState(customIdInfo.customWord);
  const [reservations, setReservations] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"usage" | "deposit">("usage");
  const [expandedRows, setExpandedRows] = useState<Record<string, boolean>>({});

  const isPotPast = (pot: any) => {
    if (!pot || !pot.date || !pot.time) return true;
    try {
      const potDateTime = new Date(`${pot.date}T${pot.time}`);
      return potDateTime < new Date();
    } catch {
      return true;
    }
  };

  const usageHistory = useMemo(() => {
    return reservations.filter((res) => {
      const isConfirmed = res.status === "deposit_confirmed" || res.status === "joined_chat";
      const pot = res.taxi_pot;
      return isConfirmed && isPotPast(pot);
    });
  }, [reservations]);

  const depositHistory = useMemo(() => {
    return reservations.filter((r) => r.depositAmount > 0);
  }, [reservations]);

  const uuidSuffix = useMemo(() => {
    if (anonymousUserId) {
      return anonymousUserId.substring(0, 4);
    }
    let offlineId = localStorage.getItem("concert-taxipot:offline-user-id");
    if (!offlineId) {
      offlineId = "off-" + Math.random().toString(36).substring(2, 6);
      localStorage.setItem("concert-taxipot:offline-user-id", offlineId);
    }
    return offlineId.substring(0, 4);
  }, [anonymousUserId]);

  const combinedId = customIdInfo.customWord 
    ? `${customIdInfo.customWord}${uuidSuffix}` 
    : `(설정필요)${uuidSuffix}`;

  useEffect(() => {
    let isMounted = true;
    const fetchReservations = async () => {
      try {
        const resList = await loadUserReservations(anonymousKey);
        if (isMounted) {
          setReservations(resList);
        }
      } catch (err) {
        console.error("Failed to load reservations:", err);
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };
    fetchReservations();
    return () => {
      isMounted = false;
    };
  }, [anonymousKey]);

  const handleSaveId = () => {
    const trimmed = inputWord.trim();
    if (!trimmed) {
      alert("ID로 사용할 단어를 입력해 주세요.");
      return;
    }
    if (customIdInfo.editCount >= 3) {
      alert("ID 수정 횟수(최대 3회)를 초과하여 더 이상 수정할 수 없습니다.");
      return;
    }

    const nextCount = customIdInfo.editCount + 1;
    const nextInfo = {
      customWord: trimmed,
      editCount: nextCount,
    };
    setCustomIdInfo(nextInfo);
    localStorage.setItem("concert-taxipot:custom-id-info", JSON.stringify(nextInfo));
    alert(`ID가 변경되었습니다! (남은 수정 가능 횟수: ${3 - nextCount}회)`);
    setIsIdModalOpen(false);
  };

  const handleCopyId = () => {
    navigator.clipboard.writeText(combinedId);
    alert("ID가 클립보드에 복사되었습니다.");
  };

  const toggleRow = (id: string) => {
    setExpandedRows((prev) => ({
      ...prev,
      [id]: !prev[id],
    }));
  };

  const formatAmount = (num: number) => {
    return num.toLocaleString() + "원";
  };

  const getStatusBadgeClass = (status: string) => {
    switch (status) {
      case "submitted": return "badge-submitted";
      case "deposit_confirmed": return "badge-confirmed";
      case "joined_chat": return "badge-joined";
      case "cancelled": return "badge-cancelled";
      case "refunded": return "badge-refunded";
      default: return "";
    }
  };

  const getStatusText = (status: string) => {
    switch (status) {
      case "submitted": return "신청완료";
      case "deposit_confirmed": return "입금확인";
      case "joined_chat": return "채팅참여";
      case "cancelled": return "취소됨";
      case "refunded": return "환불완료";
      default: return status;
    }
  };

  const getTaxiPotStatusText = (status?: string) => {
    switch (status) {
      case "open": return "모집중";
      case "closed": return "모집마감";
      case "cancelled": return "취소됨";
      default: return "상태불명";
    }
  };

  const formatPotDateTime = (date: string, time: string) => {
    const formattedTime = time ? time.split(":").slice(0, 2).join(":") : "";
    return `${date} ${formattedTime}`;
  };

  return (
    <>
      <AppHeader title="나의 정보" showBack onBack={onBack} />
      <div className="screen-content my-info-content">
        <section className="profile-card">
          <div className="profile-avatar">
            <User size={24} className="avatar-icon" />
          </div>
          <div className="profile-details">
            <div className="id-flex-wrapper">
              <div 
                className="id-container clickable-id-trigger"
                onClick={() => {
                  setInputWord(customIdInfo.customWord);
                  setIsIdModalOpen(true);
                }}
                title="ID 설정 변경"
              >
                <span className="profile-id">{combinedId}</span>
                <Edit2 size={14} className="edit-icon-indicator" />
              </div>
              <button 
                type="button" 
                className="copy-button" 
                onClick={(e) => {
                  e.stopPropagation();
                  handleCopyId();
                }}
                title="ID 복사"
              >
                <Copy size={14} />
              </button>
            </div>
          </div>
        </section>

        <div className="my-info-tabs">
          <button
            type="button"
            className={`tab-btn ${activeTab === "usage" ? "active" : ""}`}
            onClick={() => setActiveTab("usage")}
          >
            사용 내역 ({usageHistory.length})
          </button>
          <button
            type="button"
            className={`tab-btn ${activeTab === "deposit" ? "active" : ""}`}
            onClick={() => setActiveTab("deposit")}
          >
            입금 내역 ({depositHistory.length})
          </button>
        </div>

        <div className="tab-content">
          {loading ? (
            <div className="history-loading">내역을 불러오는 중...</div>
          ) : (activeTab === "usage" ? usageHistory.length === 0 : depositHistory.length === 0) ? (
            <div className="history-empty">내역이 없습니다.</div>
          ) : activeTab === "usage" ? (
            <div className="usage-list">
              {usageHistory.map((res) => {
                const isExpanded = !!expandedRows[res.id];
                const pot = res.taxi_pot;
                const formattedDate = pot 
                  ? formatPotDateTime(pot.date, pot.time)
                  : new Date(res.createdAt).toLocaleDateString();

                return (
                  <div key={res.id} className={`usage-row-item ${isExpanded ? "expanded" : ""}`}>
                    <button
                      type="button"
                      className="usage-row-summary"
                      onClick={() => toggleRow(res.id)}
                    >
                      <span className="usage-date">{formattedDate}</span>
                      <span className="usage-chevron">
                        {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                      </span>
                    </button>

                    {isExpanded && (
                      <div className="usage-row-details">
                        {pot ? (
                          <>
                            <div className="detail-item">
                              <span className="detail-label">콘서트</span>
                              <span className="detail-value font-bold">{pot.concertTitle}</span>
                            </div>
                            <div className="detail-item">
                              <span className="detail-label">경로</span>
                              <span className="detail-value">{pot.origin} ➔ {pot.destination}</span>
                            </div>
                            <div className="detail-item">
                              <span className="detail-label">팟 모집상태</span>
                              <span className="detail-value">{getTaxiPotStatusText(pot.status)}</span>
                            </div>
                          </>
                        ) : (
                          <div className="detail-item">
                            <span className="detail-label">팟 정보</span>
                            <span className="detail-value text-muted">삭제되었거나 없는 팟입니다.</span>
                          </div>
                        )}
                        <div className="detail-item">
                          <span className="detail-label">나의 예약상태</span>
                          <span className={`detail-value badge ${getStatusBadgeClass(res.status)}`}>
                            {getStatusText(res.status)}
                          </span>
                        </div>
                        <div className="detail-item">
                          <span className="detail-label">예약 확정금</span>
                          <span className="detail-value">{formatAmount(res.depositAmount)}</span>
                        </div>
                        <div className="detail-item">
                          <span className="detail-label">예약자 정보</span>
                          <span className="detail-value">{res.depositorName} ({res.depositorPhone})</span>
                        </div>
                        <div className="detail-item">
                          <span className="detail-label">환급 계좌</span>
                          <span className="detail-value">{res.refundAccount}</span>
                        </div>
                        {pot && pot.openChatUrl && (res.status === "deposit_confirmed" || res.status === "joined_chat") && (
                          <div className="detail-action">
                            <button
                              type="button"
                              className="chat-link-btn"
                              onClick={() => handleOpenChatClick(pot)}
                            >
                              카카오톡 오픈채팅방 입장
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="deposit-list">
              {depositHistory.map((res) => {
                const isExpanded = !!expandedRows[res.id];
                const pot = res.taxi_pot;
                const formattedDate = pot 
                  ? formatPotDateTime(pot.date, pot.time)
                  : new Date(res.createdAt).toLocaleDateString();

                return (
                  <div key={res.id} className={`usage-row-item ${isExpanded ? "expanded" : ""}`}>
                    <button
                      type="button"
                      className="usage-row-summary deposit-summary-row"
                      onClick={() => toggleRow(res.id)}
                    >
                      <div className="deposit-summary-left">
                        <span className="usage-date">{formattedDate}</span>
                        {pot && (
                          <span className="deposit-summary-route">
                            {pot.concertTitle} ({pot.origin} ➔ {pot.destination})
                          </span>
                        )}
                      </div>
                      <div className="deposit-summary-right">
                        <span className="deposit-amount">+{formatAmount(res.depositAmount)}</span>
                        <span className="usage-chevron">
                          {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                        </span>
                      </div>
                    </button>

                    {isExpanded && (
                      <div className="usage-row-details">
                        {pot ? (
                          <>
                            <div className="detail-item">
                              <span className="detail-label">콘서트</span>
                              <span className="detail-value font-bold">{pot.concertTitle}</span>
                            </div>
                            <div className="detail-item">
                              <span className="detail-label">경로</span>
                              <span className="detail-value">{pot.origin} ➔ {pot.destination}</span>
                            </div>
                            <div className="detail-item">
                              <span className="detail-label">팟 모집상태</span>
                              <span className="detail-value">{getTaxiPotStatusText(pot.status)}</span>
                            </div>
                          </>
                        ) : (
                          <div className="detail-item">
                            <span className="detail-label">팟 정보</span>
                            <span className="detail-value text-muted">삭제되었거나 없는 팟입니다.</span>
                          </div>
                        )}
                        <div className="detail-item">
                          <span className="detail-label">입금/예약 상태</span>
                          <span className={`detail-value badge ${getStatusBadgeClass(res.status)}`}>
                            {getStatusText(res.status)}
                          </span>
                        </div>
                        <div className="detail-item">
                          <span className="detail-label">예약 확정금</span>
                          <span className="detail-value font-bold text-purple">{formatAmount(res.depositAmount)}</span>
                        </div>
                        <div className="detail-item">
                          <span className="detail-label">입금자명 (연락처)</span>
                          <span className="detail-value">{res.depositorName} ({res.depositorPhone})</span>
                        </div>
                        <div className="detail-item">
                          <span className="detail-label">환급 계좌</span>
                          <span className="detail-value">{res.refundAccount}</span>
                        </div>
                        {pot && pot.openChatUrl && (res.status === "deposit_confirmed" || res.status === "joined_chat") && (
                          <div className="detail-action">
                            <button
                              type="button"
                              className="chat-link-btn"
                              onClick={() => handleOpenChatClick(pot)}
                            >
                              카카오톡 오픈채팅방 입장
                            </button>
                          </div>
                        )}

                      </div>
                    )}
                  </div>
                );
              })}
              {depositHistory.length === 0 && (
                <div className="history-empty">입금 내역이 없습니다.</div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ID Change Center Modal Popup */}
      {isIdModalOpen && (
        <div className="id-modal-overlay" onClick={() => setIsIdModalOpen(false)}>
          <div className="id-modal-container" onClick={(e) => e.stopPropagation()}>
            <div className="id-modal-header">
              <h3>나만의 ID 단어 설정</h3>
              <button 
                type="button" 
                className="modal-close-btn" 
                onClick={() => setIsIdModalOpen(false)}
              >
                <X size={20} />
              </button>
            </div>
            
            <div className="id-modal-body">
              <p className="id-modal-description">
                ID는 <strong>(입력한 단어) + (익명 ID 앞 4자리)</strong>로 조합되며, 최대 3회만 수정 가능합니다.
              </p>
              
              <div className="id-preview-box">
                <span className="preview-label">ID 미리보기:</span>
                <span className="preview-value">{inputWord.trim() ? `${inputWord.trim()}${uuidSuffix}` : `(입력대기)${uuidSuffix}`}</span>
              </div>
              
              <div className="id-modal-input-wrapper">
                <input
                  type="text"
                  placeholder="단어 입력 (예: 튜나)"
                  value={inputWord}
                  onChange={(e) => setInputWord(e.target.value.replace(/[^a-zA-Z0-9ㄱ-ㅎㅏ-ㅣ가-힣]/g, ""))}
                  disabled={customIdInfo.editCount >= 3}
                  maxLength={10}
                  className="id-word-input modal-input"
                />
              </div>

              <div className="id-edit-status">
                <span>남은 수정 가능 횟수: <strong>{3 - customIdInfo.editCount}회</strong> / 3회</span>
                {customIdInfo.editCount >= 3 && (
                  <span className="edit-limit-warning">⚠️ ID 수정을 3회 모두 완료하여 더 이상 변경할 수 없습니다.</span>
                )}
              </div>
            </div>

            <div className="id-modal-footer">
              <button
                type="button"
                className="btn-cancel"
                onClick={() => setIsIdModalOpen(false)}
              >
                취소
              </button>
              <button
                type="button"
                onClick={handleSaveId}
                disabled={customIdInfo.editCount >= 3 || inputWord.trim() === customIdInfo.customWord}
                className="btn-save"
              >
                저장
              </button>
            </div>
          </div>
        </div>
      )}
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
  const maxPeopleVal = taxiPot.maxPeople ? parseInt(taxiPot.maxPeople, 10) : 5;
  const maxPeopleNum = isNaN(maxPeopleVal) || maxPeopleVal <= 0 ? 5 : maxPeopleVal;

  const [count, setCount] = useState(() => {
    const parsedMin = taxiPot.minPeople ? parseInt(taxiPot.minPeople, 10) : 4;
    const minPeopleNum = isNaN(parsedMin) || parsedMin <= 0 ? 4 : parsedMin;
    const clampVal = Math.min(minPeopleNum, maxPeopleNum);
    return String(Math.max(2, clampVal));
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
      return `${n}명`;
    }
    const priceForN = Math.ceil((totalFare + 1000 * n) / n / 100) * 100;
    return `${n}명 (인당 ${priceForN.toLocaleString()}원)`;
  };

  const handleSave = () => {
    const cleaned = phone.replace(/\D/g, "");
    if (!phone.trim()) {
      setPhoneError("전화번호를 입력해 주세요.");
      return;
    }
    if (
      !cleaned.startsWith("01") ||
      (cleaned.length !== 10 && cleaned.length !== 11)
    ) {
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
          <h3>알림 수신</h3>
          <button
            type="button"
            className="modal-close"
            onClick={onClose}
            aria-label="닫기"
          >
            <X size={18} />
          </button>
        </div>
        <div
          className="modal-body"
          style={{
            fontSize: "14px",
            lineHeight: "1.6",
            color: "var(--color-text)",
          }}
        >
          <p
            style={{
              margin: 0,
              fontWeight: "600",
              color: "var(--color-purple)",
              fontSize: "15px",
            }}
          >
            아직 택시팟 인원이 모자랍니다. 
            설정하신 인원 수가 모이면, 알림을 보내드립니다.
          </p>
          <p
            style={{ margin: 0, fontSize: "13px", color: "var(--color-muted)" }}
          >
            해당 택시팟은 설정 완료 후, [메뉴 &gt; 저장 목록]에서 확인하실 수
            있습니다.
          </p>
          <div
            style={{
              height: "1px",
              background: "var(--color-line)",
              margin: "8px 0",
            }}
          />
          <p style={{ margin: 0 }}>
            탑승 인원에 따라 개인 부담 금액이 변동됩니다. 알림을 수신할 최소
            인원과 연락처를 입력해 주세요.
          </p>

          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "8px",
              marginTop: "8px",
            }}
          >
            <label
              htmlFor="alert-min-people-select"
              style={{
                fontSize: "12px",
                fontWeight: "600",
                color: "var(--color-muted)",
              }}
            >
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
              {(() => {
                const optionsList = [];
                const startOption = 2;
                const endOption = Math.max(2, maxPeopleNum);
                for (let i = startOption; i <= endOption; i++) {
                  optionsList.push(i);
                }
                return optionsList.map((opt) => (
                  <option key={opt} value={String(opt)}>
                    {getAlertOptionText(opt)}
                  </option>
                ));
              })()}
            </select>
          </div>

          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "8px",
              marginTop: "16px",
            }}
          >
            <label
              htmlFor="alert-phone-input"
              style={{
                fontSize: "12px",
                fontWeight: "600",
                color: "var(--color-muted)",
              }}
            >
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
                border: phoneError
                  ? "1px solid red"
                  : "1px solid var(--color-line)",
                background: "var(--color-page)",
                color: "var(--color-text)",
                fontSize: "14px",
                outline: "none",
              }}
            />
            {phoneError && (
              <span
                style={{ fontSize: "11px", color: "red", marginTop: "-2px" }}
              >
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
  onShowNotifications,
  onShowSaved,
  onShowGuide,
  onShowMyInfo,
}: {
  isOpen: boolean;
  onClose: () => void;
  onShowNotifications: () => void;
  onShowSaved: () => void;
  onShowGuide: () => void;
  onShowMyInfo: () => void;
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
            onClick={onShowNotifications}
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
          <button
            type="button"
            className="menu-item"
            onClick={onShowMyInfo}
          >
            <span>나의 정보</span>
            <ChevronRight size={18} strokeWidth={1.8} />
          </button>
          <button type="button" className="menu-item" onClick={onShowSaved}>
            <span>저장 목록</span>
            <ChevronRight size={18} strokeWidth={1.8} />
          </button>
          <button type="button" className="menu-item" onClick={onShowGuide}>
            <span>서비스 안내</span>
            <ChevronRight size={18} strokeWidth={1.8} />
          </button>
          <button
            type="button"
            className="menu-item"
            onClick={() =>
              window.open(
                "https://linktr.ee/con_taxi",
                "_blank",
                "noopener,noreferrer",
              )
            }
          >
            <span>고객센터</span>
            <ChevronRight size={18} strokeWidth={1.8} />
          </button>
        </nav>
      </div>
    </>
  );
}

// Maintenance screen removed

export default function App() {
  const [screen, setScreen] = useState<Screen>("home");
  const [isDev, setIsDev] = useState<boolean>(() => {
    const hasParam =
      typeof window !== "undefined" &&
      window.location.search.includes("dev=true");
    const hasLocal =
      typeof window !== "undefined" &&
      localStorage.getItem("concert-taxipot:dev-bypass") === "true";
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
  const [selectedCategoryId, setSelectedCategoryId] = useState("");
  const [selectedDirectionFilter, setSelectedDirectionFilter] =
    useState<TaxiPotDirectionFilter>("all");
  const [taxiPots, setTaxiPots] = useState<TaxiPot[]>([]);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSavingTaxiPot, setIsSavingTaxiPot] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  const [showGuideBubble, setShowGuideBubble] = useState<boolean>(false);

  useEffect(() => {
    if (!isLoading) {
      const seen = localStorage.getItem("concert-taxipot:seen-guide-bubble");
      if (seen !== "true") {
        setShowGuideBubble(true);
        localStorage.setItem("concert-taxipot:seen-guide-bubble", "true");
      }
    }
  }, [isLoading]);
  const [selectedTaxiPot, setSelectedTaxiPot] = useState<TaxiPot | null>(null);
  const [depositReferrer, setDepositReferrer] = useState<
    "details" | "home" | "notifications"
  >("details");
  const [detailsReferrer, setDetailsReferrer] = useState<"home" | "saved">(
    "home",
  );
  const [savedTaxiPotIds, setSavedTaxiPotIds] = useState<string[]>(() => {
    return readLocalStorageJson<string[]>("concert-taxipot:saved", []);
  });
  const [reservedTaxiPotIds, setReservedTaxiPotIds] = useState<string[]>(() => {
    return readLocalStorageJson<string[]>("concert-taxipot:reserved", []);
  });

  const [likeCounts, setLikeCounts] = useState<Record<string, number>>(() => {
    return readLocalStorageJson<Record<string, number>>(
      "concert-taxipot:likes",
      {},
    );
  });

  const [alertSettings, setAlertSettings] = useState<AlertSettings>(() => {
    return readLocalStorageJson<AlertSettings>(
      "concert-taxipot:alert-settings",
      {},
    );
  });

  const [likePopupTaxiPot, setLikePopupTaxiPot] = useState<TaxiPot | null>(
    null,
  );

  const toggleLikeTaxiPot = async (id: string, silent = false) => {
    const isCurrentlyLiked = savedTaxiPotIds.includes(id);

    if (isCurrentlyLiked) {
      if (silent) return; // silent mode only performs addition

      try {
        await deleteTaxiPotLike(anonymousKey, id);
      } catch {
        alert("찜 취소에 실패했습니다. 다시 시도해 주세요.");
        return;
      }

      const nextSavedIds = savedTaxiPotIds.filter((item) => item !== id);
      const currentCount = likeCounts[id] ?? 1;
      const nextLikeCounts = {
        ...likeCounts,
        [id]: Math.max(0, currentCount - 1),
      };

      const nextAlertSettings = { ...alertSettings };
      delete nextAlertSettings[id];
      setAlertSettings(nextAlertSettings);
      localStorage.setItem(
        "concert-taxipot:alert-settings",
        JSON.stringify(nextAlertSettings),
      );

      setSavedTaxiPotIds(nextSavedIds);
      setLikeCounts(nextLikeCounts);
      localStorage.setItem("concert-taxipot:saved", JSON.stringify(nextSavedIds));
      localStorage.setItem(
        "concert-taxipot:likes",
        JSON.stringify(nextLikeCounts),
      );
      return;
    }

    if (!silent) {
      const pot = taxiPots.find((p) => p.id === id) || null;
      if (pot) {
        setLikePopupTaxiPot(pot);
      }
      return;
    }

    try {
      await insertTaxiPotLike(
        anonymousKey,
        anonymousUserId,
        id,
        4, // default alert min people
        defaultPhone, // 저장된 번호가 있으면 자동 찜 알림에도 함께 저장
      );
    } catch {
      console.error("예약 후 자동 찜 저장에 실패했습니다.");
      return;
    }

    const nextSavedIds = [...savedTaxiPotIds, id];
    const currentCount = likeCounts[id] ?? 0;
    const nextLikeCounts = {
      ...likeCounts,
      [id]: currentCount + 1,
    };
    setSavedTaxiPotIds(nextSavedIds);
    setLikeCounts(nextLikeCounts);
    localStorage.setItem("concert-taxipot:saved", JSON.stringify(nextSavedIds));
    localStorage.setItem(
      "concert-taxipot:likes",
      JSON.stringify(nextLikeCounts),
    );
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

  const notifications = useMemo(
    () =>
      buildTaxiPotNotifications(
        visibleTaxiPots,
        savedTaxiPotIds,
        alertSettings,
        likeCounts,
        reservedTaxiPotIds,
      ),
    [
      alertSettings,
      likeCounts,
      reservedTaxiPotIds,
      savedTaxiPotIds,
      visibleTaxiPots,
    ],
  );

  useEffect(() => {
    const loadingStartedAt = Date.now();
    let isMounted = true;
    let loadingTimeout: number | undefined;

    const loadData = async () => {
      try {
        const [nextCategories, nextTaxiPots, dbLikeCounts, anonUser] =
          await Promise.all([
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
          const [dbSavedIds, dbReservedIds, dbSaveSettings] = await Promise.all(
            [
              loadUserLikedPotIds(anonymousKey),
              loadUserReservedPotIds(anonymousKey),
              loadUserTaxiPotSaveSettings(anonymousKey),
            ],
          );
          const nextAlertSettings = dbSaveSettings.reduce<AlertSettings>(
            (settings, saveSetting) => {
              if (saveSetting.alertMinPeople) {
                settings[saveSetting.taxiPotId] = {
                  count: String(saveSetting.alertMinPeople),
                  phone: saveSetting.alertPhone ?? "",
                };
              }
              return settings;
            },
            {},
          );
          setSavedTaxiPotIds(dbSavedIds);
          setReservedTaxiPotIds(dbReservedIds);
          setAlertSettings((current) => ({
            ...current,
            ...nextAlertSettings,
          }));
          localStorage.setItem(
            "concert-taxipot:alert-settings",
            JSON.stringify(nextAlertSettings),
          );
          localStorage.setItem(
            "concert-taxipot:reserved",
            JSON.stringify(dbReservedIds),
          );
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
              const [freshCounts, freshSavedIds, freshSaveSettings] =
                await Promise.all([
                  loadAllTaxiPotLikeCounts(),
                  loadUserLikedPotIds(anonymousKey),
                  loadUserTaxiPotSaveSettings(anonymousKey),
                ]);
              const nextAlertSettings = freshSaveSettings.reduce<AlertSettings>(
                (settings, saveSetting) => {
                  if (saveSetting.alertMinPeople) {
                    settings[saveSetting.taxiPotId] = {
                      count: String(saveSetting.alertMinPeople),
                      phone: saveSetting.alertPhone ?? "",
                    };
                  }
                  return settings;
                },
                {},
              );
              if (isMounted) {
                setLikeCounts((prev) => ({ ...prev, ...freshCounts }));
                setSavedTaxiPotIds(freshSavedIds);
                setAlertSettings(nextAlertSettings);
                localStorage.setItem(
                  "concert-taxipot:saved",
                  JSON.stringify(freshSavedIds),
                );
                localStorage.setItem(
                  "concert-taxipot:alert-settings",
                  JSON.stringify(nextAlertSettings),
                );
              }
            } catch (err) {
              console.error("실시간 찜 개수 동기화 실패:", err);
            }
          },
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
      maxPeople: values.maxPeople,
      notes: values.notes ? values.notes.trim() : undefined,
    };

    try {
      setIsSavingTaxiPot(true);
      const nextTaxiPots = await saveTaxiPot(taxiPot, taxiPots);
      setTaxiPots(nextTaxiPots);
      setSelectedCategoryId(nextTaxiPots[0]?.categoryId ?? "");
      setError("");

      // Auto-save (like) the taxi pot for the creator
      const defaultAlertCount = taxiPot.minPeople ? parseInt(taxiPot.minPeople, 10) : 4;
      const alertCountVal = isNaN(defaultAlertCount) || defaultAlertCount <= 0 ? 4 : defaultAlertCount;
      const clampVal = Math.min(alertCountVal, taxiPot.maxPeople ? parseInt(taxiPot.maxPeople, 10) : 5);
      const finalCount = Math.max(2, isNaN(clampVal) ? 4 : clampVal);

      await insertTaxiPotLike(
        anonymousKey,
        anonymousUserId,
        taxiPot.id,
        finalCount,
        defaultPhone,
      );

      const nextSavedIds = savedTaxiPotIds.includes(taxiPot.id)
        ? savedTaxiPotIds
        : [...savedTaxiPotIds, taxiPot.id];
      const currentCount = likeCounts[taxiPot.id] ?? 0;
      const nextLikeCounts = {
        ...likeCounts,
        [taxiPot.id]: currentCount + 1,
      };
      const nextAlertSettings = {
        ...alertSettings,
        [taxiPot.id]: {
          count: String(finalCount),
          phone: defaultPhone,
        },
      };

      setSavedTaxiPotIds(nextSavedIds);
      setLikeCounts(nextLikeCounts);
      setAlertSettings(nextAlertSettings);

      localStorage.setItem("concert-taxipot:saved", JSON.stringify(nextSavedIds));
      localStorage.setItem("concert-taxipot:likes", JSON.stringify(nextLikeCounts));
      localStorage.setItem(
        "concert-taxipot:alert-settings",
        JSON.stringify(nextAlertSettings),
      );

      if (defaultPhone) {
        await updateAnonymousUserProfile(anonymousKey, { phone: defaultPhone });
      }

      setScreen("home");
      setLikePopupTaxiPot(taxiPot);
    } catch (saveError) {
      setError(`택시팟을 저장하지 못했습니다: ${getErrorMessage(saveError)}`);
    } finally {
      setIsSavingTaxiPot(false);
    }
  };

  const handleCreateTaxiPotClick = async () => {
    try {
      await trackCreateTaxiPotClick({
        categoryId: selectedCategory?.id ?? null,
        concertTitle: selectedCategory?.title ?? null,
      });
    } catch (clickLogError) {
      console.error("택시팟 만들기 클릭 로그 저장 실패:", clickLogError);
    }

    setScreen("new");
  };

  const goHomeInitial = () => {
    setScreen("home");
    setSelectedCategoryId("");
    setSelectedDirectionFilter("all");
    setSelectedTaxiPot(null);
    setIsMenuOpen(false);
  };

  return (
    <MobileShell>
      {isLoading ? <LoadingScreen /> : null}
      {error ? <p className="global-error">{error}</p> : null}

      {!isLoading && (
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
              onLogoClick={goHomeInitial}
              onCreate={handleCreateTaxiPotClick}
              onOpenMenu={() => {
                setIsMenuOpen(true);
                setShowGuideBubble(false);
              }}
              onViewDetails={(taxiPot) => {
                setSelectedTaxiPot(taxiPot);
                setDetailsReferrer("home");
                setScreen("details");
              }}
              likeCounts={likeCounts}
              showGuideBubble={showGuideBubble}
              onCloseGuideBubble={() => setShowGuideBubble(false)}
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
              isFromHome={detailsReferrer === "home"}
              isReserved={reservedTaxiPotIds.includes(selectedTaxiPot.id)}
              onReserve={() => {
                const isFareNotAssigned = !selectedTaxiPot.estimatedFare ||
                  isNaN(parseFloat(selectedTaxiPot.estimatedFare)) ||
                  parseFloat(selectedTaxiPot.estimatedFare) <= 0;
                if (isFareNotAssigned) {
                  alert("예상 금액이 산정되지 않아 예약할 수 없습니다.");
                  return;
                }
                if (!savedTaxiPotIds.includes(selectedTaxiPot.id)) {
                  toggleLikeTaxiPot(selectedTaxiPot.id, true);
                }
                setDepositReferrer("details");
                setScreen("deposit");
              }}
              alertMinPeople={
                typeof alertSettings[selectedTaxiPot.id] === "string"
                  ? (alertSettings[selectedTaxiPot.id] as string)
                  : (
                      alertSettings[selectedTaxiPot.id] as {
                        count: string;
                        phone: string;
                      }
                    )?.count
              }
              alertPhone={
                typeof alertSettings[selectedTaxiPot.id] === "string"
                  ? undefined
                  : (
                      alertSettings[selectedTaxiPot.id] as {
                        count: string;
                        phone: string;
                      }
                    )?.phone
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
              onReservationCreated={(taxiPotId, phone) => {
                setReservedTaxiPotIds((current) => {
                  if (current.includes(taxiPotId)) {
                    return current;
                  }

                  const nextReservedIds = [...current, taxiPotId];
                  localStorage.setItem(
                    "concert-taxipot:reserved",
                    JSON.stringify(nextReservedIds),
                  );
                  return nextReservedIds;
                });

                // 예약 진입 시 전화번호 없이 자동 생성된 찜 행이 있을 수 있으므로,
                // 예약 폼에서 검증된 번호로 알림 설정을 갱신합니다.
                void insertTaxiPotLike(
                  anonymousKey,
                  anonymousUserId,
                  taxiPotId,
                  4,
                  phone,
                )
                  .then(() => {
                    setAlertSettings((current) => {
                      const next = {
                        ...current,
                        [taxiPotId]: { count: "4", phone },
                      };
                      localStorage.setItem(
                        "concert-taxipot:alert-settings",
                        JSON.stringify(next),
                      );
                      return next;
                    });
                  })
                  .catch((error) => {
                    console.error("예약 후 찜 알림 연락처 갱신 실패:", error);
                  });
              }}
              onBack={() => {
                if (depositReferrer === "home") {
                  setScreen("home");
                  setSelectedTaxiPot(null);
                } else if (depositReferrer === "notifications") {
                  setScreen("notifications");
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
          {screen === "notifications" ? (
            <NotificationScreen
              notifications={notifications}
              onBack={() => setScreen("home")}
              onReserve={(taxiPot) => {
                const isFareNotAssigned = !taxiPot.estimatedFare ||
                  isNaN(parseFloat(taxiPot.estimatedFare)) ||
                  parseFloat(taxiPot.estimatedFare) <= 0;
                if (isFareNotAssigned) {
                  alert("예상 금액이 산정되지 않아 예약할 수 없습니다.");
                  return;
                }
                setSelectedTaxiPot(taxiPot);
                setDepositReferrer("notifications");
                setScreen("deposit");
              }}
            />
          ) : null}
          {screen === "guide" ? (
            <ServiceGuideScreen onBack={() => setScreen("home")} />
          ) : null}
          {screen === "my-info" ? (
            <MyInfoScreen
              anonymousKey={anonymousKey}
              anonymousUserId={anonymousUserId}
              onBack={() => setScreen("home")}
              isDev={isDev}
            />
          ) : null}

          <SlideMenu
            isOpen={isMenuOpen}
            onClose={() => setIsMenuOpen(false)}
            onShowNotifications={() => {
              setIsMenuOpen(false);
              setScreen("notifications");
            }}
            onShowSaved={() => {
              setIsMenuOpen(false);
              setScreen("saved");
            }}
            onShowGuide={() => {
              setIsMenuOpen(false);
              setScreen("guide");
            }}
            onShowMyInfo={() => {
              setIsMenuOpen(false);
              setScreen("my-info");
            }}
          />

          {likePopupTaxiPot && (
            <LikeAlertModal
              taxiPot={likePopupTaxiPot}
              onClose={() => {
                setLikePopupTaxiPot(null);
              }}
              onSave={async (count, phone) => {
                try {
                  await insertTaxiPotLike(
                    anonymousKey,
                    anonymousUserId,
                    likePopupTaxiPot.id,
                    parseInt(count, 10),
                    phone,
                  );
                } catch {
                  alert("찜 저장에 실패했습니다. 다시 시도해 주세요.");
                  return;
                }

                const nextSavedIds = savedTaxiPotIds.includes(likePopupTaxiPot.id)
                  ? savedTaxiPotIds
                  : [...savedTaxiPotIds, likePopupTaxiPot.id];
                const currentCount = likeCounts[likePopupTaxiPot.id] ?? 0;
                const nextLikeCounts = {
                  ...likeCounts,
                  [likePopupTaxiPot.id]: currentCount + 1,
                };
                const nextAlertSettings = {
                  ...alertSettings,
                  [likePopupTaxiPot.id]: { count, phone },
                };
                setSavedTaxiPotIds(nextSavedIds);
                setLikeCounts(nextLikeCounts);
                setAlertSettings(nextAlertSettings);
                localStorage.setItem(
                  "concert-taxipot:saved",
                  JSON.stringify(nextSavedIds),
                );
                localStorage.setItem(
                  "concert-taxipot:likes",
                  JSON.stringify(nextLikeCounts),
                );
                localStorage.setItem(
                  "concert-taxipot:alert-settings",
                  JSON.stringify(nextAlertSettings),
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
