export type Concert = {
  id: string;
  title: string;
};

export type TaxiPot = {
  id: string;
  concertId: string;
  concertTitle: string;
  origin: string;
  destination: string;
  date: string;
  time: string;
  openChatUrl: string;
};

export type TaxiPotFormValues = {
  concertTitle: string;
  origin: string;
  destination: string;
  date: string;
  time: string;
  openChatUrl: string;
};

export type Screen = "home" | "concerts" | "new";
