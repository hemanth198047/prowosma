import { createContext, useContext } from "react";

export const PeopleContext = createContext(null);

const FALLBACK = {
  people: [], byId: new Map(), byEmail: new Map(), loaded: false, orgAvailable: true,
  ensureLoaded: () => {}, reload: () => Promise.resolve(),
  openCard: () => {}, hoverCard: () => {}, leaveCard: () => {}, keepCard: () => {}, closeCard: () => {},
};

/** People directory + the shared Teams-style profile card. */
export function usePeople() {
  return useContext(PeopleContext) || FALLBACK;
}
