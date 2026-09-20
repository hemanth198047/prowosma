import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import BackupCodesPanel from "../../components/BackupCodesPanel";

const CODES = ["abcde-fghjk", "mnpqr-stuvw", "23456-789ab"];

describe("BackupCodesPanel", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("shows every code, and says they are shown once and single-use", () => {
    render(<BackupCodesPanel codes={CODES} onDone={() => {}} />);
    for (const c of CODES) expect(screen.getByText(c)).toBeTruthy();
    expect(screen.getByText(/shown only now/)).toBeTruthy();
    expect(screen.getByText(/lets you sign in once/)).toBeTruthy();
  });

  it("copies all the codes, one per line", async () => {
    const writeText = vi.fn().mockResolvedValue();
    Object.assign(navigator, { clipboard: { writeText } });
    render(<BackupCodesPanel codes={CODES} onDone={() => {}} />);

    fireEvent.click(screen.getByRole("button", { name: "Copy" }));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith(CODES.join("\n")));
    expect(await screen.findByRole("button", { name: "Copied" })).toBeTruthy();
  });

  it("downloads them as a text file", () => {
    const createObjectURL = vi.fn(() => "blob:codes");
    const revokeObjectURL = vi.fn();
    Object.assign(URL, { createObjectURL, revokeObjectURL });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    render(<BackupCodesPanel codes={CODES} onDone={() => {}} />);

    fireEvent.click(screen.getByRole("button", { name: "Download" }));

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(click).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:codes");
  });

  it("only goes away when the person confirms they have saved the codes", () => {
    const onDone = vi.fn();
    render(<BackupCodesPanel codes={CODES} onDone={onDone} />);
    expect(onDone).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /I've saved these codes/ }));
    expect(onDone).toHaveBeenCalledTimes(1);
  });
});
