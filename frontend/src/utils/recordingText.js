/** Wording shared by the recording screens and their tests. */
export const ANNOUNCEMENT = "Heads-up: I'm recording this meeting and turning it into text with Prowosma, so we can share notes and action items.";

export const retentionText = (hours) => (hours === 0
  ? "as soon as it has been turned into text"
  : `${hours} hour${hours === 1 ? "" : "s"} after the meeting ends`);
