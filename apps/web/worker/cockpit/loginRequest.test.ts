import { describe, expect, it } from "vitest";
import { isLoginRequest } from "./personalLogin.js";

// The chair (27 Nov 2026): Douglas sent "*/login*" (copied from a message with bold text), and Saga answered that she could do nothing with it.
describe("a request for a login", () => {
  it("is /login however it is wrapped, and not a sentence about logging in", () => {
    for (const text of ["/login", "/start login", "*/login*", "**/login**", "_/login_", "`/login`", "\"/login\"", "“/login”", " /login ", "/login@HjerterumSagaBot", "login", "Login!", "log ind", "/LOGIN"])
      expect(isLoginRequest(text), text).toBe(true);
    for (const text of ["I can't login to admin", "login virker ikke", "how do I login?", "/loginx", "please /login"])
      expect(isLoginRequest(text), text).toBe(false);
  });
});
