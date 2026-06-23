import { ArrowLeft, CalendarDays, CircleDot, MoreHorizontal } from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { concerts } from "./data";
import { loadTaxiPots, saveTaxiPot } from "./storage";
import type { Screen, TaxiPot, TaxiPotFormValues } from "./types";

const defaultForm: TaxiPotFormValues = {
  concertTitle: "2026 PEPPERTONES CLUB ...",
  origin: "잠실새내역",
  destination: "무신사 개러지",
  date: "2026-07-12",
  time: "19:00",
  openChatUrl: "https://open.kakao.com/o/...",
};

const formatDateTime = (date: string, time: string) => {
  const [, month, day] = date.split("-");
  return `${Number(month)}/${Number(day)} ${time}`;
};

const findConcertId = (title: string) => {
  return concerts.find((concert) => concert.title === title)?.id ?? "other";
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
}: {
  title: string;
  showBack?: boolean;
  onBack?: () => void;
}) {
  return (
    <header className="app-header">
      {showBack ? (
        <button className="icon-button" type="button" aria-label="뒤로가기" onClick={onBack}>
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
}: {
  children: React.ReactNode;
  onClick?: () => void;
  type?: "button" | "submit";
}) {
  return (
    <button className="bottom-action" type={type} onClick={onClick}>
      {children}
    </button>
  );
}

function ConcertSelectCard({
  selectedConcert,
  onOpen,
}: {
  selectedConcert: string;
  onOpen: () => void;
}) {
  return (
    <section className="concert-control" aria-labelledby="selected-concert-label">
      <p id="selected-concert-label" className="section-label">
        콘서트 선택
      </p>
      <button className="selected-concert" type="button" onClick={onOpen}>
        <span>{selectedConcert}</span>
        <MoreHorizontal size={23} aria-hidden="true" />
      </button>
    </section>
  );
}

function TaxiPotItem({ taxiPot }: { taxiPot: TaxiPot }) {
  const openChat = () => {
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
  selectedConcert,
  taxiPots,
  onOpenConcerts,
  onCreate,
}: {
  selectedConcert: string;
  taxiPots: TaxiPot[];
  onOpenConcerts: () => void;
  onCreate: () => void;
}) {
  const visibleTaxiPots = useMemo(() => {
    if (selectedConcert === "기타") {
      return taxiPots.filter((taxiPot) => findConcertId(taxiPot.concertTitle) === "other");
    }

    return taxiPots.filter((taxiPot) => taxiPot.concertTitle === selectedConcert);
  }, [selectedConcert, taxiPots]);

  return (
    <>
      <AppHeader title="콘서트 택시팟" />
      <div className="screen-content home-content">
        <ConcertSelectCard selectedConcert={selectedConcert} onOpen={onOpenConcerts} />
        <div className="list-divider" />
        <section className="taxi-pot-list" aria-label="택시팟 목록">
          {visibleTaxiPots.length > 0 ? (
            visibleTaxiPots.map((taxiPot) => <TaxiPotItem key={taxiPot.id} taxiPot={taxiPot} />)
          ) : (
            <p className="empty-state">선택한 콘서트의 택시팟이 아직 없습니다.</p>
          )}
        </section>
      </div>
      <div className="fixed-action">
        <BottomActionButton onClick={onCreate}>+ 택시팟 만들기</BottomActionButton>
      </div>
    </>
  );
}

function ConcertScreen({
  selectedConcert,
  onBack,
  onSelect,
}: {
  selectedConcert: string;
  onBack: () => void;
  onSelect: (title: string) => void;
}) {
  return (
    <>
      <AppHeader title="콘서트 선택" showBack onBack={onBack} />
      <div className="screen-content concert-list">
        {concerts.map((concert) => (
          <button
            key={concert.id}
            className="concert-row"
            type="button"
            aria-pressed={selectedConcert === concert.title}
            onClick={() => onSelect(concert.title)}
          >
            <span className="bullet" />
            <span>{concert.title}</span>
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

function TaxiPotForm({
  selectedConcert,
  onBack,
  onSubmit,
}: {
  selectedConcert: string;
  onBack: () => void;
  onSubmit: (values: TaxiPotFormValues) => void;
}) {
  const [values, setValues] = useState<TaxiPotFormValues>({
    ...defaultForm,
    concertTitle: selectedConcert === "기타" ? defaultForm.concertTitle : selectedConcert,
  });
  const [error, setError] = useState("");

  const updateField = (field: keyof TaxiPotFormValues, value: string) => {
    setValues((current) => ({ ...current, [field]: value }));
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

    onSubmit(values);
  };

  return (
    <>
      <AppHeader title="콘서트 택시팟" showBack onBack={onBack} />
      <form className="screen-content taxi-form" onSubmit={handleSubmit}>
        <FormField label="콘서트">
          <input
            value={values.concertTitle}
            onChange={(event) => updateField("concertTitle", event.target.value)}
          />
        </FormField>
        <FormField label="출발지">
          <input value={values.origin} onChange={(event) => updateField("origin", event.target.value)} />
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
          <input type="time" value={values.time} onChange={(event) => updateField("time", event.target.value)} />
        </FormField>
        <FormField label="오픈채팅 링크">
          <input
            value={values.openChatUrl}
            inputMode="url"
            onChange={(event) => updateField("openChatUrl", event.target.value)}
          />
        </FormField>
        {error ? <p className="form-error">{error}</p> : null}
        <BottomActionButton type="submit">등록하기</BottomActionButton>
      </form>
    </>
  );
}

export default function App() {
  const [screen, setScreen] = useState<Screen>("home");
  const [selectedConcert, setSelectedConcert] = useState(concerts[0].title);
  const [taxiPots, setTaxiPots] = useState<TaxiPot[]>([]);

  useEffect(() => {
    loadTaxiPots().then(setTaxiPots);
  }, []);

  const createTaxiPot = async (values: TaxiPotFormValues) => {
    const taxiPot: TaxiPot = {
      id: `taxi-pot-${Date.now()}`,
      concertId: findConcertId(values.concertTitle),
      concertTitle: values.concertTitle.trim(),
      origin: values.origin.trim(),
      destination: values.destination.trim(),
      date: values.date,
      time: values.time,
      openChatUrl: values.openChatUrl.trim(),
    };

    const nextTaxiPots = await saveTaxiPot(taxiPot, taxiPots);
    setTaxiPots(nextTaxiPots);
    setSelectedConcert(findConcertId(taxiPot.concertTitle) === "other" ? "기타" : taxiPot.concertTitle);
    setScreen("home");
  };

  return (
    <MobileShell>
      {screen === "home" ? (
        <HomeScreen
          selectedConcert={selectedConcert}
          taxiPots={taxiPots}
          onOpenConcerts={() => setScreen("concerts")}
          onCreate={() => setScreen("new")}
        />
      ) : null}
      {screen === "concerts" ? (
        <ConcertScreen
          selectedConcert={selectedConcert}
          onBack={() => setScreen("home")}
          onSelect={(title) => {
            setSelectedConcert(title);
            setScreen("home");
          }}
        />
      ) : null}
      {screen === "new" ? (
        <TaxiPotForm selectedConcert={selectedConcert} onBack={() => setScreen("home")} onSubmit={createTaxiPot} />
      ) : null}
    </MobileShell>
  );
}
