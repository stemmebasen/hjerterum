import { describe, expect, it } from "vitest";
import { parsePicture } from "./picture";

describe("tasks from the group chat and mail", () => {
  it("are kept only when Saga is sure; from the minutes they always are; questions are not tasks", () => {
    const picture = parsePicture(JSON.stringify({ summary: "x", forJacob: [
      { kind: "opgave", text: "Foreslå tekst til fuldmagt", source: "telegram" },
      { kind: "opgave", text: "Ring til udlejer", source: "telegram", sure: true },
      { kind: "opgave", text: "Underskriv kontrakten", source: "dokument" },
      { kind: "spørgsmål", text: "Hvem er suppleant?", source: "telegram" }],
    forMembers: [{ to: ["Kai"], kind: "opgave", text: "Send fuldmagt", source: "mail" }] }));
    expect(picture?.forJacob.map(f => f.text)).toEqual(["Ring til udlejer", "Underskriv kontrakten", "Hvem er suppleant?"]);
    expect(picture?.forMembers).toEqual([]);
  });
});
