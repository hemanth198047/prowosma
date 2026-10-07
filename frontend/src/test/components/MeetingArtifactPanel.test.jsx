import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup, fireEvent, within } from "@testing-library/react";
import { axe } from "vitest-axe";

vi.mock("../../api/meetingAssistant", () => ({
  getMeetingArtifacts: vi.fn(), getArtifactVersions: vi.fn(), getArtifactVersion: vi.fn(), getArtifactDiff: vi.fn(),
  saveArtifact: vi.fn(), restoreArtifact: vi.fn(), acceptPendingArtifact: vi.fn(), dismissPendingArtifact: vi.fn(),
  generateMeetingOutputs: vi.fn(), getMeetingTranscript: vi.fn(),
}));

import * as api from "../../api/meetingAssistant";
import { ConfirmContext } from "../../hooks/useConfirm";
import MeetingArtifactPanel from "../../components/MeetingArtifactPanel";

const SESSION = { id: "s1", status: "READY_FOR_REVIEW", canManage: true, canGenerate: true, segmentCount: 4, outputsGeneratedAt: "t1" };
const CUR = { version: 1, source: "AI", createdBy: "system", createdAt: "2026-10-07T10:00:00Z",
  markdown: "# Summary — Weekly sync\n\n## Outcomes\n- Budget approved [#3-4]\n- Shipping **Friday** [#2]\n" };

const DOC = (extra = {}) => ({ data: { SUMMARY: { current: CUR, pending: null, stale: false, versionCount: 1, ...extra } } });
const renderPanel = (props = {}, confirmAnswer = true) => render(
  <ConfirmContext.Provider value={() => Promise.resolve(confirmAnswer)}>
    <MeetingArtifactPanel session={SESSION} type="SUMMARY" aiReady aiReason={null} onChanged={vi.fn()} {...props} />
  </ConfirmContext.Provider>);

beforeEach(() => {
  vi.clearAllMocks();
  api.getMeetingArtifacts.mockResolvedValue(DOC());
  api.getArtifactVersions.mockResolvedValue({ data: [] });
  api.getMeetingTranscript.mockResolvedValue({ data: { segments: [] } });
});
afterEach(cleanup);

