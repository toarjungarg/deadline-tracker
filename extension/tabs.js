// Runs a reader inside a Learn or Crowdmark tab, so the request comes from the site itself.
// Learn refuses requests sent from the extension's background, and Crowdmark wants a security
// code that only its own page has, so both readers ask from inside one of the site's tabs.

export const SITES = {
  learn: {
    name: "Learn",
    match: "https://learn.uwaterloo.ca/*",
    origin: "https://learn.uwaterloo.ca",
    home: "https://learn.uwaterloo.ca/d2l/home",
  },
  crowdmark: {
    name: "Crowdmark",
    match: "https://app.crowdmark.com/*",
    origin: "https://app.crowdmark.com",
    home: "https://app.crowdmark.com/student",
  },
};

// How long to wait for a tab the extension opened to finish loading
export const LOAD_TIMEOUT_MS = 20000;

// "No tab open, so this site wasn't read this time." Not a problem: the saved list is kept,
// and the popup shows it as a note instead of an error.
export class SkippedError extends Error {
  constructor(site) {
    super(`${SITES[site].name} isn't open`);
    this.skipped = true;
  }
}

// Which site a web address belongs to ("learn", "crowdmark"), or null
export function siteOf(url) {
  if (typeof url !== "string") return null;
  return Object.keys(SITES).find((site) => url.startsWith(SITES[site].origin + "/")) || null;
}

// Runs pageFunction(...args) in one of the site's tabs and returns the data it sends back.
// pageFunction must answer { data } or { error }, and must not use anything from outside itself,
// because Chrome copies only the function's own text into the page.
//   openIfMissing: with no tab open, open the site in a background tab, read, then close it.
export async function runInSite(site, pageFunction, args, { openIfMissing = false, timeoutMs = LOAD_TIMEOUT_MS } = {}) {
  const info = SITES[site];
  let tab = await findTab(info);
  let opened = null;
  if (!tab) {
    if (!openIfMissing) {
      throw new SkippedError(site);
    }
    opened = await chrome.tabs.create({ url: info.home, active: false });
    tab = opened;
  }
  try {
    tab = await waitForSite(tab.id, info, timeoutMs);
    const answer = await inject(tab.id, pageFunction, args, info.name);
    if (answer && typeof answer.error === "string") {
      throw new Error(answer.error);
    }
    return answer ? answer.data : undefined;
  } finally {
    // Only tabs the extension opened itself are ever closed
    if (opened) {
      await chrome.tabs.remove(opened.id).catch(() => {});
    }
  }
}

// An open tab on the site, preferring one that has finished loading
async function findTab(info) {
  const tabs = await chrome.tabs.query({ url: info.match });
  return tabs.find((tab) => tab.status === "complete") || tabs[0] || null;
}

// Waits until the tab has finished loading a page on the site.
// Logging in can hop through UW's sign-in pages first, so a stop off the site isn't the end;
// still being off the site when time runs out means you need to log in.
function waitForSite(tabId, info, timeoutMs) {
  return new Promise((resolve, reject) => {
    let done = false;
    let offSite = false;
    const timer = setTimeout(() => {
      finish(new Error(offSite ? loginMessage(info) : `Couldn't read ${info.name}: the page took too long to load`));
    }, timeoutMs);

    function finish(error, tab) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(listener);
      if (error) reject(error);
      else resolve(tab);
    }
    function check(tab) {
      if (!tab || tab.status !== "complete") return;
      // Chrome only shows the extension a tab's address on sites it has permission for,
      // so a sign-in page elsewhere has no address here and counts as off the site
      if (siteOf(tab.url) === siteName(info)) finish(null, tab);
      else offSite = true;
    }
    function listener(id, change, tab) {
      if (id === tabId && change.status === "complete") check(tab);
    }

    chrome.tabs.onUpdated.addListener(listener);
    chrome.tabs.get(tabId).then(check, () => finish(new Error(`Couldn't read ${info.name}: the tab was closed`)));
  });
}

async function inject(tabId, func, args, name) {
  let results;
  try {
    results = await chrome.scripting.executeScript({ target: { tabId }, func, args });
  } catch {
    throw new Error(`Couldn't read ${name}: couldn't run in the ${name} tab`);
  }
  return results && results[0] ? results[0].result : undefined;
}

function loginMessage(info) {
  return `Couldn't read ${info.name}: log in to ${info.name} in Chrome first`;
}

function siteName(info) {
  return Object.keys(SITES).find((site) => SITES[site] === info);
}
