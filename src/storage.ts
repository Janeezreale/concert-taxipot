import { supabase } from "./supabase";
import { initialTaxiPots } from "./data";
import type { TaxiPot } from "./types";

const STORAGE_KEY = "concert-taxipot:taxis";

const fromStorage = () => {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(initialTaxiPots));
    return initialTaxiPots;
  }

  try {
    return JSON.parse(raw) as TaxiPot[];
  } catch {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(initialTaxiPots));
    return initialTaxiPots;
  }
};

const toStorage = (taxiPots: TaxiPot[]) => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(taxiPots));
};

const mapRowToTaxiPot = (row: Record<string, string>) => ({
  id: row.id,
  concertId: row.concert_id,
  concertTitle: row.concert_title,
  origin: row.origin,
  destination: row.destination,
  date: row.date,
  time: row.time,
  openChatUrl: row.open_chat_url,
});

const mapTaxiPotToRow = (taxiPot: TaxiPot) => ({
  id: taxiPot.id,
  concert_id: taxiPot.concertId,
  concert_title: taxiPot.concertTitle,
  origin: taxiPot.origin,
  destination: taxiPot.destination,
  date: taxiPot.date,
  time: taxiPot.time,
  open_chat_url: taxiPot.openChatUrl,
});

export const loadTaxiPots = async () => {
  if (!supabase) {
    return fromStorage();
  }

  const { data, error } = await supabase
    .from("taxi_pots")
    .select("*")
    .order("date", { ascending: true })
    .order("time", { ascending: true });

  if (error || !data) {
    return fromStorage();
  }

  const taxiPots = data.map((row) => mapRowToTaxiPot(row as Record<string, string>));
  toStorage(taxiPots);
  return taxiPots;
};

export const saveTaxiPot = async (taxiPot: TaxiPot, currentTaxiPots: TaxiPot[]) => {
  const nextTaxiPots = [taxiPot, ...currentTaxiPots];
  toStorage(nextTaxiPots);

  if (supabase) {
    await supabase.from("taxi_pots").insert(mapTaxiPotToRow(taxiPot));
  }

  return nextTaxiPots;
};
