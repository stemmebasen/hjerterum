import { describe, expect, it } from "vitest";
import { CLERK_LOCALIZATION } from "../src/clerk-localization";

// Requested: "der skal ikke være noget på engelsk" - Clerk's own screens are Danish.

describe("Clerk in Danish", () => {
  it("uses the Danish localization for the login screens", () => {
    expect(CLERK_LOCALIZATION.locale).toBe("da-DK");
    expect(CLERK_LOCALIZATION.signIn?.start?.title).toBe("Log ind");
    expect(CLERK_LOCALIZATION.formButtonPrimary).toBe("Fortsæt");
    expect(CLERK_LOCALIZATION.signIn?.emailCode?.title).toBe("Tjek din email");
    expect(CLERK_LOCALIZATION.userButton?.action__signOut).toBe("Log ud");
  });
});
