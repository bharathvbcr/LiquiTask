import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DataSettings } from "../DataSettings";

// storageService is only touched by the AI Smart Import path; stub it so the
// component renders without reaching real persistence.
vi.mock("../../../src/services/storageService", () => ({
  default: { get: vi.fn().mockReturnValue("") },
  storageService: { get: vi.fn().mockReturnValue("") },
}));

describe("DataSettings — JSON file import", () => {
  const baseProps = () => ({
    downloadLink: "",
    appData: { projects: [], tasks: [], columns: [], priorities: [], customFields: [] },
    addToast: vi.fn(),
    importText: "",
    setImportText: vi.fn(),
    importError: "",
    handleImport: vi.fn(),
    isImporting: false,
    showTemplateRef: false,
    setShowTemplateRef: vi.fn(),
    handleDownloadTemplate: vi.fn(),
    setBulkTasksJson: vi.fn(),
    bulkTasksJson: "",
    bulkImportError: "",
    handleBulkImport: vi.fn(),
    isBulkImporting: false,
    onBulkCreateTasks: vi.fn(),
    handleReset: vi.fn(),
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // The two hidden file inputs are rendered in source order:
  // [0] = app-backup picker, [1] = bulk-task picker.
  const fileInputs = (): HTMLInputElement[] =>
    Array.from(document.querySelectorAll<HTMLInputElement>('input[type="file"]'));

  const pickFile = async (input: HTMLInputElement, name: string, content: string, type: string) => {
    const file = new File([content], name, { type });
    // jsdom doesn't implement Blob.prototype.text(); provide it so the
    // component's `await file.text()` resolves as it does in a real browser.
    Object.defineProperty(file, "text", { value: () => Promise.resolve(content) });
    await act(async () => {
      fireEvent.change(input, { target: { files: [file] } });
    });
  };

  it("renders a Choose JSON file button for both backup and bulk import", () => {
    render(<DataSettings {...baseProps()} />);
    expect(screen.getAllByText(/Choose JSON file/i)).toHaveLength(2);
    expect(fileInputs()).toHaveLength(2);
  });

  it("restricts the file pickers to JSON", () => {
    render(<DataSettings {...baseProps()} />);
    for (const input of fileInputs()) {
      expect(input.accept).toBe(".json,application/json");
    }
  });

  it("loads a chosen .json file into the backup textarea", async () => {
    const props = baseProps();
    render(<DataSettings {...props} />);

    const json = JSON.stringify({ version: "1.0.0", tasks: [], projects: [] });
    await pickFile(fileInputs()[0], "backup.json", json, "application/json");

    await waitFor(() => expect(props.setImportText).toHaveBeenCalledWith(json));
    expect(props.addToast).toHaveBeenCalledWith(expect.stringContaining("backup.json"), "success");
    expect(props.setBulkTasksJson).not.toHaveBeenCalled();
  });

  it("loads a chosen .json file into the bulk-tasks textarea", async () => {
    const props = baseProps();
    render(<DataSettings {...props} />);

    const json = JSON.stringify([{ title: "Task A" }]);
    await pickFile(fileInputs()[1], "tasks.json", json, "application/json");

    await waitFor(() => expect(props.setBulkTasksJson).toHaveBeenCalledWith(json));
    expect(props.setImportText).not.toHaveBeenCalled();
  });

  it("rejects a non-JSON file with an error toast and leaves the field untouched", async () => {
    const props = baseProps();
    render(<DataSettings {...props} />);

    await pickFile(fileInputs()[0], "notes.txt", "hello", "text/plain");

    await waitFor(() =>
      expect(props.addToast).toHaveBeenCalledWith(expect.stringMatching(/\.json/i), "error"),
    );
    expect(props.setImportText).not.toHaveBeenCalled();
  });

  it("rejects an oversized .json file without loading it", async () => {
    const props = baseProps();
    render(<DataSettings {...props} />);

    const file = new File(["{}"], "huge.json", { type: "application/json" });
    // Report a size well above the 25 MB cap without allocating that much.
    Object.defineProperty(file, "size", { value: 26_000_000 });
    Object.defineProperty(file, "text", { value: () => Promise.resolve("{}") });
    await act(async () => {
      fireEvent.change(fileInputs()[0], { target: { files: [file] } });
    });

    await waitFor(() =>
      expect(props.addToast).toHaveBeenCalledWith(expect.stringMatching(/too large/i), "error"),
    );
    expect(props.setImportText).not.toHaveBeenCalled();
  });

  const makeJsonFile = (name: string, content: string) => {
    const file = new File([content], name, { type: "application/json" });
    Object.defineProperty(file, "text", { value: () => Promise.resolve(content) });
    return file;
  };

  it("loads a .json file dropped onto the backup textarea", async () => {
    const props = baseProps();
    render(<DataSettings {...props} />);

    const json = JSON.stringify({ version: "1.0.0", tasks: [] });
    const textarea = screen.getByPlaceholderText(/backup JSON here/i);
    await act(async () => {
      fireEvent.drop(textarea, { dataTransfer: { files: [makeJsonFile("backup.json", json)] } });
    });

    await waitFor(() => expect(props.setImportText).toHaveBeenCalledWith(json));
    expect(props.setBulkTasksJson).not.toHaveBeenCalled();
  });

  it("loads a .json file dropped onto the bulk-tasks textarea", async () => {
    const props = baseProps();
    render(<DataSettings {...props} />);

    const json = JSON.stringify([{ title: "Dropped" }]);
    const textarea = screen.getByPlaceholderText(/bulk tasks JSON here/i);
    await act(async () => {
      fireEvent.drop(textarea, { dataTransfer: { files: [makeJsonFile("tasks.json", json)] } });
    });

    await waitFor(() => expect(props.setBulkTasksJson).toHaveBeenCalledWith(json));
    expect(props.setImportText).not.toHaveBeenCalled();
  });
});