describe("MeetingArtifactPanel", () => {
  it("shows the document with evidence markers that open the cited transcript lines", async () => {
    api.getMeetingTranscript.mockResolvedValue({ data: { segments: [
      { seq: 3, startMs: 83000, speaker: "Priya Nair", text: "The budget is approved." }, { seq: 4, startMs: 90000, speaker: null, text: "Agreed." }] } });
    renderPanel();
    expect(await screen.findByText(/Version 1 · Generated/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show transcript lines 3 to 4" }));
    await waitFor(() => expect(api.getMeetingTranscript).toHaveBeenCalledWith("s1", { after: 2, limit: 2 }));
    const evidence = await screen.findByRole("region", { name: "Transcript evidence" });
    expect(within(evidence).getByText("Priya Nair")).toBeInTheDocument();
    expect(within(evidence).getByText("Unknown speaker")).toBeInTheDocument();
    expect(within(evidence).getByText("01:23")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show transcript line 2" }));
    await waitFor(() => expect(api.getMeetingTranscript).toHaveBeenLastCalledWith("s1", { after: 1, limit: 1 }));
  });

  it("renders generated or edited text as plain text — HTML is never interpreted", async () => {
    api.getMeetingArtifacts.mockResolvedValue(DOC({ current: { ...CUR, markdown: '- <img src=x onerror="alert(1)"> <b>bold?</b>' } }));
    const { container } = renderPanel();
    expect(await screen.findByText(/<img src=x/)).toBeInTheDocument();
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("b")).toBeNull();
  });

  it("shows progress while generating and nothing else", async () => {
    renderPanel({ session: { ...SESSION, status: "PROCESSING" } });
    expect(await screen.findByRole("status")).toHaveTextContent(/Generating/);
  });

  it("with no document yet: offers Generate when AI is ready, otherwise explains why not", async () => {
    api.getMeetingArtifacts.mockResolvedValue({ data: { SUMMARY: null } });
    api.generateMeetingOutputs.mockResolvedValue({ data: {} });
    renderPanel({ session: { ...SESSION, status: "TRANSCRIPT_RECEIVED" } });
    fireEvent.click(await screen.findByRole("button", { name: "Generate summary, minutes and notes" }));
    await waitFor(() => expect(api.generateMeetingOutputs).toHaveBeenCalledWith("s1"));
    cleanup();
    renderPanel({ session: { ...SESSION, status: "TRANSCRIPT_RECEIVED" }, aiReady: false, aiReason: "No AI API key is saved." });
    expect(await screen.findByText(/No AI API key is saved/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Generate summary/ })).toBeNull();
    cleanup();
    renderPanel({ session: { ...SESSION, status: "AWAITING_TRANSCRIPT", segmentCount: 0, canGenerate: false } });
    expect(await screen.findByText(/No transcript has been collected/)).toBeInTheDocument();
  });

  it("warns when the transcript changed after the document was written", async () => {
    api.getMeetingArtifacts.mockResolvedValue(DOC({ stale: true }));
    api.generateMeetingOutputs.mockResolvedValue({ data: {} });
    renderPanel();
    expect(await screen.findByText(/transcript changed after this was written/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Generate again" }));
    await waitFor(() => expect(api.generateMeetingOutputs).toHaveBeenCalledWith("s1"));
  });

  // ── reviewing a regenerated version ──────────────────────────────────────
  const PENDING = { version: 3, source: "AI", createdBy: "system", createdAt: "2026-10-08T10:00:00Z", markdown: "# New\n- Different [#1]" };

  it("a regenerated version waits for review: compare shows words, not just colours; accept asks first; keep-mine dismisses", async () => {
    api.getMeetingArtifacts.mockResolvedValue(DOC({ pending: PENDING }));
    api.getArtifactDiff.mockResolvedValue({ data: [{ t: "-", line: "- Old point" }, { t: "+", line: "- Different [#1]" }, { t: " ", line: "" }] });
    api.acceptPendingArtifact.mockResolvedValue({ data: {} });
    api.dismissPendingArtifact.mockResolvedValue({ data: {} });
    renderPanel();
    expect(await screen.findByText(/newly generated version is ready to review/)).toBeInTheDocument();
    expect(screen.getByText(/Your current version has not been changed/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Compare" }));
    const changes = await screen.findByRole("list", { name: "Changes in the new version" });
    expect(within(changes).getByText("Removed:")).toBeInTheDocument();
    expect(within(changes).getByText("Added:")).toBeInTheDocument();
    expect(api.getArtifactDiff).toHaveBeenCalledWith("s1", "SUMMARY", 1, 3);

    fireEvent.click(screen.getByRole("button", { name: "Use new version" }));
    await waitFor(() => expect(api.acceptPendingArtifact).toHaveBeenCalledWith("s1", "SUMMARY"));
    fireEvent.click(screen.getByRole("button", { name: "Keep mine" }));
    await waitFor(() => expect(api.dismissPendingArtifact).toHaveBeenCalledWith("s1", "SUMMARY"));
  });

  it("does not accept the new version if the person declines the confirmation", async () => {
    api.getMeetingArtifacts.mockResolvedValue(DOC({ pending: PENDING }));
    renderPanel({}, false);
    fireEvent.click(await screen.findByRole("button", { name: "Use new version" }));
    await new Promise((r) => setTimeout(r, 20));
    expect(api.acceptPendingArtifact).not.toHaveBeenCalled();
  });

  it("people who can't manage the meeting can read but not review, edit or restore", async () => {
    api.getMeetingArtifacts.mockResolvedValue(DOC({ pending: PENDING }));
    renderPanel({ session: { ...SESSION, canManage: false, canGenerate: false } });
    await screen.findByText(/Version 1/);
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Use new version" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Compare" })).toBeNull();
  });

  // ── editing & history ────────────────────────────────────────────────────
  it("editing saves a NEW version against the version that was on screen", async () => {
    api.saveArtifact.mockResolvedValue({ data: { version: 2 } });
    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    const box = screen.getByLabelText("Edit the summary");
    expect(box).toHaveValue(CUR.markdown);
    fireEvent.change(box, { target: { value: "# My own summary\n- Only this [#2]" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(api.saveArtifact).toHaveBeenCalledWith("s1", "SUMMARY", 1, "# My own summary\n- Only this [#2]"));
  });

  it("shows the server's message when someone else edited first, and keeps the draft", async () => {
    api.saveArtifact.mockRejectedValue({ response: { status: 409, data: { error: "VERSION_CONFLICT", message: "Someone else changed this document since you opened it. Reload to see their version." } } });
    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByLabelText("Edit the summary"), { target: { value: "my draft" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Someone else changed this document");
    expect(screen.getByLabelText("Edit the summary")).toHaveValue("my draft");     // nothing the person typed is lost
  });

  it("older versions can be opened and restored as a new version", async () => {
    const V1 = { ...CUR, version: 1, markdown: "# Old text" };
    api.getMeetingArtifacts.mockResolvedValue(DOC({ current: { ...CUR, version: 2, source: "USER_EDIT", createdBy: "me@x.com" } }));
    api.getArtifactVersions.mockResolvedValue({ data: [{ version: 2, source: "USER_EDIT" }, { version: 1, source: "AI", createdAt: "2026-10-07T10:00:00Z" }] });
    api.getArtifactVersion.mockResolvedValue({ data: V1 });
    api.restoreArtifact.mockResolvedValue({ data: {} });
    renderPanel();
    await screen.findByText(/Version 2 · Edited by me@x.com/);
    const select = screen.getByLabelText("History");
    fireEvent.focus(select);
    await waitFor(() => expect(api.getArtifactVersions).toHaveBeenCalled());
    fireEvent.change(select, { target: { value: "1" } });
    expect(await screen.findByText(/Version 1 · Generated .*\(older version\)/)).toBeInTheDocument();
    expect(screen.getByText("Old text")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();               // an old version is read-only
    fireEvent.click(screen.getByRole("button", { name: "Restore this version" }));
    await waitFor(() => expect(api.restoreArtifact).toHaveBeenCalledWith("s1", "SUMMARY", 1));
  });

  it("has no automatically detectable accessibility violations", async () => {
    api.getMeetingArtifacts.mockResolvedValue(DOC({ pending: PENDING, stale: true }));
    const { container } = renderPanel();
    await screen.findByText(/Version 1/);
    expect(await axe(container)).toHaveNoViolations();
  });
});
