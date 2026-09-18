"use strict";

/* =========================================================================
   STATE
   ========================================================================= */
const MVSS_STATE_KEY = "mvss_state_v1";

function defaultState() {
  return {
    introSeen: false,
    account: { token: null, email: null },
    children: [],
    activeChildId: null,
    child: { name: "", emoji: "🧒" },
    security: { pinHash: null, pinSalt: null },
    mode: "auth",
    dashTab: "profile",
    childView: "home",
    childPhotoCategory: "all",
    childPhotoIndex: 0,
    voiceCategory: null,
    sentenceStrip: [],
    editingVoiceCategory: null,
    editingWordsList: true,
    settings: {
      buttonSize: "large",
      textSize: "medium",
      showText: true,
      bgColor: "#fff4ec",
      buttonColor: "#ffffff",
      accentColor: "#ff6b4a",
      voiceName: null,
      voiceRate: 1,
      voicePitch: 1,
      voiceVolume: 1,
      speakFullPhrase: true,
      enlargeOnSelect: true,
      vibrate: true,
      animationsEnabled: true,
      confirmSelections: false,
      selectionDelayMs: 0,
      sentenceBuilderEnabled: false,
      videoAutoplay: false,
      videoLoop: false,
      videoMaxDurationSec: 30,
      backgroundMusicEnabled: false,
    },
    childModeConfig: {
      sectionsVisible: { photos: true, voice: true, words: true },
      sectionLabels: {
        photos: "My Photos and Videos",
        voice: "My Voice",
        words: "Words and Actions",
      },
      lockToSingleSection: null,
      showHomeButtonInPhotos: true,
    },
    photoCategories: mvssDefaultPhotoCategories(),
    media: [],
    voiceCategories: mvssDefaultVoiceCategories(),
    wordsActions: mvssDefaultWordsActions(),
    usageHistoryEnabled: false,
    usageHistory: [],
    hasLockedChildMode: false,
  };
}

const PROFILE_KEYS = ["child", "security", "settings", "childModeConfig", "photoCategories", "voiceCategories", "wordsActions", "usageHistoryEnabled", "usageHistory", "hasLockedChildMode"];

const PROFILE_ICONS = ["🧒", "👦", "👧", "🧑", "😊", "🌟", "🚗", "⚽", "🎨", "🦖", "🐶", "🐱", "🦄", "🌈", "🚀", "🎵", "📚", "🧩", "⭐", "🎈"];

let AppState = loadState();
let ActiveRecording = null;
let pinFailCount = 0;
let lastSelectionTs = 0;
let parentAccessTapTimes = [];
let booting = false;
let profilePushTimer = null;

function loadState() {
  try {
    const raw = localStorage.getItem(MVSS_STATE_KEY);
    if (!raw) return defaultState();
    const saved = JSON.parse(raw);
    const base = defaultState();
    const merged = Object.assign({}, base, saved);
    merged.settings = Object.assign({}, base.settings, saved.settings || {});
    merged.childModeConfig = Object.assign({}, base.childModeConfig, saved.childModeConfig || {});
    merged.childModeConfig.sectionsVisible = Object.assign(
      {},
      base.childModeConfig.sectionsVisible,
      (saved.childModeConfig || {}).sectionsVisible || {}
    );
    merged.childModeConfig.sectionLabels = Object.assign(
      {},
      base.childModeConfig.sectionLabels,
      (saved.childModeConfig || {}).sectionLabels || {}
    );
    merged.child = Object.assign({}, base.child, saved.child || {});
    merged.security = Object.assign({}, base.security, saved.security || {});
    merged.account = Object.assign({}, base.account, saved.account || {});
    merged.children = Array.isArray(saved.children) ? saved.children : [];
    merged.activeChildId = saved.activeChildId || null;
    merged.sentenceStrip = [];
    merged.showUnlockModal = false;
    merged.showDeleteAccountModal = false;
    // The actual mode (auth / picker / onboard-child / child / parent) is
    // decided by boot(), which re-checks the account with the server.
    return merged;
  } catch (e) {
    console.error("Failed to load saved data, starting fresh.", e);
    return defaultState();
  }
}

function saveState() {
  try {
    const toSave = Object.assign({}, AppState);
    localStorage.setItem(MVSS_STATE_KEY, JSON.stringify(toSave));
  } catch (e) {
    console.error("Could not save data locally.", e);
    alert("This device is low on storage space, so the latest change may not have been saved.");
  }
}

function persistAndRender() {
  saveState();
  schedulePushProfile();
  render();
}

/* =========================================================================
   BACKEND API (account + child profile/settings sync only — never media)
   ========================================================================= */
const API_BASE = "https://my-voice-safe-space-api.onrender.com";

class ApiError extends Error {
  constructor(message, status, offline) {
    super(message);
    this.status = status;
    this.offline = !!offline;
  }
}

async function apiRequest(path, options) {
  const opts = Object.assign({}, options);
  opts.headers = Object.assign({ "Content-Type": "application/json" }, (options || {}).headers);
  if (AppState.account.token) opts.headers.Authorization = "Bearer " + AppState.account.token;
  let res;
  try {
    res = await fetch(API_BASE + path, opts);
  } catch (e) {
    throw new ApiError("You appear to be offline.", 0, true);
  }
  let body = null;
  try {
    body = await res.json();
  } catch (e) {
    /* no JSON body */
  }
  if (!res.ok) throw new ApiError((body && body.error) || "Something went wrong.", res.status);
  return body;
}

const apiRegister = (email, password) => apiRequest("/api/auth/register", { method: "POST", body: JSON.stringify({ email, password }) });
const apiLogin = (email, password) => apiRequest("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });
const apiDeleteAccount = () => apiRequest("/api/auth/me", { method: "DELETE" });
const apiListChildren = () => apiRequest("/api/children").then((r) => r.children);
const apiCreateChild = (name, data) => apiRequest("/api/children", { method: "POST", body: JSON.stringify({ name, data }) }).then((r) => r.child);
const apiUpdateChild = (id, patch) => apiRequest("/api/children/" + id, { method: "PUT", body: JSON.stringify(patch) }).then((r) => r.child);
const apiDeleteChild = (id) => apiRequest("/api/children/" + id, { method: "DELETE" });

function buildProfileSnapshot() {
  const snap = {};
  PROFILE_KEYS.forEach((k) => (snap[k] = AppState[k]));
  return snap;
}

function loadChildIntoProfile(child) {
  const fresh = defaultState();
  const data = child.data || {};
  AppState.settings = Object.assign({}, fresh.settings, data.settings || {});
  AppState.childModeConfig = Object.assign({}, fresh.childModeConfig, data.childModeConfig || {});
  AppState.childModeConfig.sectionsVisible = Object.assign({}, fresh.childModeConfig.sectionsVisible, (data.childModeConfig || {}).sectionsVisible || {});
  AppState.childModeConfig.sectionLabels = Object.assign({}, fresh.childModeConfig.sectionLabels, (data.childModeConfig || {}).sectionLabels || {});
  AppState.child = Object.assign({}, fresh.child, { name: child.name }, data.child || {});
  AppState.security = Object.assign({}, fresh.security, data.security || {});
  AppState.photoCategories = data.photoCategories || fresh.photoCategories;
  AppState.voiceCategories = data.voiceCategories || fresh.voiceCategories;
  AppState.wordsActions = data.wordsActions || fresh.wordsActions;
  AppState.usageHistoryEnabled = data.usageHistoryEnabled || false;
  AppState.usageHistory = data.usageHistory || [];
  AppState.hasLockedChildMode = data.hasLockedChildMode || false;
  AppState.activeChildId = child.id;
}

function resetProfileFieldsForNewChild() {
  const fresh = defaultState();
  PROFILE_KEYS.forEach((k) => (AppState[k] = fresh[k]));
}

function schedulePushProfile() {
  if (!AppState.account.token || !AppState.activeChildId) return;
  clearTimeout(profilePushTimer);
  profilePushTimer = setTimeout(flushProfilePush, 1200);
}

async function flushProfilePush() {
  clearTimeout(profilePushTimer);
  if (!AppState.account.token || !AppState.activeChildId) return;
  try {
    const updated = await apiUpdateChild(AppState.activeChildId, { name: AppState.child.name || "Child", data: buildProfileSnapshot() });
    const idx = AppState.children.findIndex((c) => c.id === AppState.activeChildId);
    if (idx >= 0) AppState.children[idx] = updated;
  } catch (e) {
    console.error("Could not sync to the server (will retry on the next change).", e);
  }
}

/* =========================================================================
   BOOT — decides auth / picker / onboarding / child / parent on launch
   ========================================================================= */
async function boot() {
  if (!AppState.introSeen) {
    AppState.mode = "intro";
    render();
    return;
  }
  if (!AppState.account.token) {
    AppState.mode = "auth";
    render();
    return;
  }
  // Don't render whatever mode happened to be saved last time (it could be
  // stale — e.g. "child" from a previous session) until bootAfterAuth has
  // actually verified it against the server. Show a neutral loading screen
  // instead, especially important on slower mobile connections.
  booting = true;
  render();
  await bootAfterAuth();
}

function landOnChildOrParent() {
  // Only auto-enter Child Mode once a parent has actually used "Lock into
  // Child Mode" at least once for this child. Before that (a brand-new
  // profile, or any reload in between), land in the Parent dashboard —
  // there's setup a parent will want to do before handing the device over.
  if (AppState.hasLockedChildMode) {
    AppState.mode = "child";
    AppState.childView = AppState.childModeConfig.lockToSingleSection || "home";
  } else {
    AppState.mode = "parent";
    AppState.dashTab = "profile";
  }
}

async function bootAfterAuth() {
  try {
    const children = await apiListChildren();
    AppState.children = children;
    if (AppState.activeChildId) {
      const match = children.find((c) => c.id === AppState.activeChildId);
      if (match) loadChildIntoProfile(match);
      else AppState.activeChildId = null;
    }
    if (AppState.activeChildId) {
      landOnChildOrParent();
    } else if (children.length === 1) {
      loadChildIntoProfile(children[0]);
      landOnChildOrParent();
    } else if (children.length === 0) {
      resetProfileFieldsForNewChild();
      AppState.mode = "onboard-child";
      AppState.onboardingStep = 2;
    } else {
      AppState.mode = "picker";
    }
    booting = false;
    saveState();
    render();
  } catch (e) {
    if (e.status === 401) {
      AppState.account = { token: null, email: null };
      AppState.children = [];
      AppState.activeChildId = null;
      AppState.mode = "auth";
      AppState.authError = "Your session has expired. Please sign in again.";
    } else if (AppState.activeChildId) {
      // Offline: keep using the cached profile already on this device.
      landOnChildOrParent();
    } else {
      AppState.mode = "auth";
      AppState.authError = "Could not reach the server. Please check your connection and try again.";
    }
    booting = false;
    saveState();
    render();
  }
}

/* =========================================================================
   SECURITY (PIN)
   ========================================================================= */
async function sha256Hex(text) {
  if (window.crypto && crypto.subtle && location.protocol !== "file:") {
    try {
      const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
      return Array.from(new Uint8Array(buf))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
    } catch (e) {
      /* fall through to fallback */
    }
  }
  // Fallback (non-cryptographic) hash for unsupported/insecure contexts.
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = (h * 33) ^ text.charCodeAt(i);
  return "fb" + (h >>> 0).toString(16);
}

function randomSalt() {
  const arr = new Uint8Array(16);
  (window.crypto || {}).getRandomValues ? crypto.getRandomValues(arr) : arr.forEach((_, i) => (arr[i] = Math.floor(Math.random() * 256)));
  return Array.from(arr).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function setPin(pin) {
  const salt = randomSalt();
  const hash = await sha256Hex(salt + ":" + pin);
  AppState.security.pinSalt = salt;
  AppState.security.pinHash = hash;
}

async function verifyPin(pin) {
  if (!AppState.security.pinHash) return true;
  const hash = await sha256Hex(AppState.security.pinSalt + ":" + pin);
  return hash === AppState.security.pinHash;
}

/* ---- Optional biometric (Face ID / Touch ID / fingerprint) unlock ----
   This is a device-local convenience gate, not a server-verified login:
   the OS itself withholds the credential until the biometric check
   passes, which is the actual security property we rely on. */
function bufToBase64(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf)));
}
function base64ToBuf(b64) {
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr.buffer;
}

async function enrollBiometricCredential() {
  if (!window.PublicKeyCredential) throw new Error("Face/Touch ID is not supported in this browser.");
  const available = await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  if (!available) throw new Error("This device has no Face ID, Touch ID or fingerprint sensor available to the browser.");
  const challenge = crypto.getRandomValues(new Uint8Array(32));
  const userId = crypto.getRandomValues(new Uint8Array(16));
  const cred = await navigator.credentials.create({
    publicKey: {
      challenge,
      rp: { name: "My Voice and Safe Space" },
      user: { id: userId, name: AppState.account.email || "parent", displayName: AppState.account.email || "Parent" },
      pubKeyCredParams: [
        { type: "public-key", alg: -7 },
        { type: "public-key", alg: -257 },
      ],
      authenticatorSelection: { authenticatorAttachment: "platform", userVerification: "required" },
      timeout: 60000,
    },
  });
  return bufToBase64(cred.rawId);
}

