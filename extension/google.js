// Google sign-in through Chrome's built-in chrome.identity.
//   getToken:   asks Chrome for a Google login token (shows Google's sign-in window if interactive)
//   isSignedIn: checks for a token without showing anything
//   signOut:    makes Chrome forget the token
// The extension never sees your Google password. Chrome keeps the token; this file only
// hands it straight to the code making the Calendar request, and never logs or saves it.

// Returns a token, or throws if you aren't signed in (or said no).
export async function getToken({ interactive = false } = {}) {
  let result;
  try {
    result = await chrome.identity.getAuthToken({ interactive });
  } catch (error) {
    throw new Error(signInMessage(error, interactive));
  }
  // Newer Chrome answers { token }, older Chrome answers the token itself
  const token = typeof result === "string" ? result : result && result.token;
  if (!token) {
    throw new Error("Couldn't sign in to Google: no token");
  }
  return token;
}

// True if Chrome already has a token, without opening a sign-in window.
export async function isSignedIn() {
  try {
    await getToken({ interactive: false });
    return true;
  } catch {
    return false;
  }
}

// Makes Chrome forget one token (after Google rejects it) or every token (signing out).
export async function forgetToken(token) {
  await chrome.identity.removeCachedAuthToken({ token });
}

export async function signOut() {
  await chrome.identity.clearAllCachedAuthTokens();
}

// The error from Chrome can mention details we don't need; keep the message short.
function signInMessage(error, interactive) {
  const text = String((error && error.message) || error || "");
  if (/not granted|revoked|did not approve|canceled|cancelled/i.test(text)) {
    return "Couldn't sign in to Google: permission wasn't given";
  }
  if (!interactive) {
    return "Couldn't sign in to Google: not signed in yet";
  }
  if (/client id|oauth2|bad client/i.test(text)) {
    return "Couldn't sign in to Google: the extension's client ID isn't set up";
  }
  return "Couldn't sign in to Google";
}
