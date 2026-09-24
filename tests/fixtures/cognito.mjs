// Deterministic SDK boundary for local browser tests; never part of the production build.
class Session {
  constructor(token) {
    this.token = token;
  }
  isValid() {
    return true;
  }
  getAccessToken() {
    return { getJwtToken: () => this.token };
  }
  getIdToken() {
    return { payload: { email: "fixture@example.invalid" } };
  }
}
export class AuthenticationDetails {
  constructor(options) {
    Object.assign(this, options);
  }
}
export class CognitoUserPool {
  constructor(options) {
    this.storage = options.Storage;
  }
  getCurrentUser() {
    const name = this.storage.getItem("fixture-user");
    return name ? { getUsername: () => name } : null;
  }
}
export class CognitoUser {
  constructor(options) {
    this.username = options.Username;
    this.storage = options.Storage;
  }
  authenticateUser(details, callbacks) {
    if (details.Password === "wrong-password") {
      callbacks.onFailure({ code: "NotAuthorizedException" });
      return;
    }
    callbacks.newPasswordRequired({}, []);
  }
  completeNewPasswordChallenge(_password, _attributes, callbacks) {
    callbacks.mfaSetup("MFA_SETUP", {});
  }
  associateSoftwareToken(callbacks) {
    callbacks.associateSecretCode("E2E_ONLY_SETUP_KEY");
  }
  finish(code, callbacks) {
    if (code !== "123456") {
      callbacks.onFailure({ code: "CodeMismatchException" });
      return;
    }
    const token = this.username.startsWith("access-")
      ? `E2E_ACCESS_TOKEN_${encodeURIComponent(this.username)}_${Math.floor(Date.now() / 1000)}`
      : `E2E_ONLY_TOKEN_${Math.floor(Date.now() / 1000)}`;
    this.storage.setItem("fixture-user", this.username);
    this.storage.setItem("fixture-token", token);
    callbacks.onSuccess(new Session(token));
  }
  verifySoftwareToken(code, _name, callbacks) {
    this.finish(code, callbacks);
  }
  sendMFACode(code, callbacks) {
    this.finish(code, callbacks);
  }
  async getSession(callback) {
    const token = this.storage.getItem("fixture-token");
    if (!token) {
      callback(null, null);
      return;
    }
    try {
      const response = await fetch("/__fixture/refresh-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const result = await response.json();
      this.storage.setItem("fixture-token", result.token);
      callback(null, new Session(result.token));
    } catch (error) {
      callback(error, null);
    }
  }
}
