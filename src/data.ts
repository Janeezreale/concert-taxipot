import type { Concert, TaxiPot } from "./types";

export const concerts: Concert[] = [
  {
    id: "xdinary-heroes-xcape",
    title: "Xdinary Heroes 2026 Summer Special <The Xcape>",
  },
  {
    id: "babymonster-choom",
    title: "2026-27 BABYMONSTER WORLD TOUR [춤 (CHOOM)] IN SEOUL",
  },
  {
    id: "andteam-blaze",
    title: "2026 &TEAM CONCERT TOUR 'BLAZE THE WAY' in INCHEON",
  },
  {
    id: "tws-247",
    title: "2026 TWS TOUR '24/7:FOR:YOU' IN SEOUL",
  },
  {
    id: "other",
    title: "기타",
  },
];

export const initialTaxiPots: TaxiPot[] = [
  {
    id: "taxi-pot-1",
    concertId: "xdinary-heroes-xcape",
    concertTitle: "Xdinary Heroes 2026 Summer Special <The Xcape>",
    origin: "운서역",
    destination: "인스파이어 아레나",
    date: "2026-06-27",
    time: "14:00",
    openChatUrl: "https://open.kakao.com/",
  },
  {
    id: "taxi-pot-2",
    concertId: "xdinary-heroes-xcape",
    concertTitle: "Xdinary Heroes 2026 Summer Special <The Xcape>",
    origin: "인천국제공항T1",
    destination: "인스파이어 아레나",
    date: "2026-06-27",
    time: "14:30",
    openChatUrl: "https://open.kakao.com/",
  },
  {
    id: "taxi-pot-3",
    concertId: "xdinary-heroes-xcape",
    concertTitle: "Xdinary Heroes 2026 Summer Special <The Xcape>",
    origin: "인스파이어 아레나",
    destination: "서울역",
    date: "2026-06-27",
    time: "21:30",
    openChatUrl: "https://open.kakao.com/",
  },
];