async function verifyBiometricCredential(credentialIdBase64) {
  const challenge = crypto.getRandomValues(new Uint8Array(32));
  await navigator.credentials.get({
    publicKey: {
      challenge,
      allowCredentials: [{ id: base64ToBuf(credentialIdBase64), type: "public-key" }],
      userVerification: "required",
      timeout: 60000,
    },
  });
  return true;
}

/* =========================================================================
   SPEECH
   ========================================================================= */
let cachedVoices = [];
function refreshVoices() {
  if (!("speechSynthesis" in window)) return;
  cachedVoices = speechSynthesis.getVoices();
}
if ("speechSynthesis" in window) {
  refreshVoices();
  speechSynthesis.onvoiceschanged = refreshVoices;
}

function speakText(text) {
  if (!("speechSynthesis" in window) || !text) return;
  try {
    speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(text);
    const v = cachedVoices.find((v) => v.name === AppState.settings.voiceName);
    if (v) utter.voice = v;
    utter.rate = AppState.settings.voiceRate;
    utter.pitch = AppState.settings.voicePitch;
    utter.volume = AppState.settings.voiceVolume;
    utter.onstart = duckMusic;
    utter.onend = unduckMusic;
    utter.onerror = unduckMusic;
    speechSynthesis.speak(utter);
  } catch (e) {
    console.error("Speech failed", e);
  }
}

async function speakButton(btn) {
  const player = document.getElementById("audio-player");
  if (btn.audioFileId && player) {
    const url = await idbGetObjectUrl(btn.audioFileId);
    if (url) {
      player.src = url;
      player.play().catch(() => {});
      return;
    }
  }
  speakText(AppState.settings.speakFullPhrase ? btn.phrase : btn.label);
}

function logUsage(section, label) {
  if (!AppState.usageHistoryEnabled) return;
  AppState.usageHistory.unshift({ ts: Date.now(), section, label });
  AppState.usageHistory = AppState.usageHistory.slice(0, 200);
}

/* =========================================================================
   BACKGROUND MUSIC — a soft, generated ambient pad (Web Audio API only,
   no audio files, so there's nothing to license). Off by default, only
   ever plays in Child Mode, and ducks to near-silent the instant anything
   is spoken so it never competes with the board — sound in Child Mode
   should still be led by the child's own selections, this just adds a
   calm bed underneath when a parent chooses to turn it on.
   ========================================================================= */
let musicCtx = null;
let musicNodes = null;
let musicPlaying = false;
const MUSIC_VOLUME = 0.05;
const MUSIC_CHORDS = [
  [261.63, 329.63, 392.0, 493.88], // Cmaj7
  [220.0, 261.63, 329.63, 392.0], // Am7
  [174.61, 220.0, 261.63, 349.23], // Fmaj7
  [196.0, 246.94, 293.66, 349.23], // G6
];
const CHORD_SECONDS = 6;

function startBackgroundMusic() {
  if (musicPlaying) return;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  if (!musicCtx) musicCtx = new AC();
  if (musicCtx.state === "suspended") musicCtx.resume().catch(() => {});
  musicPlaying = true;

  const ctx = musicCtx;
  const masterGain = ctx.createGain();
  masterGain.gain.value = 0;
  masterGain.connect(ctx.destination);
  masterGain.gain.linearRampToValueAtTime(MUSIC_VOLUME, ctx.currentTime + 2.5);

  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = 900;
  filter.connect(masterGain);

  let chordIndex = 0;
  function playChord() {
    if (!musicPlaying) return;
    const now = ctx.currentTime;
    const chord = MUSIC_CHORDS[chordIndex % MUSIC_CHORDS.length];
    chordIndex++;
    chord.forEach((freq) => {
      const osc = ctx.createOscillator();
      osc.type = "triangle";
      osc.frequency.value = freq;
      const g = ctx.createGain();
      g.gain.value = 0;
      osc.connect(g);
      g.connect(filter);
      osc.start(now);
      g.gain.linearRampToValueAtTime(1, now + 1.4);
      g.gain.linearRampToValueAtTime(0, now + CHORD_SECONDS - 0.5);
      osc.stop(now + CHORD_SECONDS);
    });
  }
  playChord();
  const chordTimer = setInterval(playChord, CHORD_SECONDS * 1000);
  musicNodes = { masterGain, chordTimer };
}

function stopBackgroundMusic() {
  if (!musicPlaying) return;
  musicPlaying = false;
  if (musicNodes) {
    clearInterval(musicNodes.chordTimer);
    const g = musicNodes.masterGain;
    const ctx = musicCtx;
    g.gain.cancelScheduledValues(ctx.currentTime);
    g.gain.setValueAtTime(g.gain.value, ctx.currentTime);
    g.gain.linearRampToValueAtTime(0, ctx.currentTime + 1);
    setTimeout(() => { try { g.disconnect(); } catch (e) {} }, 1200);
  }
  musicNodes = null;
}

function duckMusic() {
  if (!musicPlaying || !musicNodes) return;
  const ctx = musicCtx, g = musicNodes.masterGain, now = ctx.currentTime;
  g.gain.cancelScheduledValues(now);
  g.gain.setValueAtTime(g.gain.value, now);
  g.gain.linearRampToValueAtTime(MUSIC_VOLUME * 0.15, now + 0.15);
}

function unduckMusic() {
  if (!musicPlaying || !musicNodes) return;
  const ctx = musicCtx, g = musicNodes.masterGain, now = ctx.currentTime;
  g.gain.cancelScheduledValues(now);
  g.gain.setValueAtTime(g.gain.value, now);
  g.gain.linearRampToValueAtTime(MUSIC_VOLUME, now + 0.6);
}

function syncBackgroundMusic() {
  const shouldPlay = !booting && AppState.mode === "child" && AppState.settings.backgroundMusicEnabled;
  if (shouldPlay) startBackgroundMusic();
  else stopBackgroundMusic();
}

/* =========================================================================
   THEME
   ========================================================================= */
function applyTheme() {
  const s = AppState.settings;
  const sizeMap = { small: "120px", medium: "150px", large: "188px" };
  const textMap = { small: "16px", medium: "20px", large: "26px" };
  document.documentElement.style.setProperty("--bg", s.bgColor);
  document.documentElement.style.setProperty("--btn", s.buttonColor);
  document.documentElement.style.setProperty("--accent", s.accentColor);
  document.documentElement.style.setProperty("--btn-size", sizeMap[s.buttonSize] || "168px");
  document.documentElement.style.setProperty("--text-size", textMap[s.textSize] || "20px");
}

/* =========================================================================
   RENDER DISPATCH
   ========================================================================= */
function render() {
  applyTheme();
  const root = document.getElementById("app");
  let html;
  if (booting) html = renderLoading();
  else if (AppState.mode === "intro") html = renderIntroVideo();
  else if (AppState.mode === "auth") html = renderAuthScreen();
  else if (AppState.mode === "onboard-child") html = renderOnboarding();
  else if (AppState.mode === "picker") html = renderChildPicker();
  else if (AppState.mode === "child") html = renderChildMode(false);
  else html = renderParentDashboard();
  if (!booting && AppState.showUnlockModal) html += renderUnlockModal();
  if (!booting && AppState.showLockReminder) html += renderLockReminderModal();
  if (!booting && AppState.showDeleteAccountModal) html += renderDeleteAccountModal();
  if (!booting && AppState.showIntroReplay) html += renderIntroReplayModal();
  root.innerHTML = html;
  hydrateMediaEls();
  hydrateIntroVideo();
  document.body.style.backgroundColor = AppState.settings.bgColor;
  syncBackgroundMusic();
}

function hydrateIntroVideo() {
  const vid = document.getElementById("intro-video");
  if (vid) vid.addEventListener("ended", () => Actions.introFinish());
}

function renderLoading() {
  return `<div class="screen loading-screen"><div class="loading-spinner" aria-label="Loading"></div></div>`;
}

function renderIntroVideo() {
  return `
    <div class="screen intro-screen">
      <video id="intro-video" class="intro-video" autoplay muted playsinline>
        <source src="assets/intro.webm" type="video/webm" />
        <source src="assets/intro.mp4" type="video/mp4" />
      </video>
      <button class="pill-btn secondary intro-skip" data-action="introFinish">Skip</button>
    </div>`;
}

function renderIntroReplayModal() {
  return `
    <div class="modal-overlay">
      <div class="modal-card" style="padding:10px;max-width:640px;">
        <video class="intro-video" style="border-radius:14px;" autoplay controls playsinline>
          <source src="assets/intro.webm" type="video/webm" />
          <source src="assets/intro.mp4" type="video/mp4" />
        </video>
        <button class="pill-btn" style="margin-top:12px;width:100%;" data-action="closeIntroReplay">Close</button>
      </div>
    </div>`;
}

function hydrateMediaEls() {
  document.querySelectorAll("[data-file-id]").forEach(async (el) => {
    const id = el.getAttribute("data-file-id");
    const url = await idbGetObjectUrl(id);
    if (url) el.src = url;
  });
}

/* =========================================================================
   ESCAPE HELPER
   ========================================================================= */
function esc(str) {
  return String(str == null ? "" : str).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[c]));
}

/* =========================================================================
   ACCOUNT AUTH / CHILD PICKER / ONBOARDING
   ========================================================================= */
