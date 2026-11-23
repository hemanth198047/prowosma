import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { useState } from "react";

vi.mock("../../api/ai", () => ({ listAIModels: vi.fn(() => Promise.resolve({ data: { models: ["llama-3.3-70b-versatile"] } })) }));
import BackupProviders from "../../components/BackupProviders";
import { backupsForServer, backupsFromServer, presetOf, MAX_BACKUPS } from "../../utils/backupProviders";

function Harness({ initial = [] }) {
  const [rows, setRows] = useState(initial);
  return (<><BackupProviders rows={rows} onChange={setRows} /><pre data-testid="out">{JSON.stringify(backupsForServer(rows))}</pre></>);
}

describe("BackupProviders", () => {
  beforeEach(() => vi.clearAllMocks());

  it("adds up to the limit and removes rows", () => {
    render(<Harness />);
    for (let i = 0; i < MAX_BACKUPS; i++) fireEvent.click(screen.getByRole("button", { name: /add a backup provider/i }));
    expect(screen.queryByRole("button", { name: /add a backup provider/i })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /remove backup 2/i }));
    expect(screen.getAllByTestId(/^backup-/)).toHaveLength(MAX_BACKUPS - 1);
  });

  it("a saved key is never shown and a blank key is sent as blank (= keep)", () => {
    render(<Harness initial={backupsFromServer([{ id: "b1", label: "Groq", apiProvider: "CUSTOM", apiBaseUrl: "https://api.groq.com/openai/v1/chat/completions", model: "", apiKeySaved: true }])} />);
    expect(screen.getByPlaceholderText(/saved — leave blank to keep it/i)).toHaveValue("");
    const sent = JSON.parse(screen.getByTestId("out").textContent);
    expect(sent[0]).toMatchObject({ id: "b1", apiKey: "" });
    expect(sent[0]).not.toHaveProperty("apiKeySaved");
  });

  it("choosing another service fills in its address and clears the key", () => {
    render(<Harness initial={backupsFromServer([{ id: "b1", label: "Groq", apiProvider: "CUSTOM", apiBaseUrl: "https://api.groq.com/openai/v1/chat/completions", apiKeySaved: true }])} />);
    fireEvent.change(screen.getByLabelText("Service"), { target: { value: "MISTRAL" } });
    const sent = JSON.parse(screen.getByTestId("out").textContent);
    expect(sent[0].apiBaseUrl).toBe("https://api.mistral.ai/v1/chat/completions");
    expect(sent[0].label).toBe("Mistral");
  });

  it("recognises presets from saved rows", () => {
    expect(presetOf({ apiProvider: "GEMINI" }).id).toBe("GEMINI");
    expect(presetOf({ apiProvider: "CUSTOM", apiBaseUrl: "https://api.groq.com/openai/v1/chat/completions/" }).id).toBe("GROQ");
    expect(presetOf({ apiProvider: "CUSTOM", apiBaseUrl: "https://x.example/v1/chat/completions" }).id).toBe("OTHER");
  });
});
