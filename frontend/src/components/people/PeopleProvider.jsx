import { useCallback, useMemo, useRef, useState } from "react";
import { PeopleContext } from "../../context/PeopleContext";
import { useAuth } from "../../hooks/useAuth";
import { getOrgChart } from "../../api/org";
import { getTeamMembers } from "../../api/team";
import { unwrapList } from "../../api/client";
import PersonCard from "./PersonCard";
import "../../styles/people.css";

const HOVER_OPEN_MS = 450;
const HOVER_CLOSE_MS = 300;

/**
 * Loads the workspace's people once (on first use) and owns the single profile card:
 * hover an avatar to peek at it, click to pin it open.
 */
export default function PeopleProvider({ children }) {
  const { activeWorkspace } = useAuth();
  const wsId = activeWorkspace?.id || null;
  const [state, setState] = useState({ wsId: null, people: [], loaded: false, orgAvailable: true });
  const [card, setCard] = useState(null); // { personId, rect, pinned }
  const loading = useRef(null);
  const openTimer = useRef(null);
  const closeTimer = useRef(null);

  const load = useCallback(() => {
    const key = wsId;
    loading.current = key;
    const done = (people, orgAvailable) => {
      if (loading.current === key) setState({ wsId: key, people, loaded: true, orgAvailable });
    };
    // The org endpoint adds reporting lines and contact details. If the server doesn't have it yet
    // (an older backend), fall back to the plain member list so people can still be found and shown.
    return getOrgChart()
      .then((res) => done(unwrapList(res), true))
      .catch(() => getTeamMembers()
        .then((res) => done(unwrapList(res), false))
        .catch(() => done([], false)));
  }, [wsId]);

  const ensureLoaded = useCallback(() => {
    if (!wsId) return;
    if (state.wsId === wsId || loading.current === wsId) return;
    load();
  }, [wsId, state.wsId, load]);

  const people = useMemo(() => (state.wsId === wsId ? state.people : []), [state.wsId, state.people, wsId]);
  const byId = useMemo(() => new Map(people.map((p) => [p.id, p])), [people]);
  const byEmail = useMemo(() => new Map(people.filter((p) => p.email).map((p) => [p.email.toLowerCase(), p])), [people]);

  const clearTimers = () => { clearTimeout(openTimer.current); clearTimeout(closeTimer.current); };

  const openCard = useCallback((personId, anchorEl) => {
    clearTimers();
    if (!personId) return;
    setCard((c) => (c && c.pinned && c.personId === personId ? null
      : { personId, rect: anchorEl?.getBoundingClientRect?.() || null, pinned: true }));
  }, []);

  const hoverCard = useCallback((personId, anchorEl) => {
    clearTimers();
    if (!personId) return;
    openTimer.current = setTimeout(() => {
      setCard((c) => (c?.pinned ? c : { personId, rect: anchorEl.getBoundingClientRect(), pinned: false }));
    }, HOVER_OPEN_MS);
  }, []);

  const leaveCard = useCallback(() => {
    clearTimeout(openTimer.current);
    clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setCard((c) => (c?.pinned ? c : null)), HOVER_CLOSE_MS);
  }, []);

  const keepCard = useCallback((pin) => {
    clearTimeout(closeTimer.current);
    if (pin) setCard((c) => (c && !c.pinned ? { ...c, pinned: true } : c));
  }, []);

  const closeCard = useCallback(() => { clearTimers(); setCard(null); }, []);

  const showPerson = useCallback((personId) => setCard((c) => (c ? { ...c, personId, pinned: true } : c)), []);

  const value = useMemo(() => ({
    people, byId, byEmail, loaded: state.loaded && state.wsId === wsId, orgAvailable: state.orgAvailable,
    ensureLoaded, reload: load, openCard, hoverCard, leaveCard, keepCard, closeCard,
  }), [people, byId, byEmail, state.loaded, state.orgAvailable, state.wsId, wsId, ensureLoaded, load, openCard, hoverCard, leaveCard, keepCard, closeCard]);

  return (
    <PeopleContext.Provider value={value}>
      {children}
      {card && byId.get(card.personId) && (
        <PersonCard
          key={card.personId}
          person={byId.get(card.personId)}
          rect={card.rect}
          pinned={card.pinned}
          onEnter={() => keepCard(false)}
          onLeave={leaveCard}
          onPin={() => keepCard(true)}
          onClose={closeCard}
          onShowPerson={showPerson}
        />
      )}
    </PeopleContext.Provider>
  );
}