function renderAuthScreen() {
  const authMode = AppState.authMode || "login";
  return `<div class="screen"><div class="modal-overlay"><div class="modal-card">
    <div class="auth-brand">
      <div class="auth-logo"><img src="icons/icon.svg" alt="My Voice and Safe Space logo" /></div>
      <div class="auth-name">My Voice and Safe Space</div>
      <p class="auth-slogan">Helping people with communication difficulties be heard, in a space built to keep them safe.</p>
    </div>
    <h2>${authMode === "login" ? "Sign in" : "Create your parent account"}</h2>
    ${authMode === "register" ? `<p style="color:#6b7280;font-size:14px;">My Voice and Safe Space helps people with communication difficulties be heard, in a space built to keep them safe. It does not replace professional advice or an individually assessed communication system, and it is not officially affiliated with PECS. Your account and each child's board/settings sync securely so you can sign in on other devices. Photos, videos and voice recordings always stay only on the device that captured them.</p>` : ""}
    ${AppState.authError ? `<div class="banner">${esc(AppState.authError)}</div>` : ""}
    <div class="field"><label for="auth-email">Email</label><input id="auth-email" type="email" autocomplete="username" value="${esc(AppState.authEmail || "")}" /></div>
    <div class="field"><label for="auth-password">Password</label><input id="auth-password" type="password" autocomplete="${authMode === "login" ? "current-password" : "new-password"}" /></div>
    ${AppState.authBusy
      ? `<p>Please wait…</p>`
      : `<button class="pill-btn" style="width:100%;" data-action="authSubmit">${authMode === "login" ? "Sign in" : "Create account"}</button>`}
    <p style="text-align:center;margin-top:14px;">
      ${authMode === "login"
        ? `New here? <button type="button" class="link-btn" data-action="authSwitchMode" data-mode="register">Create an account</button>`
        : `Already have an account? <button type="button" class="link-btn" data-action="authSwitchMode" data-mode="login">Sign in</button>`}
    </p>
  </div></div></div>`;
}

function renderChildPicker() {
  return `<div class="screen"><div class="modal-overlay"><div class="modal-card">
    <h2>Choose a child profile</h2>
    <div class="item-list">
      ${AppState.children.map((c) => `
        <button class="item-card" data-action="pickerSelectChild" data-id="${c.id}" style="text-align:left;background:var(--btn);font:inherit;width:100%;cursor:pointer;">
          <strong>${esc(c.name)}</strong>
        </button>`).join("")}
    </div>
    <button class="pill-btn secondary" style="margin-top:14px;width:100%;" data-action="pickerAddChild">➕ Add another child</button>
    <button class="pill-btn secondary" style="margin-top:10px;width:100%;" data-action="signOut">Sign out</button>
  </div></div></div>`;
}

function renderOnboarding() {
  const step = AppState.onboardingStep || 2;
  let body = "";
  if (step === 2) {
    body = `
      <h2>Tell us about your child</h2>
      <div class="field">
        <label for="ob-name">Child's preferred name</label>
        <input id="ob-name" type="text" value="${esc(AppState.child.name)}" placeholder="e.g. Alfie" />
      </div>
      <div class="field">
        <label>Profile icon</label>
        <div class="row">${PROFILE_ICONS.map(e => `<button class="icon-btn" data-action="onboardEmoji" data-val="${e}" style="${e===AppState.child.emoji ? 'outline:3px solid var(--accent)':''}">${e}</button>`).join("")}</div>
      </div>
      <button class="pill-btn" data-action="onboardSaveName">Continue</button>`;
  } else if (step === 3) {
    const buf = AppState.onboardingPinBuffer || "";
    const stage = AppState.onboardingPinStage || "enter";
    body = `
      <h2>${stage === "enter" ? "Set a parent PIN" : "Confirm the PIN"}</h2>
      <p>This PIN is needed to leave Child Mode. Choose 4 digits only you (or another trusted adult) know.</p>
      ${AppState.onboardingPinError ? `<div class="banner">${esc(AppState.onboardingPinError)}</div>` : ""}
      <div class="pin-dots">${[0,1,2,3].map(i => `<div class="pin-dot ${i < buf.length ? "filled" : ""}"></div>`).join("")}</div>
      ${renderPinPad("onboardPinDigit", "onboardPinBackspace")}
      `;
  }
  return `<div class="screen"><div class="modal-overlay"><div class="modal-card">${body}</div></div></div>`;
}

function renderPinPad(digitAction, backspaceAction) {
  const keys = ["1","2","3","4","5","6","7","8","9","","0","⌫"];
  return `<div class="pin-pad">${keys.map(k => {
    if (k === "") return `<span></span>`;
    if (k === "⌫") return `<button data-action="${backspaceAction}">⌫</button>`;
    return `<button data-action="${digitAction}" data-val="${k}">${k}</button>`;
  }).join("")}</div>`;
}

/* =========================================================================
   CHILD MODE
   ========================================================================= */
function visibleSections() {
  const cfg = AppState.childModeConfig;
  return ["photos", "voice", "words"].filter((s) => cfg.sectionsVisible[s]);
}

function renderChildMode(embeddedUnused) {
  const embedded = false;
  const view = AppState.childModeConfig.lockToSingleSection || AppState.childView;
  let inner = "";
  if (view === "home" || (!AppState.childModeConfig.lockToSingleSection && AppState.childView === "home")) {
    inner = renderChildHome();
  } else if (view === "photos" || AppState.childView === "photos") {
    inner = renderChildPhotosGrid();
  } else if (AppState.childView === "photo-viewer") {
    inner = renderChildPhotoViewer();
  } else if (view === "voice" || AppState.childView === "voice") {
    inner = renderChildVoice();
  } else if (view === "words" || AppState.childView === "words") {
    inner = renderChildWords();
  } else {
    inner = renderChildHome();
  }
  const spot = `<button class="parent-access-btn" data-action="parentAccessTap" aria-label="Parent Access">🔒</button>`;
  const musicToggle = AppState.settings.backgroundMusicEnabled
    ? `<button class="music-toggle-btn" data-action="toggleMusicNow" aria-label="Turn music off">🔊</button>`
    : "";
  return `<div class="screen" oncontextmenu="return false">${inner}${spot}${musicToggle}</div>`;
}

function renderChildHome() {
  const cfg = AppState.childModeConfig;
  const tiles = { photos: { emoji: "📷" }, voice: { emoji: "🗣️" }, words: { emoji: "👋" } };
  const sections = visibleSections();
  return `
    <div class="child-home">
      <div class="greeting">Hi ${esc(AppState.child.name || "there")}! ${esc(AppState.child.emoji)}</div>
      <div class="child-home-tiles">
        ${sections.map(s => `
          <button class="home-tile" data-action="childOpenSection" data-section="${s}">
            <span class="emoji">${tiles[s].emoji}</span>
            <span>${esc(cfg.sectionLabels[s])}</span>
          </button>`).join("")}
      </div>
      ${sections.length === 0 ? `<div class="empty-state">No sections are turned on yet. Ask a grown-up to enable one in Parent Mode.</div>` : ""}
    </div>`;
}

function homeButtonHtml() {
  if (AppState.childModeConfig.lockToSingleSection) return "";
  return `<button class="icon-btn" data-action="childHome" aria-label="Home">🏠</button>`;
}

function renderChildPhotosGrid() {
  const cats = AppState.photoCategories;
  const filter = AppState.childPhotoCategory;
  const items = AppState.media.filter((m) => m.childId === AppState.activeChildId && !m.hidden && (filter === "all" || m.categoryId === filter));
  return `
    <div class="topbar">
      ${homeButtonHtml()}
      <h2>${esc(AppState.childModeConfig.sectionLabels.photos)}</h2>
      <span class="spacer"></span>
    </div>
    <div class="category-tabs">
      <button class="category-tab ${filter === "all" ? "active" : ""}" data-action="childPhotoCategory" data-cat="all">All</button>
      ${cats.map(c => `<button class="category-tab ${filter === c.id ? "active" : ""}" data-action="childPhotoCategory" data-cat="${c.id}">${esc(c.name)}</button>`).join("")}
    </div>
    <div class="grid">
      ${items.map((m, i) => `
        <button class="tile-btn" data-action="childOpenPhoto" data-id="${m.id}">
          ${m.favorite ? `<span class="fav-badge">⭐</span>` : ""}
          ${m.type === "video"
            ? `<div class="emoji">🎬</div>`
            : `<img class="tile-img" data-file-id="${m.fileId}" alt="" />`}
          <div class="label">${esc(m.name)}</div>
        </button>`).join("")}
    </div>
    ${items.length === 0 ? `<div class="empty-state">No photos or videos here yet. Ask a grown-up to add some in Parent Mode.</div>` : ""}
  `;
}

function currentPhotoList() {
  const filter = AppState.childPhotoCategory;
  return AppState.media.filter((m) => m.childId === AppState.activeChildId && !m.hidden && (filter === "all" || m.categoryId === filter));
}

function navigatePhotoBy(dir) {
  const list = currentPhotoList();
  const next = AppState.childPhotoIndex + dir;
  if (next >= 0 && next < list.length) {
    AppState.childPhotoIndex = next;
    AppState.childPhotoEnterDir = dir;
    logUsage("photos", (list[next] || {}).name || "");
    render();
  }
}

function renderChildPhotoViewer() {
  const list = currentPhotoList();
  const item = list[AppState.childPhotoIndex];
  if (!item) return renderChildPhotosGrid();
  const showHome = AppState.childModeConfig.showHomeButtonInPhotos;
  const enterDir = AppState.childPhotoEnterDir;
  AppState.childPhotoEnterDir = null;
  const enterClass = enterDir === 1 ? "viewer-enter-right" : enterDir === -1 ? "viewer-enter-left" : "";
  return `
    <div class="viewer">
      <div class="topbar">
        <button class="icon-btn" data-action="childPhotoBackToGrid" aria-label="Back">⬅️</button>
        <span class="spacer"></span>
        ${showHome ? homeButtonHtml() : ""}
      </div>
      <div class="viewer-media">
        ${item.type === "video"
          ? `<video class="${enterClass}" data-file-id="${item.fileId}" controls ${AppState.settings.videoAutoplay ? "autoplay" : ""} ${AppState.settings.videoLoop ? "loop" : ""} playsinline></video>`
          : `<img class="${enterClass}" data-file-id="${item.fileId}" alt="" />`}
      </div>
      <div class="viewer-caption">${esc(item.name)}</div>
      <div class="viewer-controls">
        <button class="viewer-nav-btn" data-action="childPhotoNav" data-dir="-1" ${AppState.childPhotoIndex <= 0 ? "disabled" : ""}>⬅️</button>
        <button class="viewer-nav-btn" data-action="childPhotoNav" data-dir="1" ${AppState.childPhotoIndex >= list.length - 1 ? "disabled" : ""}>➡️</button>
      </div>
    </div>`;
}

function renderChildVoice() {
  const cats = AppState.voiceCategories;
  const activeCat = AppState.voiceCategory || (cats[0] && cats[0].id);
  const cat = cats.find((c) => c.id === activeCat) || cats[0];
  const buttons = cat ? cat.buttons.filter((b) => !b.hidden) : [];
  const strip = AppState.sentenceStrip;
  return `
    <div class="topbar">
      ${homeButtonHtml()}
      <h2>${esc(AppState.childModeConfig.sectionLabels.voice)}</h2>
      <span class="spacer"></span>
    </div>
    <div class="category-tabs">
      ${cats.map(c => `<button class="category-tab ${activeCat === c.id ? "active" : ""}" data-action="childVoiceCategory" data-cat="${c.id}">${esc(c.name)}</button>`).join("")}
    </div>
    ${AppState.settings.sentenceBuilderEnabled ? `
    <div class="sentence-bar">
      <div class="sentence-strip">
        ${strip.length === 0 ? `<span style="color:#9ca3af;">Tap words to build a sentence…</span>` : strip.map(s => `<span class="sentence-chip"><span class="e">${esc(s.emoji)}</span>${esc(s.label)}</span>`).join("")}
      </div>
      <button class="pill-btn secondary" data-action="sentenceUndo" ${strip.length===0?"disabled":""}>Undo</button>
      <button class="pill-btn secondary" data-action="sentenceClear" ${strip.length===0?"disabled":""}>Clear</button>
      <button class="pill-btn" data-action="sentenceSpeak" ${strip.length===0?"disabled":""}>🔊 Speak</button>
    </div>` : ""}
    <div class="grid" id="voiceGrid">
      ${buttons.map(b => `
        <button class="tile-btn ${cat.priority ? "priority" : ""} ${AppState.settings.showText ? "" : "no-text"}" data-action="tapVoiceButton" data-cat="${cat.id}" data-btn="${b.id}" id="vb_${b.id}">
          ${b.imageFileId ? `<img class="tile-img" data-file-id="${b.imageFileId}" alt="" />` : `<div class="emoji">${esc(b.emoji || "🔵")}</div>`}
          <div class="label">${esc(b.label)}</div>
        </button>`).join("")}
    </div>
    ${buttons.length === 0 ? `<div class="empty-state">No buttons in this category yet.</div>` : ""}
    ${AppState.pendingConfirm ? renderConfirmOverlay() : ""}
  `;
}

function renderConfirmOverlay() {
  const pc = AppState.pendingConfirm;
  let label = "", emoji = "🔵";
  if (pc.type === "voice") {
    const cat = AppState.voiceCategories.find((c) => c.id === pc.catId);
    const btn = cat && cat.buttons.find((b) => b.id === pc.btnId);
    if (btn) { label = btn.label; emoji = btn.emoji; }
  } else if (pc.type === "words") {
    const w = AppState.wordsActions.find((x) => x.id === pc.id);
    if (w) { label = w.label; emoji = w.emoji; }
  }
  return `
    <div class="modal-overlay">
      <div class="modal-card" style="text-align:center;">
        <div style="font-size:70px;">${esc(emoji)}</div>
        <h2>Say "${esc(label)}"?</h2>
        <div class="row" style="justify-content:center;">
          <button class="pill-btn secondary" data-action="cancelConfirm">Cancel</button>
          <button class="pill-btn" data-action="confirmSelection">Yes</button>
        </div>
      </div>
    </div>`;
}

function renderChildWords() {
  const items = AppState.wordsActions.filter((w) => !w.hidden);
  return `
    <div class="topbar">
      ${homeButtonHtml()}
      <h2>${esc(AppState.childModeConfig.sectionLabels.words)}</h2>
      <span class="spacer"></span>
    </div>
    <div class="grid">
      ${items.map(w => `
        <button class="tile-btn ${AppState.settings.showText ? "" : "no-text"}" data-action="tapWordAction" data-id="${w.id}" id="wb_${w.id}">
          ${w.imageFileId ? `<img class="tile-img" data-file-id="${w.imageFileId}" alt="" />` : `<div class="emoji">${esc(w.emoji || "🔵")}</div>`}
          <div class="label">${esc(w.label)}</div>
        </button>`).join("")}
    </div>
    ${AppState.pendingConfirm ? renderConfirmOverlay() : ""}
    ${AppState.wordVideoPlaying ? renderWordVideoOverlay() : ""}
  `;
}

function renderWordVideoOverlay() {
  const w = AppState.wordsActions.find((x) => x.id === AppState.wordVideoPlaying);
  if (!w) return "";
  return `
    <div class="modal-overlay">
      <div class="modal-card" style="padding:8px;">
        <video data-file-id="${w.videoFileId}" autoplay controls playsinline style="width:100%;border-radius:14px;"></video>
        <button class="pill-btn" style="margin-top:12px;width:100%;" data-action="closeWordVideo">Close</button>
      </div>
    </div>`;
}

/* =========================================================================
   UNLOCK / DELETE MODALS
   ========================================================================= */
function renderUnlockModal() {
  const tab = AppState.unlockAuthTab || "pin";
  const buf = AppState.unlockPinBuffer || "";
  const hasBiometric = !!AppState.security.webauthnCredentialId;
  return `
    <div class="modal-overlay">
      <div class="modal-card" style="text-align:center;">
        <h2>Parent Access</h2>
        <p>Verify to leave Child Mode.</p>
        ${AppState.unlockError ? `<div class="banner">${esc(AppState.unlockError)}</div>` : ""}
        <div class="row" style="justify-content:center;margin-bottom:14px;">
          <button class="small-btn ${tab === "pin" ? "active" : ""}" data-action="setUnlockTab" data-tab="pin">PIN</button>
          <button class="small-btn ${tab === "password" ? "active" : ""}" data-action="setUnlockTab" data-tab="password">Password</button>
          ${hasBiometric ? `<button class="small-btn ${tab === "biometric" ? "active" : ""}" data-action="setUnlockTab" data-tab="biometric">Face/Touch ID</button>` : ""}
        </div>
        ${tab === "pin" ? `
          <div class="pin-dots">${[0,1,2,3].map(i => `<div class="pin-dot ${i < buf.length ? "filled" : ""}"></div>`).join("")}</div>
          ${renderPinPad("unlockPinDigit", "unlockPinBackspace")}
        ` : ""}
        ${tab === "password" ? `
          <div class="field" style="text-align:left;"><label>Account email</label><input id="unlock-email" type="email" value="${esc(AppState.account.email || "")}" readonly /></div>
          <div class="field" style="text-align:left;"><label>Password</label><input id="unlock-password" type="password" autocomplete="current-password" /></div>
          <button class="pill-btn" style="width:100%;" data-action="unlockWithPassword">Unlock</button>
        ` : ""}
        ${tab === "biometric" ? `<button class="pill-btn" style="width:100%;" data-action="unlockWithBiometric">👆 Verify with Face/Touch ID</button>` : ""}
        <button class="pill-btn secondary" style="margin-top:16px;" data-action="closeUnlockModal">Cancel</button>
      </div>
    </div>`;
}

function renderLockReminderModal() {
  return `
    <div class="modal-overlay">
      <div class="modal-card" style="text-align:center;">
        <div style="font-size:44px;">🔒</div>
        <h2>Before you hand over the device</h2>
        <p style="color:#6b7280;font-size:14px;text-align:left;">Child Mode hides settings and traps the back button, but a swipe up to the Home Screen (or Recent Apps) happens at the operating-system level — no website can block it. For a true lock, turn on your device's own lock feature first:</p>
        <p style="font-size:14px;text-align:left;"><strong>iPad / iPhone (Guided Access):</strong> Settings → Accessibility → Guided Access → turn on. Then triple-click the side/home button once the app is open, and set a Guided Access passcode.</p>
        <p style="font-size:14px;text-align:left;"><strong>Android (Screen Pinning):</strong> Settings → Security → More security settings → App pinning → turn on. Open the app, then use Recent Apps and tap the pin icon on this app's card.</p>
        <div class="row" style="justify-content:center;margin-top:10px;">
          <button class="pill-btn secondary" data-action="cancelLockReminder">Not now</button>
          <button class="pill-btn" data-action="lockChildMode">🔒 Lock into Child Mode</button>
        </div>
      </div>
    </div>`;
}

function renderDeleteAccountModal() {
  return `
    <div class="modal-overlay">
      <div class="modal-card">
        <h2>Delete everything?</h2>
        <p>This permanently deletes the child profile, all photos, videos, recordings, communication boards and settings from this device. This cannot be undone.</p>
        <div class="field">
          <label for="delete-confirm-input">Type DELETE to confirm</label>
          <input id="delete-confirm-input" type="text" autocomplete="off" />
        </div>
        <div class="row">
          <button class="pill-btn secondary" data-action="cancelDeleteAccount">Cancel</button>
          <button class="pill-btn danger" data-action="confirmDeleteAccount">Delete everything</button>
        </div>
      </div>
    </div>`;
}

/* =========================================================================
   PARENT DASHBOARD
   ========================================================================= */
const DASH_TABS = [
  ["profile", "👤 Child Profile"],
  ["media", "📷 Photo & Video Library"],
  ["voice", "🗣️ My Voice Editor"],
  ["words", "👋 Words & Actions Editor"],
  ["audio", "🔊 Voice & Audio"],
  ["childmode", "🔒 Child Mode Settings"],
  ["layout", "🎨 Layout & Accessibility"],
  ["backup", "💾 Backup & Restore"],
  ["privacy", "🛡️ Data & Privacy"],
  ["preview", "👁️ Live Preview"],
  ["help", "❓ Help & Support"],
  ["about", "ℹ️ About"],
];

function renderParentDashboard() {
  const tab = AppState.dashTab || "profile";
  return `
    <div class="dash">
      <nav class="dash-nav">
        <h1>My Voice and Safe Space<br/><small style="font-weight:400;opacity:.7;">Parent Mode</small></h1>
        ${DASH_TABS.map(([id, label]) => `<button class="${tab === id ? "active" : ""}" data-action="setDashTab" data-tab="${id}">${label}</button>`).join("")}
        <div class="dash-nav-spacer"></div>
        <button class="pill-btn" style="margin-top:14px;" data-action="requestLockChildMode">🔒 Lock into Child Mode</button>
      </nav>
      <main class="dash-content">
        ${renderDashTab(tab)}
      </main>
    </div>`;
}

function renderDashTab(tab) {
  switch (tab) {
    case "profile": return renderTabProfile();
    case "media": return renderTabMedia();
    case "voice": return renderTabVoice();
    case "words": return renderTabWords();
    case "audio": return renderTabAudio();
    case "childmode": return renderTabChildMode();
    case "layout": return renderTabLayout();
    case "backup": return renderTabBackup();
    case "privacy": return renderTabPrivacy();
    case "preview": return renderTabPreview();
    case "help": return renderTabHelp();
    case "about": return renderTabAbout();
    default: return "";
  }
}

/* ---- Profile ---- */
function renderTabProfile() {
  return `
    <h2>Child Profile</h2>
    <div class="card">
      <div class="field">
        <label for="child-name-input">Preferred name</label>
        <input id="child-name-input" type="text" value="${esc(AppState.child.name)}" data-action-change="setChildName" />
      </div>
      <div class="field">
        <label>Profile icon</label>
        <div class="row">${PROFILE_ICONS.map(e => `<button class="icon-btn" data-action="setChildEmoji" data-val="${e}" style="${e===AppState.child.emoji ? "outline:3px solid var(--accent);":""}">${e}</button>`).join("")}</div>
      </div>
    </div>
    <div class="card">
      <h2 style="font-size:18px;margin-top:0;">Account</h2>
      <p style="color:#6b7280;font-size:14px;">Signed in as <strong>${esc(AppState.account.email || "")}</strong>. Your account and each child's board/settings sync across devices when you sign in. Photos, videos and voice recordings always stay only on the device that captured them.</p>
      <button class="pill-btn secondary" data-action="signOut">Sign out</button>
    </div>
    <div class="card">
      <h2 style="font-size:18px;margin-top:0;">Child profiles on this account</h2>
      <div class="item-list">
        ${AppState.children.map(c => `
          <div class="item-card">
            <strong>${esc(c.name)}${c.id === AppState.activeChildId ? " (current)" : ""}</strong>
            <div class="row">
              ${c.id !== AppState.activeChildId ? `<button class="small-btn" data-action="switchChild" data-id="${c.id}">Switch to this child</button>` : ""}
              ${AppState.children.length > 1 ? `<button class="small-btn danger" data-action="deleteChildProfile" data-id="${c.id}">Delete</button>` : ""}
            </div>
          </div>`).join("")}
      </div>
      <button class="pill-btn secondary" style="margin-top:12px;" data-action="pickerAddChild">➕ Add another child</button>
    </div>`;
}

/* ---- Media library ---- */
function renderTabMedia() {
  const filter = AppState.mediaFilterCat || "all";
  const items = AppState.media.filter((m) => m.childId === AppState.activeChildId && (filter === "all" || m.categoryId === filter));
  return `
    <h2>Photo & Video Library</h2>
    <div class="card">
      <div class="row">
        <label class="pill-btn">📁 Add Photo<input type="file" accept="image/*" multiple hidden data-action-file="addPhoto" /></label>
        <label class="pill-btn secondary">📸 Take Photo<input type="file" accept="image/*" capture="environment" hidden data-action-file="addPhoto" /></label>
        <label class="pill-btn">🎬 Add Video<input type="file" accept="video/*" multiple hidden data-action-file="addVideo" /></label>
        <label class="pill-btn secondary">🎥 Record Video<input type="file" accept="video/*" capture="environment" hidden data-action-file="addVideo" /></label>
      </div>
    </div>
    <div class="card">
      <h2 style="font-size:16px;margin-top:0;">Categories</h2>
      <div class="row">
        ${AppState.photoCategories.map(c => `<span class="tag" style="display:flex;align-items:center;gap:6px;">${esc(c.name)} <button class="small-btn danger" data-action="deletePhotoCategory" data-id="${c.id}">✕</button></span>`).join("")}
      </div>
      <div class="row" style="margin-top:10px;">
        <input id="new-photo-cat" type="text" placeholder="New category name" style="flex:1;padding:10px;border-radius:10px;border:2px solid #d1d5db;" />
        <button class="pill-btn secondary" data-action="addPhotoCategory">Add category</button>
      </div>
    </div>
    <div class="card">
      <div class="row">
        <label>Filter:</label>
        <select data-action-change="setMediaFilter">
          <option value="all" ${filter==="all"?"selected":""}>All</option>
          ${AppState.photoCategories.map(c => `<option value="${c.id}" ${filter===c.id?"selected":""}>${esc(c.name)}</option>`).join("")}
        </select>
      </div>
      <div class="item-list">
        ${items.map(m => `
          <div class="item-card ${m.hidden ? "hidden-item" : ""}">
            <div class="thumb">${m.type === "video" ? "🎬" : `<img data-file-id="${m.fileId}" style="width:100%;height:100%;object-fit:cover;border-radius:10px;" alt="" />`}</div>
            <input type="text" value="${esc(m.name)}" data-action-change="renameMedia" data-id="${m.id}" style="padding:6px;border-radius:8px;border:1px solid #d1d5db;" />
            <select data-action-change="setMediaCategory" data-id="${m.id}">
              <option value="" ${!m.categoryId?"selected":""}>Uncategorised</option>
              ${AppState.photoCategories.map(c => `<option value="${c.id}" ${m.categoryId===c.id?"selected":""}>${esc(c.name)}</option>`).join("")}
            </select>
            <div class="row">
              <button class="small-btn ${m.favorite?"active":""}" data-action="toggleFavoriteMedia" data-id="${m.id}">⭐ Favorite</button>
              <button class="small-btn" data-action="toggleHiddenMedia" data-id="${m.id}">${m.hidden?"Show":"Hide"}</button>
              <button class="small-btn danger" data-action="deleteMedia" data-id="${m.id}">Delete</button>
            </div>
          </div>`).join("")}
      </div>
      ${items.length === 0 ? `<div class="empty-state">No photos or videos yet. Use the buttons above to add some.</div>` : ""}
    </div>`;
}

/* ---- Voice editor ---- */
function renderTabVoice() {
  const cats = AppState.voiceCategories;
  const activeId = AppState.editingVoiceCategory || (cats[0] && cats[0].id);
  const cat = cats.find((c) => c.id === activeId);
  return `
    <h2>My Voice — Communication Board Editor</h2>
    <div class="banner">⚠️ This board is a support tool, not a replacement for professional guidance. For the best results, set it up alongside a speech and language therapist or other relevant professional who knows your child — they can help make sure the words, images and categories genuinely fit your child's needs.</div>
    <div class="card">
      <div class="row">
        ${cats.map(c => `<button class="small-btn ${c.id===activeId?"active":""}" data-action="editVoiceCategory" data-id="${c.id}" style="border-left:5px solid ${c.color};">${esc(c.name)} ${c.priority?"⭐":""}</button>`).join("")}
      </div>
      <div class="row" style="margin-top:10px;">
        <input id="new-voice-cat" type="text" placeholder="New category name" style="flex:1;padding:10px;border-radius:10px;border:2px solid #d1d5db;" />
        <button class="pill-btn secondary" data-action="addVoiceCategory">Add category</button>
      </div>
    </div>
    ${cat ? `
    <div class="card">
      <div class="row">
        <div class="field" style="flex:1;">
          <label>Category name</label>
          <input type="text" value="${esc(cat.name)}" data-action-change="renameVoiceCategory" data-cat="${cat.id}" />
        </div>
        <div class="field">
          <label>Colour</label>
          <input type="color" class="color-swatch" value="${cat.color}" data-action-change="setVoiceCategoryColor" data-cat="${cat.id}" />
        </div>
        <div class="field">
          <label>Easy-to-reach</label>
          <label class="switch"><input type="checkbox" ${cat.priority?"checked":""} data-action-change="toggleCategoryPriority" data-cat="${cat.id}" /><span class="slider"></span></label>
        </div>
        <button class="small-btn danger" data-action="deleteVoiceCategory" data-id="${cat.id}">Delete category</button>
      </div>
    </div>
    <div class="card">
      <button class="pill-btn" data-action="addVoiceButton" data-cat="${cat.id}">➕ Add button</button>
      <div class="item-list">
        ${cat.buttons.map(b => renderVoiceButtonEditor(cat, b)).join("")}
      </div>
    </div>` : `<div class="empty-state">Create a category to get started.</div>`}
  `;
}

function renderVoiceButtonEditor(cat, b) {
  const recording = ActiveRecording && ActiveRecording.catId === cat.id && ActiveRecording.btnId === b.id;
  return `
    <div class="item-card ${b.hidden ? "hidden-item" : ""}">
      <div class="thumb">${b.imageFileId ? `<img data-file-id="${b.imageFileId}" style="width:100%;height:100%;object-fit:cover;border-radius:10px;" alt="" />` : (b.emoji || "🔵")}</div>
      <div class="field"><label>Label</label><input type="text" value="${esc(b.label)}" data-action-change="editButtonField" data-cat="${cat.id}" data-btn="${b.id}" data-field="label" /></div>
      <div class="field"><label>Spoken phrase</label><input type="text" value="${esc(b.phrase)}" data-action-change="editButtonField" data-cat="${cat.id}" data-btn="${b.id}" data-field="phrase" /></div>
      <div class="field"><label>Emoji / symbol</label><input type="text" maxlength="4" value="${esc(b.emoji||"")}" data-action-change="editButtonField" data-cat="${cat.id}" data-btn="${b.id}" data-field="emoji" /></div>
      <label class="small-btn">🖼️ Upload image<input type="file" accept="image/*" hidden data-action-file="setButtonImage" data-cat="${cat.id}" data-btn="${b.id}" /></label>
      ${b.audioFileId ? `<span class="tag">Has recorded voice</span>` : ""}
      <div class="row">
        ${recording
          ? `<button class="small-btn danger" data-action="stopRecordAudio">⏹ Stop recording</button>`
          : `<button class="small-btn" data-action="startRecordAudio" data-cat="${cat.id}" data-btn="${b.id}">🎙️ Record voice</button>`}
        ${b.audioFileId ? `<button class="small-btn danger" data-action="clearButtonAudio" data-cat="${cat.id}" data-btn="${b.id}">Clear voice</button>` : ""}
      </div>
      <div class="row">
        <button class="small-btn" data-action="toggleButtonHidden" data-cat="${cat.id}" data-btn="${b.id}">${b.hidden?"Show":"Hide"}</button>
        <button class="small-btn danger" data-action="deleteButton" data-cat="${cat.id}" data-btn="${b.id}">Delete</button>
      </div>
    </div>`;
}

/* ---- Words & Actions editor ---- */
function renderTabWords() {
  const anims = ["wave","bounce","pulse","shake","spin"];
  return `
    <h2>Words & Actions Editor</h2>
    <div class="banner">⚠️ This board is a support tool, not a replacement for professional guidance. For the best results, set it up alongside a speech and language therapist or other relevant professional who knows your child — they can help make sure the words and actions genuinely fit your child's needs.</div>
    <div class="card">
      <button class="pill-btn" data-action="addWordAction">➕ Add word or action</button>
      <div class="item-list">
        ${AppState.wordsActions.map(w => `
          <div class="item-card ${w.hidden ? "hidden-item" : ""}">
            <div class="thumb">${w.imageFileId ? `<img data-file-id="${w.imageFileId}" style="width:100%;height:100%;object-fit:cover;border-radius:10px;" alt="" />` : (w.emoji||"🔵")}</div>
            <div class="field"><label>Label</label><input type="text" value="${esc(w.label)}" data-action-change="editWordField" data-id="${w.id}" data-field="label" /></div>
            <div class="field"><label>Spoken phrase</label><input type="text" value="${esc(w.phrase)}" data-action-change="editWordField" data-id="${w.id}" data-field="phrase" /></div>
            <div class="field"><label>Emoji</label><input type="text" maxlength="4" value="${esc(w.emoji||"")}" data-action-change="editWordField" data-id="${w.id}" data-field="emoji" /></div>
            <div class="field"><label>Animation</label>
              <select data-action-change="editWordField" data-id="${w.id}" data-field="anim">
                ${anims.map(a => `<option value="${a}" ${w.anim===a?"selected":""}>${a}</option>`).join("")}
              </select>
            </div>
            <label class="small-btn">🎥 Demo video<input type="file" accept="video/*" hidden data-action-file="setWordVideo" data-id="${w.id}" /></label>
            ${w.videoFileId ? `<span class="tag">Has video</span>` : ""}
            <div class="row">
              <button class="small-btn" data-action="toggleWordHidden" data-id="${w.id}">${w.hidden?"Show":"Hide"}</button>
              <button class="small-btn danger" data-action="deleteWord" data-id="${w.id}">Delete</button>
            </div>
          </div>`).join("")}
      </div>
    </div>`;
}

/* ---- Audio settings ---- */
function renderTabAudio() {
  const voices = cachedVoices;
  return `
    <h2>Voice & Audio Settings</h2>
    <div class="card">
      <div class="field">
        <label>Device voice</label>
        <select data-action-change="setVoiceName">
          <option value="">Default</option>
          ${voices.map(v => `<option value="${esc(v.name)}" ${AppState.settings.voiceName===v.name?"selected":""}>${esc(v.name)} (${esc(v.lang)})</option>`).join("")}
        </select>
      </div>
      <div class="field"><label id="voice-rate-label">Speed: ${AppState.settings.voiceRate.toFixed(2)}</label><input type="range" min="0.5" max="1.5" step="0.05" value="${AppState.settings.voiceRate}" data-action-input="setVoiceRate" /></div>
      <div class="field"><label id="voice-pitch-label">Pitch: ${AppState.settings.voicePitch.toFixed(2)}</label><input type="range" min="0.5" max="1.5" step="0.05" value="${AppState.settings.voicePitch}" data-action-input="setVoicePitch" /></div>
      <div class="field"><label id="voice-volume-label">Volume: ${Math.round(AppState.settings.voiceVolume*100)}%</label><input type="range" min="0" max="1" step="0.05" value="${AppState.settings.voiceVolume}" data-action-input="setVoiceVolume" /></div>
      <button class="pill-btn secondary" data-action="testVoice">🔊 Test voice</button>
      <div class="toggle-row"><span>Speak full phrase (off = speak just the word)</span><label class="switch"><input type="checkbox" ${AppState.settings.speakFullPhrase?"checked":""} data-action-change="toggleSetting" data-key="speakFullPhrase" /><span class="slider"></span></label></div>
    </div>`;
}

/* ---- Child mode settings ---- */
function renderTabChildMode() {
  const cfg = AppState.childModeConfig;
  return `
    <h2>Child Mode Settings</h2>
    <div class="card">
      <h2 style="font-size:16px;margin-top:0;">Change parent PIN</h2>
      <div class="row">
        <input id="pin-current" type="password" inputmode="numeric" maxlength="4" placeholder="Current PIN" style="width:120px;padding:10px;border-radius:10px;border:2px solid #d1d5db;" />
        <input id="pin-new1" type="password" inputmode="numeric" maxlength="4" placeholder="New PIN" style="width:120px;padding:10px;border-radius:10px;border:2px solid #d1d5db;" />
        <input id="pin-new2" type="password" inputmode="numeric" maxlength="4" placeholder="Confirm new PIN" style="width:120px;padding:10px;border-radius:10px;border:2px solid #d1d5db;" />
        <button class="pill-btn secondary" data-action="changePin">Update PIN</button>
      </div>
      ${AppState.pinChangeMessage ? `<div class="banner">${esc(AppState.pinChangeMessage)}</div>` : ""}
    </div>
    <div class="card">
      <h2 style="font-size:16px;margin-top:0;">Sections visible to the child</h2>
      ${["photos","voice","words"].map(s => `
        <div class="toggle-row">
          <input type="text" value="${esc(cfg.sectionLabels[s])}" data-action-change="renameSectionLabel" data-section="${s}" style="flex:1;margin-right:12px;padding:8px;border-radius:8px;border:1px solid #d1d5db;" />
          <label class="switch"><input type="checkbox" ${cfg.sectionsVisible[s]?"checked":""} data-action-change="toggleSectionVisible" data-section="${s}" /><span class="slider"></span></label>
        </div>`).join("")}
    </div>
    <div class="card">
      <div class="field">
        <label>Limit the child to one section only</label>
        <select data-action-change="setLockSingleSection">
          <option value="" ${!cfg.lockToSingleSection?"selected":""}>No limit — show Home screen</option>
          <option value="photos" ${cfg.lockToSingleSection==="photos"?"selected":""}>${esc(cfg.sectionLabels.photos)} only</option>
          <option value="voice" ${cfg.lockToSingleSection==="voice"?"selected":""}>${esc(cfg.sectionLabels.voice)} only</option>
          <option value="words" ${cfg.lockToSingleSection==="words"?"selected":""}>${esc(cfg.sectionLabels.words)} only</option>
        </select>
      </div>
      <div class="toggle-row"><span>Show a Home button while viewing photos/videos</span><label class="switch"><input type="checkbox" ${cfg.showHomeButtonInPhotos?"checked":""} data-action-change="toggleShowHomeInPhotos" /><span class="slider"></span></label></div>
    </div>
    <div class="card">
      <h2 style="font-size:16px;margin-top:0;">Face/Touch ID unlock</h2>
      <p style="color:#6b7280;font-size:14px;">Optional. Uses this device's built-in Face ID, Touch ID or fingerprint sensor as a fast way to leave Child Mode, alongside your PIN and account password.</p>
      ${AppState.security.webauthnCredentialId
        ? `<button class="small-btn danger" data-action="disableBiometric">Turn off Face/Touch ID unlock</button>`
        : `<button class="pill-btn secondary" data-action="enableBiometric">Set up Face/Touch ID unlock</button>`}
    </div>
    <div class="card">
      <h2 style="font-size:16px;margin-top:0;">Device Locking Guidance</h2>
      <div class="info-banner">A website cannot fully take over a device the way a native app can. For the strongest protection, combine Child Mode below with your device's own lock feature.</div>
      <p><strong>iPad / iPhone (Guided Access):</strong> Settings → Accessibility → Guided Access → turn on. Then triple-click the side/home button while the app is open to start it, and set a Guided Access passcode.</p>
      <p><strong>Android (Screen Pinning / App Pinning):</strong> Settings → Security → More security settings → App pinning → turn on. Open the app, then use the Recent Apps button and tap the pin icon on this app's card.</p>
      <button class="pill-btn" data-action="lockChildMode">🔒 Lock into Child Mode now</button>
    </div>`;
}

/* ---- Layout & Accessibility ---- */
function renderTabLayout() {
  const s = AppState.settings;
  return `
    <h2>Layout & Accessibility</h2>
    <div class="card">
      <div class="field"><label>Button size</label>
        <select data-action-change="setSetting" data-key="buttonSize">
          <option value="small" ${s.buttonSize==="small"?"selected":""}>Small</option>
          <option value="medium" ${s.buttonSize==="medium"?"selected":""}>Medium</option>
          <option value="large" ${s.buttonSize==="large"?"selected":""}>Large</option>
        </select>
      </div>
      <div class="field"><label>Text size</label>
        <select data-action-change="setSetting" data-key="textSize">
          <option value="small" ${s.textSize==="small"?"selected":""}>Small</option>
          <option value="medium" ${s.textSize==="medium"?"selected":""}>Medium</option>
          <option value="large" ${s.textSize==="large"?"selected":""}>Large</option>
        </select>
      </div>
      <div class="toggle-row"><span>Show text labels on buttons</span><label class="switch"><input type="checkbox" ${s.showText?"checked":""} data-action-change="toggleSetting" data-key="showText" /><span class="slider"></span></label></div>
      <div class="row">
        <div class="field"><label>Background colour</label><input type="color" class="color-swatch" value="${s.bgColor}" data-action-change="setSetting" data-key="bgColor" /></div>
        <div class="field"><label>Button colour</label><input type="color" class="color-swatch" value="${s.buttonColor}" data-action-change="setSetting" data-key="buttonColor" /></div>
        <div class="field"><label>Accent colour</label><input type="color" class="color-swatch" value="${s.accentColor}" data-action-change="setSetting" data-key="accentColor" /></div>
      </div>
    </div>
    <div class="card">
      <div class="toggle-row"><span>Briefly enlarge a button when selected</span><label class="switch"><input type="checkbox" ${s.enlargeOnSelect?"checked":""} data-action-change="toggleSetting" data-key="enlargeOnSelect" /><span class="slider"></span></label></div>
      <div class="toggle-row"><span>Vibrate on selection</span><label class="switch"><input type="checkbox" ${s.vibrate?"checked":""} data-action-change="toggleSetting" data-key="vibrate" /><span class="slider"></span></label></div>
      <div class="toggle-row"><span>Animations (Words & Actions)</span><label class="switch"><input type="checkbox" ${s.animationsEnabled?"checked":""} data-action-change="toggleSetting" data-key="animationsEnabled" /><span class="slider"></span></label></div>
      <div class="toggle-row"><span>Require confirmation before speaking</span><label class="switch"><input type="checkbox" ${s.confirmSelections?"checked":""} data-action-change="toggleSetting" data-key="confirmSelections" /><span class="slider"></span></label></div>
      <div class="field"><label id="selection-delay-label">Delay before a second selection is accepted: ${s.selectionDelayMs}ms</label><input type="range" min="0" max="2000" step="100" value="${s.selectionDelayMs}" data-action-input="setSelectionDelay" /></div>
      <div class="toggle-row"><span>Enable sentence builder in My Voice</span><label class="switch"><input type="checkbox" ${s.sentenceBuilderEnabled?"checked":""} data-action-change="toggleSetting" data-key="sentenceBuilderEnabled" /><span class="slider"></span></label></div>
    </div>
    <div class="card">
      <h2 style="font-size:16px;margin-top:0;">Video playback</h2>
      <div class="toggle-row"><span>Autoplay videos</span><label class="switch"><input type="checkbox" ${s.videoAutoplay?"checked":""} data-action-change="toggleSetting" data-key="videoAutoplay" /><span class="slider"></span></label></div>
      <div class="toggle-row"><span>Loop videos</span><label class="switch"><input type="checkbox" ${s.videoLoop?"checked":""} data-action-change="toggleSetting" data-key="videoLoop" /><span class="slider"></span></label></div>
      <div class="field"><label>Suggested max video length (seconds)</label><input type="number" min="5" max="600" value="${s.videoMaxDurationSec}" data-action-change="setSetting" data-key="videoMaxDurationSec" /></div>
    </div>
    <div class="card">
      <h2 style="font-size:16px;margin-top:0;">Background music</h2>
      <div class="info-banner">Off by default. Sound in Child Mode is meant to be led by your child's own selections — only turn this on if a quiet, constant background works well for your child. It automatically pauses to near-silent the instant anything is spoken, so it never talks over the board, and there's a one-tap mute right in Child Mode too.</div>
      <div class="toggle-row"><span>Play gentle background music in Child Mode</span><label class="switch"><input type="checkbox" ${s.backgroundMusicEnabled?"checked":""} data-action-change="toggleSetting" data-key="backgroundMusicEnabled" /><span class="slider"></span></label></div>
    </div>`;
}

/* ---- Backup ---- */
function renderTabBackup() {
  return `
    <h2>Backup & Restore</h2>
    <div class="info-banner">Everything is stored locally on this device by default. Exporting a backup creates a file only you control — nothing is uploaded automatically.</div>
    <div class="card">
      <button class="pill-btn" data-action="exportBackup">⬇️ Export backup file</button>
      <p style="color:#6b7280;font-size:14px;">Save this file somewhere safe. You can use it to restore everything on this or another device.</p>
    </div>
    <div class="card">
      <label class="pill-btn secondary">⬆️ Import backup file<input type="file" accept="application/json" hidden data-action-file="importBackup" /></label>
      <p style="color:#6b7280;font-size:14px;">Importing will replace all current content on this device.</p>
    </div>
    <div class="card">
      <button class="pill-btn secondary" data-action="printVoiceBoard">🖨️ Print a paper communication board</button>
      <p style="color:#6b7280;font-size:14px;">Creates a printable version of the My Voice board for times when the device isn't available.</p>
    </div>`;
}

/* ---- Privacy ---- */
function renderTabPrivacy() {
  return `
    <h2>Data & Privacy</h2>
    <div class="info-banner">Photos, videos and voice recordings are stored only in this browser on this device (local storage and IndexedDB) and are never uploaded. Your account email (password stored as a salted hash, never in plain text) and each child's board/settings/wording sync to a private database so you can sign in on other devices. Nothing is shown publicly, sold, or used for advertising.</div>
    <div class="card">
      <div class="toggle-row"><span>Keep a private history of selections made in Child Mode</span><label class="switch"><input type="checkbox" ${AppState.usageHistoryEnabled?"checked":""} data-action-change="toggleSetting" data-key="usageHistoryEnabled" /><span class="slider"></span></label></div>
      ${AppState.usageHistoryEnabled ? `
        <button class="small-btn danger" data-action="clearUsageHistory">Clear history</button>
        <div class="item-list">
          ${AppState.usageHistory.slice(0,30).map(h => `<div class="item-card"><span class="tag">${esc(h.section)}</span>${esc(h.label)}<small style="color:#9ca3af;">${new Date(h.ts).toLocaleString()}</small></div>`).join("")}
        </div>
      ` : ""}
    </div>
    <div class="card">
      <h2 style="font-size:16px;margin-top:0;color:#b91c1c;">Delete everything</h2>
      <p>Permanently remove the child profile, all media, recordings, communication boards and settings from this device.</p>
      <button class="pill-btn danger" data-action="openDeleteAccount">Delete entire account & all data</button>
    </div>`;
}

/* ---- Preview ---- */
function renderTabPreview() {
  return `
    <h2>Live Preview</h2>
    <p style="color:#6b7280;">This shows exactly what your child will see. Tap around freely — nothing here is locked.</p>
    <div class="preview-frame"><div class="preview-inner">${renderChildMode(true)}</div></div>`;
}

/* ---- Help ---- */
function renderTabHelp() {
  return `
    <h2>Help & Support</h2>
    <div class="card">
      <h2 style="font-size:16px;margin-top:0;">How it works</h2>
      <p style="color:#6b7280;font-size:14px;">A short intro video plays the first time this app is opened on a device. You can watch it again any time.</p>
      <button class="pill-btn secondary" data-action="watchIntroAgain">▶ Watch the intro video again</button>
    </div>
    <div class="card">
      <h2 style="font-size:16px;">Getting started</h2>
      <p>1. Add favourite photos and short videos in the <strong>Photo & Video Library</strong>.</p>
      <p>2. Personalise buttons in <strong>My Voice Editor</strong> and <strong>Words & Actions Editor</strong> — add real photos, record your own voice, and edit the wording.</p>
      <p>3. Check <strong>Layout & Accessibility</strong> and <strong>Child Mode Settings</strong> to match your child's needs.</p>
      <p>4. Use <strong>Live Preview</strong> to see exactly what your child will experience.</p>
      <p>5. Tap <strong>Lock into Child Mode</strong> to hand the device to your child. To get back, tap the small lock icon in the bottom-right corner <strong>five times in a row</strong>, then verify with your PIN, your account password, or Face/Touch ID.</p>
    </div>
    <div class="card">
      <h2 style="font-size:16px;">Forgotten PIN?</h2>
      <p>Use the "Password" tab on the Parent Access screen to unlock with your account email and password instead. You can then set a new PIN from Child Mode Settings.</p>
    </div>`;
}

function renderTabAbout() {
  return `
    <h2>About</h2>
    <div class="card">
      <p><strong>My Voice and Safe Space</strong> helps people with communication difficulties — including non-speaking and minimally-verbal children, and anyone who communicates better with pictures and voice than with typing or speech — be heard, in a space a parent or carer has built to keep them safe.</p>
      <p>It is an assistive communication aid and personal support tool. It is not a medical device, does not diagnose or infer emotions, and does not replace professional advice or an individually assessed communication system from a speech and language professional.</p>
      <p>It is not officially affiliated with PECS (Picture Exchange Communication System) or any other proprietary communication approach. It is designed to sit alongside a child's existing, individually assessed communication system where one is in place.</p>
      <p>Version 1.0 (MVP)</p>
    </div>`;
}

/* =========================================================================
   ACTIONS
   ========================================================================= */
const Actions = {
  /* Account auth */
  authSwitchMode(el) {
    AppState.authMode = el.dataset.mode;
    AppState.authError = "";
    render();
  },
  async authSubmit() {
    const email = document.getElementById("auth-email").value.trim();
    const password = document.getElementById("auth-password").value;
    AppState.authEmail = email;
    if (!email || !password) {
      AppState.authError = "Please fill in both fields.";
      render();
      return;
    }
    AppState.authBusy = true;
    AppState.authError = "";
    render();
    try {
      const isRegister = (AppState.authMode || "login") === "register";
      const fn = isRegister ? apiRegister : apiLogin;
      const result = await fn(email, password);
      if (isRegister || (AppState.account.email && AppState.account.email !== result.parent.email)) {
        // A brand-new account can't have any children yet, and switching to a
        // different account on this device must never inherit whatever child
        // was cached locally (including if the next network call fails) —
        // this is what was letting people land straight in Child Mode right
        // after creating an account, instead of the create-profile screen.
        AppState.activeChildId = null;
        AppState.children = [];
        resetProfileFieldsForNewChild();
      }
      AppState.account = { token: result.token, email: result.parent.email };
      AppState.authBusy = false;
      await bootAfterAuth();
    } catch (e) {
      AppState.authBusy = false;
      AppState.authError = e.offline ? "You appear to be offline. Please connect to the internet to sign in." : e.message;
      render();
    }
  },

  /* Child picker */
  pickerSelectChild(el) {
    const child = AppState.children.find((c) => c.id === el.dataset.id);
    if (!child) return;
    loadChildIntoProfile(child);
    AppState.mode = "child";
    AppState.childView = AppState.childModeConfig.lockToSingleSection || "home";
    saveState();
    render();
  },
  pickerAddChild() {
    resetProfileFieldsForNewChild();
    AppState.activeChildId = null;
    AppState.mode = "onboard-child";
    AppState.onboardingStep = 2;
    render();
  },
  async signOut() {
    if (!confirm("Sign out of this account on this device? Locally added photos/videos stay on this device, but you'll need to sign in again to reach any child's board.")) return;
    await flushProfilePush();
    AppState.account = { token: null, email: null };
    AppState.children = [];
    AppState.activeChildId = null;
    resetProfileFieldsForNewChild();
    AppState.mode = "auth";
    saveState();
    render();
  },
  async switchChild(el) {
    await flushProfilePush();
    const child = AppState.children.find((c) => c.id === el.dataset.id);
    if (!child) return;
    loadChildIntoProfile(child);
    AppState.dashTab = "profile";
    persistAndRender();
  },
  async deleteChildProfile(el) {
    if (!confirm("Delete this child's profile and board? This cannot be undone. Photos/videos already on this device are not automatically deleted.")) return;
    try {
      await apiDeleteChild(el.dataset.id);
      AppState.media = AppState.media.filter((m) => m.childId !== el.dataset.id);
      AppState.children = AppState.children.filter((c) => c.id !== el.dataset.id);
      if (AppState.activeChildId === el.dataset.id) {
        AppState.activeChildId = null;
        if (AppState.children.length) {
          loadChildIntoProfile(AppState.children[0]);
        } else {
          resetProfileFieldsForNewChild();
          AppState.mode = "onboard-child";
          AppState.onboardingStep = 2;
        }
      }
      persistAndRender();
    } catch (e) {
      alert(e.message || "Could not delete this child profile.");
    }
  },

  /* Onboarding (create a child profile) */
  onboardEmoji(el) {
    const nameInput = document.getElementById("ob-name");
    if (nameInput) AppState.child.name = nameInput.value;
    AppState.child.emoji = el.dataset.val;
    render();
  },
  onboardSaveName() {
    const val = document.getElementById("ob-name").value.trim();
    AppState.child.name = val;
    AppState.onboardingStep = 3;
    AppState.onboardingPinStage = "enter";
    AppState.onboardingPinBuffer = "";
    render();
  },
  async onboardPinDigit(el) {
    const buf = (AppState.onboardingPinBuffer || "") + el.dataset.val;
    if (buf.length > 4) return;
    AppState.onboardingPinBuffer = buf;
    AppState.onboardingPinError = "";
    if (buf.length === 4) {
      if (AppState.onboardingPinStage === "enter") {
        AppState.onboardingPinFirst = buf;
        AppState.onboardingPinStage = "confirm";
        AppState.onboardingPinBuffer = "";
      } else {
        if (buf === AppState.onboardingPinFirst) {
          await setPin(buf);
          try {
            const child = await apiCreateChild(AppState.child.name || "My child", buildProfileSnapshot());
            AppState.children.push(child);
            AppState.activeChildId = child.id;
            // Land in the Parent dashboard right after creating a profile —
            // there's setup (photos, board, PIN confirmation) a parent will
            // want to do before handing the device over. Child Mode only
            // becomes the default on the *next* sign-in (see bootAfterAuth).
            AppState.mode = "parent";
            AppState.dashTab = "profile";
            saveState();
          } catch (e) {
            AppState.onboardingPinError = e.offline
              ? "You appear to be offline — connect to the internet to finish setup."
              : e.message || "Could not save the child profile. Please try again.";
            AppState.onboardingPinStage = "enter";
            AppState.onboardingPinBuffer = "";
            render();
            return;
          }
        } else {
          AppState.onboardingPinError = "PINs did not match. Please try again.";
          AppState.onboardingPinStage = "enter";
          AppState.onboardingPinBuffer = "";
        }
      }
    }
    render();
  },
  onboardPinBackspace() {
    AppState.onboardingPinBuffer = (AppState.onboardingPinBuffer || "").slice(0, -1);
    render();
  },

  /* Mode switching */
  requestLockChildMode() {
    AppState.showLockReminder = true;
    render();
  },
  cancelLockReminder() {
    AppState.showLockReminder = false;
    render();
  },
  lockChildMode() {
    AppState.showLockReminder = false;
    AppState.mode = "child";
    AppState.childView = "home";
    AppState.sentenceStrip = [];
    AppState.hasLockedChildMode = true;
    schedulePushProfile();
    saveState();
    render();
    try {
      history.pushState({ mvss: true }, "", location.href);
      if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(() => {});
    } catch (e) {}
  },
  parentAccessTap() {
    const now = Date.now();
    parentAccessTapTimes = parentAccessTapTimes.filter((t) => now - t < 2000);
    parentAccessTapTimes.push(now);
    if (parentAccessTapTimes.length >= 5) {
      parentAccessTapTimes = [];
      AppState.showUnlockModal = true;
      AppState.unlockAuthTab = "pin";
      AppState.unlockPinBuffer = "";
      AppState.unlockError = "";
      render();
    }
  },
  toggleMusicNow() {
    AppState.settings.backgroundMusicEnabled = false;
    persistAndRender();
  },
  closeUnlockModal() { AppState.showUnlockModal = false; render(); },
  setUnlockTab(el) { AppState.unlockAuthTab = el.dataset.tab; AppState.unlockError = ""; render(); },
  async unlockWithPassword() {
    const password = document.getElementById("unlock-password").value;
    if (!password) return;
    try {
      const result = await apiLogin(AppState.account.email, password);
      AppState.account.token = result.token;
      AppState.mode = "parent";
      AppState.showUnlockModal = false;
      if (document.exitFullscreen && document.fullscreenElement) document.exitFullscreen().catch(() => {});
      persistAndRender();
    } catch (e) {
      AppState.unlockError = e.offline ? "You appear to be offline." : e.message || "Incorrect password.";
      render();
    }
  },
  async unlockWithBiometric() {
    try {
      await verifyBiometricCredential(AppState.security.webauthnCredentialId);
      AppState.mode = "parent";
      AppState.showUnlockModal = false;
      if (document.exitFullscreen && document.fullscreenElement) document.exitFullscreen().catch(() => {});
      persistAndRender();
    } catch (e) {
      AppState.unlockError = "Could not verify with Face/Touch ID.";
      render();
    }
  },
  async enableBiometric() {
    try {
      const credId = await enrollBiometricCredential();
      AppState.security.webauthnCredentialId = credId;
      persistAndRender();
    } catch (e) {
      alert(e.message || "Could not set up Face/Touch ID unlock.");
    }
  },
  disableBiometric() { AppState.security.webauthnCredentialId = null; persistAndRender(); },
  async unlockPinDigit(el) {
    const buf = (AppState.unlockPinBuffer || "") + el.dataset.val;
    AppState.unlockPinBuffer = buf;
    AppState.unlockError = "";
    if (buf.length >= 4) {
      const ok = await verifyPin(buf);
      if (ok) {
        pinFailCount = 0;
        AppState.mode = "parent";
        AppState.showUnlockModal = false;
        AppState.unlockPinBuffer = "";
        if (document.exitFullscreen && document.fullscreenElement) document.exitFullscreen().catch(() => {});
        saveState();
      } else {
        pinFailCount++;
        AppState.unlockError = "Incorrect PIN. Please try again.";
        AppState.unlockPinBuffer = "";
      }
    }
    render();
  },
  unlockPinBackspace() {
    AppState.unlockPinBuffer = (AppState.unlockPinBuffer || "").slice(0, -1);
    render();
  },

  /* Child navigation */
  childHome() { AppState.childView = "home"; AppState.sentenceStrip = []; render(); },
  childOpenSection(el) { AppState.childView = el.dataset.section; render(); },
  childPhotoCategory(el) { AppState.childPhotoCategory = el.dataset.cat; render(); },
  childOpenPhoto(el) {
    const list = currentPhotoList();
    const idx = list.findIndex((m) => m.id === el.dataset.id);
    AppState.childPhotoIndex = idx < 0 ? 0 : idx;
    AppState.childView = "photo-viewer";
    logUsage("photos", (list[idx] || {}).name || "");
    render();
  },
  childPhotoBackToGrid() { AppState.childView = "photos"; render(); },
  childPhotoNav(el) { navigatePhotoBy(parseInt(el.dataset.dir, 10)); },
  childVoiceCategory(el) { AppState.voiceCategory = el.dataset.cat; render(); },

  tapVoiceButton(el) {
    const now = Date.now();
    if (now - lastSelectionTs < AppState.settings.selectionDelayMs) return;
    lastSelectionTs = now;
    const catId = el.dataset.cat, btnId = el.dataset.btn;
    if (AppState.settings.enlargeOnSelect) {
      el.classList.add("pressed");
      setTimeout(() => el.classList.remove("pressed"), 220);
    }
    if (AppState.settings.vibrate && navigator.vibrate) navigator.vibrate(50);
    if (AppState.settings.confirmSelections) {
      AppState.pendingConfirm = { type: "voice", catId, btnId };
      render();
      return;
    }
    doVoiceSelection(catId, btnId);
  },
  cancelConfirm() { AppState.pendingConfirm = null; render(); },
  confirmSelection() {
    const pc = AppState.pendingConfirm;
    AppState.pendingConfirm = null;
    if (!pc) { render(); return; }
    if (pc.type === "voice") doVoiceSelection(pc.catId, pc.btnId);
    else if (pc.type === "words") doWordSelection(pc.id);
  },
  sentenceSpeak() {
    const text = AppState.sentenceStrip.map((s) => s.phrase || s.label).join(" ");
    speakText(text);
  },
  sentenceClear() { AppState.sentenceStrip = []; render(); },
  sentenceUndo() { AppState.sentenceStrip.pop(); render(); },

  tapWordAction(el) {
    const now = Date.now();
    if (now - lastSelectionTs < AppState.settings.selectionDelayMs) return;
    lastSelectionTs = now;
    const id = el.dataset.id;
    if (AppState.settings.vibrate && navigator.vibrate) navigator.vibrate(50);
    if (AppState.settings.animationsEnabled) {
      const w = AppState.wordsActions.find((x) => x.id === id);
      if (w) el.classList.add("anim-" + w.anim);
      setTimeout(() => el.classList.remove("anim-" + ((w||{}).anim||"")), 900);
    }
    if (AppState.settings.confirmSelections) {
      AppState.pendingConfirm = { type: "words", id };
      render();
      return;
    }
    doWordSelection(id);
  },
  closeWordVideo() { AppState.wordVideoPlaying = null; render(); },

  /* Parent dashboard nav */
  setDashTab(el) { AppState.dashTab = el.dataset.tab; render(); },

  /* Profile */
  setChildEmoji(el) { AppState.child.emoji = el.dataset.val; persistAndRender(); },

  /* Photo categories */
  addPhotoCategory() {
    const input = document.getElementById("new-photo-cat");
    const name = input.value.trim();
    if (!name) return;
    AppState.photoCategories.push({ id: mvssUid("cat"), name });
    persistAndRender();
  },
  deletePhotoCategory(el) {
    if (!confirm("Delete this category? Items in it will become Uncategorised.")) return;
    AppState.photoCategories = AppState.photoCategories.filter((c) => c.id !== el.dataset.id);
    AppState.media.forEach((m) => { if (m.categoryId === el.dataset.id) m.categoryId = null; });
    persistAndRender();
  },
  toggleFavoriteMedia(el) {
    const m = AppState.media.find((x) => x.id === el.dataset.id);
    if (m) m.favorite = !m.favorite;
    persistAndRender();
  },
  toggleHiddenMedia(el) {
    const m = AppState.media.find((x) => x.id === el.dataset.id);
    if (m) m.hidden = !m.hidden;
    persistAndRender();
  },
  async deleteMedia(el) {
    if (!confirm("Delete this item permanently?")) return;
    const m = AppState.media.find((x) => x.id === el.dataset.id);
    if (m) { await idbDelete(m.fileId); idbForgetObjectUrl(m.fileId); }
    AppState.media = AppState.media.filter((x) => x.id !== el.dataset.id);
    persistAndRender();
  },

  /* Voice editor */
  addVoiceCategory() {
    const input = document.getElementById("new-voice-cat");
    const name = input.value.trim();
    if (!name) return;
    const cat = { id: mvssUid("cat"), name, color: "#3b82f6", priority: false, buttons: [] };
    AppState.voiceCategories.push(cat);
    AppState.editingVoiceCategory = cat.id;
    persistAndRender();
  },
  editVoiceCategory(el) { AppState.editingVoiceCategory = el.dataset.id; render(); },
  deleteVoiceCategory(el) {
    if (!confirm("Delete this whole category and its buttons?")) return;
    AppState.voiceCategories = AppState.voiceCategories.filter((c) => c.id !== el.dataset.id);
    AppState.editingVoiceCategory = null;
    persistAndRender();
  },
  addVoiceButton(el) {
    const cat = AppState.voiceCategories.find((c) => c.id === el.dataset.cat);
    if (!cat) return;
    cat.buttons.push(mvssButton("New button", "New button.", "🔵"));
    persistAndRender();
  },
  deleteButton(el) {
    const cat = AppState.voiceCategories.find((c) => c.id === el.dataset.cat);
    if (!cat) return;
    if (!confirm("Delete this button?")) return;
    cat.buttons = cat.buttons.filter((b) => b.id !== el.dataset.btn);
    persistAndRender();
  },
  toggleButtonHidden(el) {
    const cat = AppState.voiceCategories.find((c) => c.id === el.dataset.cat);
    const b = cat && cat.buttons.find((x) => x.id === el.dataset.btn);
    if (b) b.hidden = !b.hidden;
    persistAndRender();
  },
  async startRecordAudio(el) {
    const catId = el.dataset.cat, btnId = el.dataset.btn;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      alert("Microphone recording is not available in this browser.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      const chunks = [];
      recorder.ondataavailable = (e) => chunks.push(e.data);
      recorder.onstop = async () => {
        const blob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
        const fileId = mvssUid("audio");
        await idbPut(fileId, blob);
        stream.getTracks().forEach((t) => t.stop());
        const cat = AppState.voiceCategories.find((c) => c.id === catId);
        const b = cat && cat.buttons.find((x) => x.id === btnId);
        if (b) b.audioFileId = fileId;
        ActiveRecording = null;
        persistAndRender();
      };
      recorder.start();
      ActiveRecording = { recorder, catId, btnId };
      render();
    } catch (e) {
      alert("Could not access the microphone. Please allow microphone permission and try again.");
    }
  },
  stopRecordAudio() {
    if (ActiveRecording) ActiveRecording.recorder.stop();
  },
  async clearButtonAudio(el) {
    const cat = AppState.voiceCategories.find((c) => c.id === el.dataset.cat);
    const b = cat && cat.buttons.find((x) => x.id === el.dataset.btn);
    if (b && b.audioFileId) { await idbDelete(b.audioFileId); idbForgetObjectUrl(b.audioFileId); b.audioFileId = null; }
    persistAndRender();
  },

  /* Words editor */
  addWordAction() {
    AppState.wordsActions.push(mvssButton("New word", "New word.", "🔵", { anim: "pulse" }));
    persistAndRender();
  },
  deleteWord(el) {
    if (!confirm("Delete this word/action?")) return;
    AppState.wordsActions = AppState.wordsActions.filter((w) => w.id !== el.dataset.id);
    persistAndRender();
  },
  toggleWordHidden(el) {
    const w = AppState.wordsActions.find((x) => x.id === el.dataset.id);
    if (w) w.hidden = !w.hidden;
    persistAndRender();
  },

  /* Audio settings */
  testVoice() { speakText("Hello! This is how my voice sounds."); },

  /* Intro video */
  introFinish() {
    AppState.introSeen = true;
    saveState();
    boot();
  },
  watchIntroAgain() { AppState.showIntroReplay = true; render(); },
  closeIntroReplay() { AppState.showIntroReplay = false; render(); },

  /* Child mode settings */
  async changePin() {
    const cur = document.getElementById("pin-current").value;
    const n1 = document.getElementById("pin-new1").value;
    const n2 = document.getElementById("pin-new2").value;
    if (!/^\d{4}$/.test(n1) || n1 !== n2) {
      AppState.pinChangeMessage = "New PIN must be 4 digits and match in both boxes.";
      render();
      return;
    }
    const ok = await verifyPin(cur);
    if (!ok) {
      AppState.pinChangeMessage = "Current PIN is incorrect.";
      render();
      return;
    }
    await setPin(n1);
    AppState.pinChangeMessage = "PIN updated.";
    persistAndRender();
  },

  /* Privacy / backup */
  clearUsageHistory() { AppState.usageHistory = []; persistAndRender(); },
  openDeleteAccount() { AppState.showDeleteAccountModal = true; render(); },
  cancelDeleteAccount() { AppState.showDeleteAccountModal = false; render(); },
  async confirmDeleteAccount() {
    const input = document.getElementById("delete-confirm-input");
    if (!input || input.value !== "DELETE") {
      alert('Please type DELETE exactly to confirm.');
      return;
    }
    try {
      if (AppState.account.token) await apiDeleteAccount();
    } catch (e) {
      console.error("Server-side account deletion failed", e);
    }
    await idbClearAll();
    localStorage.removeItem(MVSS_STATE_KEY);
    location.reload();
  },
  exportBackup() { exportBackupFile(); },
  printVoiceBoard() { printVoiceBoard(); },
};

async function doVoiceSelection(catId, btnId) {
  const cat = AppState.voiceCategories.find((c) => c.id === catId);
  const btn = cat && cat.buttons.find((b) => b.id === btnId);
  if (!btn) return;
  await speakButton(btn);
  logUsage("voice", btn.label);
  if (AppState.settings.sentenceBuilderEnabled) {
    AppState.sentenceStrip.push({ label: btn.label, phrase: btn.phrase, emoji: btn.emoji });
  }
  render();
}

async function doWordSelection(id) {
  const w = AppState.wordsActions.find((x) => x.id === id);
  if (!w) return;
  await speakButton(w);
  logUsage("words", w.label);
  if (w.videoFileId) {
    AppState.wordVideoPlaying = w.id;
  }
  render();
}

/* ---- Change-event and input-event and file-input actions (generic, data-driven) ---- */
const ChangeActions = {
  setChildName(el) { AppState.child.name = el.value.trim(); saveState(); },
  setMediaFilter(el) { AppState.mediaFilterCat = el.value; render(); },
  renameMedia(el) {
    const m = AppState.media.find((x) => x.id === el.dataset.id);
    if (m) m.name = el.value.trim() || m.name;
    saveState();
  },
  setMediaCategory(el) {
    const m = AppState.media.find((x) => x.id === el.dataset.id);
    if (m) m.categoryId = el.value || null;
    persistAndRender();
  },
  renameVoiceCategory(el) {
    const cat = AppState.voiceCategories.find((c) => c.id === el.dataset.cat);
    if (cat) cat.name = el.value.trim() || cat.name;
    saveState();
  },
  setVoiceCategoryColor(el) {
    const cat = AppState.voiceCategories.find((c) => c.id === el.dataset.cat);
    if (cat) cat.color = el.value;
    persistAndRender();
  },
  toggleCategoryPriority(el) {
    const cat = AppState.voiceCategories.find((c) => c.id === el.dataset.cat);
    if (cat) cat.priority = el.checked;
    persistAndRender();
  },
  editButtonField(el) {
    const cat = AppState.voiceCategories.find((c) => c.id === el.dataset.cat);
    const b = cat && cat.buttons.find((x) => x.id === el.dataset.btn);
    if (b) b[el.dataset.field] = el.value;
    saveState();
  },
  editWordField(el) {
    const w = AppState.wordsActions.find((x) => x.id === el.dataset.id);
    if (w) w[el.dataset.field] = el.value;
    if (el.dataset.field === "anim") { persistAndRender(); } else { saveState(); }
  },
  setVoiceName(el) { AppState.settings.voiceName = el.value || null; persistAndRender(); },
  setSetting(el) {
    const key = el.dataset.key;
    let val = el.value;
    if (el.type === "number") val = Number(val);
    AppState.settings[key] = val;
    persistAndRender();
  },
  toggleSetting(el) {
    const key = el.dataset.key;
    if (key === "usageHistoryEnabled") {
      AppState.usageHistoryEnabled = el.checked;
    } else {
      AppState.settings[key] = el.checked;
    }
    persistAndRender();
  },
  toggleSectionVisible(el) {
    AppState.childModeConfig.sectionsVisible[el.dataset.section] = el.checked;
    persistAndRender();
  },
  renameSectionLabel(el) {
    AppState.childModeConfig.sectionLabels[el.dataset.section] = el.value.trim() || el.dataset.section;
    saveState();
  },
  setLockSingleSection(el) {
    AppState.childModeConfig.lockToSingleSection = el.value || null;
    persistAndRender();
  },
  toggleShowHomeInPhotos(el) {
    AppState.childModeConfig.showHomeButtonInPhotos = el.checked;
    persistAndRender();
  },
};

const InputActions = {
  setVoiceRate(el) {
    AppState.settings.voiceRate = Number(el.value);
    saveState();
    const label = document.getElementById("voice-rate-label");
    if (label) label.textContent = "Speed: " + AppState.settings.voiceRate.toFixed(2);
  },
  setVoicePitch(el) {
    AppState.settings.voicePitch = Number(el.value);
    saveState();
    const label = document.getElementById("voice-pitch-label");
    if (label) label.textContent = "Pitch: " + AppState.settings.voicePitch.toFixed(2);
  },
  setVoiceVolume(el) {
    AppState.settings.voiceVolume = Number(el.value);
    saveState();
    const label = document.getElementById("voice-volume-label");
    if (label) label.textContent = "Volume: " + Math.round(AppState.settings.voiceVolume * 100) + "%";
  },
  setSelectionDelay(el) {
    AppState.settings.selectionDelayMs = Number(el.value);
    saveState();
    const label = document.getElementById("selection-delay-label");
    if (label) label.textContent = "Delay before a second selection is accepted: " + AppState.settings.selectionDelayMs + "ms";
  },
};

const FileActions = {
  async addPhoto(el) { await addMediaFiles("photo", el.files); },
  async addVideo(el) { await addMediaFiles("video", el.files); },
  async setButtonImage(el) {
    const file = el.files[0];
    if (!file) return;
    const fileId = mvssUid("img");
    await idbPut(fileId, file);
    const cat = AppState.voiceCategories.find((c) => c.id === el.dataset.cat);
    const b = cat && cat.buttons.find((x) => x.id === el.dataset.btn);
    if (b) b.imageFileId = fileId;
    persistAndRender();
  },
  async setWordVideo(el) {
    const file = el.files[0];
    if (!file) return;
    const fileId = mvssUid("vid");
    await idbPut(fileId, file);
    const w = AppState.wordsActions.find((x) => x.id === el.dataset.id);
    if (w) w.videoFileId = fileId;
    persistAndRender();
  },
  async importBackup(el) {
    const file = el.files[0];
    if (!file) return;
    if (!confirm("Importing will replace this child's board, settings and local photos/videos on this device. Continue?")) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      await idbClearAll();
      for (const [id, base64] of Object.entries(data.files || {})) {
        const blob = base64ToBlob(base64);
        await idbPut(id, blob);
      }
      const fresh = defaultState();
      const importedState = data.state || {};
      PROFILE_KEYS.forEach((k) => { AppState[k] = importedState[k] !== undefined ? importedState[k] : fresh[k]; });
      AppState.media = (Array.isArray(importedState.media) ? importedState.media : []).map((m) => Object.assign({}, m, { childId: AppState.activeChildId }));
      AppState.dashTab = "profile";
      persistAndRender();
      alert("Backup restored.");
    } catch (e) {
      console.error(e);
      alert("This backup file could not be read.");
    }
  },
};

async function addMediaFiles(type, fileList) {
  const filterCat = AppState.mediaFilterCat && AppState.mediaFilterCat !== "all" ? AppState.mediaFilterCat : null;
  for (const file of Array.from(fileList)) {
    const fileId = mvssUid(type);
    await idbPut(fileId, file);
    AppState.media.push({
      id: mvssUid("media"),
      type,
      name: file.name.replace(/\.[^.]+$/, "") || (type === "photo" ? "New Photo" : "New Video"),
      categoryId: filterCat,
      childId: AppState.activeChildId,
      fileId,
      favorite: false,
      hidden: false,
    });
  }
  persistAndRender();
}

/* =========================================================================
   BACKUP EXPORT / PRINT
   ========================================================================= */
function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
function base64ToBlob(dataUrl) {
  const [meta, b64] = dataUrl.split(",");
  const mime = (meta.match(/data:(.*);base64/) || [, "application/octet-stream"])[1];
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

async function exportBackupFile() {
  const fileIds = new Set();
  AppState.media.forEach((m) => m.fileId && fileIds.add(m.fileId));
  AppState.voiceCategories.forEach((c) => c.buttons.forEach((b) => {
    if (b.imageFileId) fileIds.add(b.imageFileId);
    if (b.audioFileId) fileIds.add(b.audioFileId);
  }));
  AppState.wordsActions.forEach((w) => {
    if (w.imageFileId) fileIds.add(w.imageFileId);
    if (w.videoFileId) fileIds.add(w.videoFileId);
  });
  const files = {};
  for (const id of fileIds) {
    const blob = await idbGet(id);
    if (blob) files[id] = await blobToBase64(blob);
  }
  const exportState = {};
  PROFILE_KEYS.forEach((k) => (exportState[k] = AppState[k]));
  exportState.media = AppState.media.filter((m) => m.childId === AppState.activeChildId);
  const payload = { exportedAt: new Date().toISOString(), state: exportState, files };
  const blob = new Blob([JSON.stringify(payload)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `my-voice-safe-space-backup-${new Date().toISOString().slice(0,10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function printVoiceBoard() {
  const w = window.open("", "_blank");
  if (!w) { alert("Please allow pop-ups to print the board."); return; }
  const catsHtml = AppState.voiceCategories.map((cat) => `
    <h2>${esc(cat.name)}</h2>
    <div class="pgrid">
      ${cat.buttons.filter(b=>!b.hidden).map(b => `<div class="pcell"><div class="pe">${esc(b.emoji||"")}</div><div>${esc(b.label)}</div></div>`).join("")}
    </div>`).join("");
  w.document.write(`
    <html><head><title>My Voice — Printable Board</title>
    <style>
      body{font-family:sans-serif;padding:20px;}
      .pgrid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:24px;}
      .pcell{border:2px solid #333;border-radius:10px;padding:14px;text-align:center;}
      .pe{font-size:36px;}
    </style></head><body>
    <h1>My Voice — ${esc(AppState.child.name || "")}</h1>
    ${catsHtml}
    </body></html>`);
  w.document.close();
  setTimeout(() => w.print(), 300);
}

/* =========================================================================
   EVENT DELEGATION
   ========================================================================= */
// Some touchscreen laptops fail to fire a synthetic "click" for a real
// physical mouse click near the edge of the screen (a known Chromium/Windows
// quirk on hybrid touch+mouse devices — reported for the PIN pad). Handling
// "pointerup" as a fallback, deduped against a click landing on the same
// element shortly after, makes every data-action button work reliably
// whichever event the browser actually delivers.
let pendingPointerAction = null;
function dispatchDataAction(el, e) {
  if (el && Actions[el.dataset.action]) {
    Actions[el.dataset.action](el, e);
  }
}
document.addEventListener("click", (e) => {
  const el = e.target.closest("[data-action]");
  if (!el) return;
  pendingPointerAction = null;
  dispatchDataAction(el, e);
});
document.addEventListener("pointerup", (e) => {
  const el = e.target.closest("[data-action]");
  if (!el) return;
  pendingPointerAction = el;
  setTimeout(() => {
    if (pendingPointerAction === el) {
      pendingPointerAction = null;
      dispatchDataAction(el, e);
    }
  }, 250);
});
document.addEventListener("change", (e) => {
  const el = e.target.closest("[data-action-change]");
  if (el && ChangeActions[el.dataset.actionChange]) {
    ChangeActions[el.dataset.actionChange](el, e);
  }
  const fileEl = e.target.closest("[data-action-file]");
  if (fileEl && FileActions[fileEl.dataset.actionFile]) {
    FileActions[fileEl.dataset.actionFile](fileEl, e);
  }
});
document.addEventListener("input", (e) => {
  const el = e.target.closest("[data-action-input]");
  if (el && InputActions[el.dataset.actionInput]) {
    InputActions[el.dataset.actionInput](el, e);
  }
});

// Seamless swipe through the photo/video viewer: the photo tracks your
// finger in real time as you drag (touchmove), then either completes the
// swipe with a matching slide-out/slide-in or snaps back if the drag
// didn't go far enough. Dragging right moves the photo right, revealing
// the previous item from the left — dragging left moves it left, revealing
// the next item from the right. The Previous/Next buttons stay too, as a
// no-gesture-required alternative (some children can't reliably swipe).
const SWIPE_THRESHOLD_PX = 50;
let photoSwipe = null; // { x, y, container, mediaEl, dragging }
document.addEventListener("touchstart", (e) => {
  const container = e.target.closest(".viewer-media");
  if (!container || e.touches.length !== 1) { photoSwipe = null; return; }
  const mediaEl = container.querySelector("img, video");
  photoSwipe = { x: e.touches[0].clientX, y: e.touches[0].clientY, container, mediaEl, dragging: false };
}, { passive: true });
document.addEventListener("touchmove", (e) => {
  if (!photoSwipe || !photoSwipe.mediaEl) return;
  const t = e.touches[0];
  const dx = t.clientX - photoSwipe.x;
  const dy = t.clientY - photoSwipe.y;
  if (!photoSwipe.dragging) {
    if (Math.abs(dx) < 6 || Math.abs(dx) < Math.abs(dy)) return;
    photoSwipe.dragging = true;
    photoSwipe.container.classList.add("dragging");
  }
  photoSwipe.mediaEl.style.transform = `translateX(${dx}px)`;
  photoSwipe.mediaEl.style.opacity = String(Math.max(1 - Math.abs(dx) / 400, 0.4));
}, { passive: true });
document.addEventListener("touchend", (e) => {
  if (!photoSwipe) return;
  const { mediaEl, container, x, dragging } = photoSwipe;
  photoSwipe = null;
  if (!mediaEl || !dragging) return;
  container.classList.remove("dragging");
  const t = e.changedTouches[0];
  const dx = t.clientX - x;
  const dir = dx > 0 ? -1 : 1;
  const list = currentPhotoList();
  const canMove = AppState.childPhotoIndex + dir >= 0 && AppState.childPhotoIndex + dir < list.length;
  mediaEl.style.transition = "transform 0.18s ease, opacity 0.18s ease";
  if (Math.abs(dx) >= SWIPE_THRESHOLD_PX && canMove) {
    mediaEl.style.transform = `translateX(${(dx > 0 ? 1 : -1) * 400}px)`;
    mediaEl.style.opacity = "0";
    setTimeout(() => navigatePhotoBy(dir), 160);
  } else {
    mediaEl.style.transform = "translateX(0)";
    mediaEl.style.opacity = "1";
  }
}, { passive: true });

// Best-effort back-button trap while Child Mode is active.
window.addEventListener("popstate", () => {
  if (AppState.mode === "child") {
    history.pushState({ mvss: true }, "", location.href);
  }
});

/* =========================================================================
   SERVICE WORKER (offline support)
   ========================================================================= */
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  });
}

/* =========================================================================
   INIT
   ========================================================================= */
const recordedAudioPlayer = document.getElementById("audio-player");
if (recordedAudioPlayer) {
  recordedAudioPlayer.addEventListener("play", duckMusic);
  recordedAudioPlayer.addEventListener("ended", unduckMusic);
  recordedAudioPlayer.addEventListener("pause", unduckMusic);
}

boot();
