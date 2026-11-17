const audioFile = document.querySelector("#audioFile");
const bpmInput = document.querySelector("#bpmInput");
const countInSelect = document.querySelector("#countInSelect");
const clickVolume = document.querySelector("#clickVolume");
const startButton = document.querySelector("#startButton");
const stopButton = document.querySelector("#stopButton");
const statusPill = document.querySelector("#statusPill");
const countDisplay = document.querySelector("#countDisplay");
const beatOrb = document.querySelector("#beatOrb");
const trackName = document.querySelector("#trackName");
const progressBar = document.querySelector("#progressBar");
const currentTimeLabel = document.querySelector("#currentTime");
const durationLabel = document.querySelector("#duration");
const tabButtons = document.querySelectorAll(".tab-button");
const tabPanels = document.querySelectorAll(".tab-panel");
const lyricsInput = document.querySelector("#lyricsInput");
const lyricsOutput = document.querySelector("#lyricsOutput");
const lowercaseButton = document.querySelector("#lowercaseButton");
const copyLyricsButton = document.querySelector("#copyLyricsButton");
const clearLyricsButton = document.querySelector("#clearLyricsButton");
const lyricsStatus = document.querySelector("#lyricsStatus");

const lightButton = document.querySelector("#lightButton");
const lightOverlay = document.querySelector("#lightOverlay");
const lightExitButton = document.querySelector("#lightExitButton");
const lightStatus = document.querySelector("#lightStatus");
const lightCount = document.querySelector("#lightCount");
const lightFreezeButton = document.querySelector("#lightFreezeButton");
const lightLevel = document.querySelector("#lightLevel");

let audioContext;
let audioBuffer;
let activeSource;
let timers = [];
let progressFrame = 0;
let playbackStartedAt = 0;
let pausedAt = 0;
let currentObjectUrl = "";

const state = {
  mode: "idle",
  fileName: "",
};

audioFile.addEventListener("change", handleFileUpload);
startButton.addEventListener("click", startCountIn);
stopButton.addEventListener("click", stopPlayback);
bpmInput.addEventListener("input", clampBpm);
document.addEventListener("keydown", handleKeyboardShortcut);
tabButtons.forEach((button) => button.addEventListener("click", () => activateTab(button)));
lyricsInput.addEventListener("input", updateLowercaseLyrics);
lowercaseButton.addEventListener("click", updateLowercaseLyrics);
copyLyricsButton.addEventListener("click", copyLowercaseLyrics);
clearLyricsButton.addEventListener("click", clearLyrics);
lightButton.addEventListener("click", () => setLightMode(true));
lightExitButton.addEventListener("click", () => setLightMode(false));
lightFreezeButton.addEventListener("click", toggleLightFreeze);
lightLevel.addEventListener("input", () => setLightLevel(Number(lightLevel.value)));
// Al soltar la barra se suelta el foco: si no, la barra espaciadora quedaría bloqueada.
lightLevel.addEventListener("change", () => lightLevel.blur());

const LIGHT_LEVEL_KEY = "metronomo.lightLevel";

function setLightLevel(percent) {
  const clamped = Math.min(200, Math.max(60, percent));
  lightLevel.value = clamped;
  lightOverlay.style.setProperty("--light-level", String(clamped / 100));
  try {
    localStorage.setItem(LIGHT_LEVEL_KEY, String(clamped));
  } catch {
    // Sin almacenamiento (modo privado): sigue funcionando, solo no recuerda el valor.
  }
}

function restoreLightLevel() {
  let saved = NaN;
  try {
    saved = Number(localStorage.getItem(LIGHT_LEVEL_KEY));
  } catch {
    // Ignorado: se usa el valor por defecto.
  }
  setLightLevel(Number.isFinite(saved) && saved > 0 ? saved : 100);
}

restoreLightLevel();

function toggleLightFreeze() {
  const frozen = lightOverlay.classList.toggle("is-frozen");
  lightFreezeButton.textContent = frozen ? "Mover" : "Congelar";
  // Sin foco en el botón, la barra espaciadora sigue controlando el audio.
  lightFreezeButton.blur();
}

// Espeja estado y cuenta en la barra del modo luz.
const mirrorToLight = () => {
  lightStatus.textContent = statusPill.textContent;
  lightCount.textContent = countDisplay.textContent;
};
const lightObserver = new MutationObserver(mirrorToLight);
lightObserver.observe(statusPill, { childList: true, characterData: true, subtree: true });
lightObserver.observe(countDisplay, { childList: true, characterData: true, subtree: true });
mirrorToLight();

function setLightMode(enabled) {
  lightOverlay.hidden = !enabled;
  // Soltar el foco: si no, la barra espaciadora volvería a activar el botón.
  document.activeElement?.blur?.();

  if (enabled) {
    document.documentElement.requestFullscreen?.().catch(() => {});
  } else if (document.fullscreenElement) {
    document.exitFullscreen?.().catch(() => {});
  }
}

async function handleFileUpload(event) {
  const file = event.target.files?.[0];
  if (!file) return;

  setMode("loading");
  stopPlayback({ keepStatus: true });
  state.fileName = file.name;
  trackName.textContent = file.name;
  statusPill.textContent = "Cargando";
  startButton.disabled = true;

  try {
    audioContext = audioContext || new AudioContext();
    const arrayBuffer = await file.arrayBuffer();
    audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
    currentObjectUrl && URL.revokeObjectURL(currentObjectUrl);
    currentObjectUrl = URL.createObjectURL(file);
    durationLabel.textContent = formatTime(audioBuffer.duration);
    currentTimeLabel.textContent = "0:00";
    progressBar.style.width = "0%";
    countDisplay.textContent = "OK";
    setMode("ready");
  } catch (error) {
    console.error(error);
    audioBuffer = null;
    trackName.textContent = "No pude leer ese audio. Probá con otro formato.";
    countDisplay.textContent = "0";
    setMode("error");
  }
}

async function startCountIn() {
  if (!audioBuffer) return;
  await ensureAudioContext();
  stopPlayback({ keepStatus: true });

  const bpm = getBpm();
  const beatSeconds = 60 / bpm;
  const countBeats = Number(countInSelect.value);
  const startAt = audioContext.currentTime + 0.16;
  const songStartAt = startAt + countBeats * beatSeconds;

  activeSource = audioContext.createBufferSource();
  activeSource.buffer = audioBuffer;
  activeSource.connect(audioContext.destination);
  activeSource.onended = () => {
    if (state.mode === "playing") finishPlayback();
  };

  setMode("counting");
  pausedAt = 0;
  startButton.disabled = true;
  stopButton.disabled = false;
  progressBar.style.width = "0%";
  currentTimeLabel.textContent = "0:00";

  for (let index = 0; index < countBeats; index += 1) {
    const beatAt = startAt + index * beatSeconds;
    const remaining = countBeats - index;
    scheduleClick(beatAt, index === 0);
    setVisualTimer(beatAt, () => flashBeat(String(remaining)));
  }

  activeSource.start(songStartAt);
  setVisualTimer(songStartAt, () => {
    playbackStartedAt = audioContext.currentTime;
    setMode("playing");
    countDisplay.textContent = "YA";
    beatOrb.classList.add("is-playing");
    updateProgress();
  });
}

function handleKeyboardShortcut(event) {
  if (event.code === "Escape" && !lightOverlay.hidden) {
    setLightMode(false);
    return;
  }

  if ((event.code === "ArrowUp" || event.code === "ArrowDown") && !lightOverlay.hidden) {
    event.preventDefault();
    setLightLevel(Number(lightLevel.value) + (event.code === "ArrowUp" ? 5 : -5));
    return;
  }

  if (event.code === "KeyP" && !lightOverlay.hidden && !isTypingTarget(event.target)) {
    toggleLightFreeze();
    return;
  }

  if (event.code !== "Space" || isTypingTarget(event.target)) return;
  if (event.target.closest?.(".tab-button")) return;

  event.preventDefault();

  if (state.mode === "counting" || state.mode === "playing") {
    stopPlayback();
    return;
  }

  if (audioBuffer && !startButton.disabled) {
    startCountIn();
  }
}

function stopPlayback(options = {}) {
  clearTimers();
  cancelAnimationFrame(progressFrame);

  if (activeSource) {
    try {
      activeSource.onended = null;
      activeSource.stop();
    } catch {
      // Source nodes can only be stopped once.
    }
  }

  activeSource = null;
  pausedAt = 0;
  beatOrb.classList.remove("is-hit", "is-playing");
  progressBar.style.width = "0%";
  currentTimeLabel.textContent = "0:00";

  if (audioBuffer) {
    startButton.disabled = false;
    stopButton.disabled = true;
    countDisplay.textContent = options.keepStatus ? countDisplay.textContent : "OK";
    setMode(options.keepStatus ? state.mode : "ready");
  } else {
    startButton.disabled = true;
    stopButton.disabled = true;
    countDisplay.textContent = "0";
    if (!options.keepStatus) setMode("idle");
  }
}

function finishPlayback() {
  clearTimers();
  cancelAnimationFrame(progressFrame);
  activeSource = null;
  progressBar.style.width = "100%";
  currentTimeLabel.textContent = formatTime(audioBuffer.duration);
  beatOrb.classList.remove("is-hit", "is-playing");
  countDisplay.textContent = "FIN";
  setMode("ready");
}

function scheduleClick(time, accented) {
  const volume = Number(clickVolume.value) / 100;
  if (volume <= 0) return;

  const osc = audioContext.createOscillator();
  const gain = audioContext.createGain();
  osc.type = "sine";
  osc.frequency.setValueAtTime(accented ? 1320 : 880, time);
  gain.gain.setValueAtTime(0.0001, time);
  gain.gain.exponentialRampToValueAtTime(0.55 * volume, time + 0.008);
  gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.095);
  osc.connect(gain);
  gain.connect(audioContext.destination);
  osc.start(time);
  osc.stop(time + 0.11);
}

function flashBeat(value) {
  countDisplay.textContent = value;
  beatOrb.classList.add("is-hit");
  window.setTimeout(() => beatOrb.classList.remove("is-hit"), 110);
}

function updateProgress() {
  if (!audioBuffer || state.mode !== "playing") return;

  const elapsed = Math.min(audioBuffer.duration, audioContext.currentTime - playbackStartedAt + pausedAt);
  const percent = audioBuffer.duration ? (elapsed / audioBuffer.duration) * 100 : 0;
  progressBar.style.width = `${percent}%`;
  currentTimeLabel.textContent = formatTime(elapsed);

  if (elapsed < audioBuffer.duration) {
    progressFrame = requestAnimationFrame(updateProgress);
  }
}

function setVisualTimer(audioTime, callback) {
  const delay = Math.max(0, (audioTime - audioContext.currentTime) * 1000);
  timers.push(window.setTimeout(callback, delay));
}

function clearTimers() {
  timers.forEach((timer) => window.clearTimeout(timer));
  timers = [];
}

async function ensureAudioContext() {
  audioContext = audioContext || new AudioContext();
  if (audioContext.state === "suspended") {
    await audioContext.resume();
  }
}

function setMode(mode) {
  state.mode = mode;
  document.body.dataset.mode = mode;

  const labels = {
    idle: "Sin audio",
    loading: "Cargando",
    ready: "Listo",
    counting: "Contando",
    playing: "Sonando",
    error: "Error",
  };
  statusPill.textContent = labels[mode] || "Listo";

  if (mode === "ready") {
    startButton.disabled = false;
    stopButton.disabled = true;
  }
}

function activateTab(activeButton) {
  tabButtons.forEach((button) => {
    const isActive = button === activeButton;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-selected", String(isActive));
  });

  tabPanels.forEach((panel) => {
    const isActive = panel.id === activeButton.getAttribute("aria-controls");
    panel.classList.toggle("is-active", isActive);
    panel.hidden = !isActive;
  });
}

function updateLowercaseLyrics() {
  lyricsOutput.value = lyricsInput.value.toLocaleLowerCase("es-AR");
  setLyricsStatus(lyricsOutput.value ? "Listo" : "");
}

async function copyLowercaseLyrics() {
  if (!lyricsOutput.value) {
    setLyricsStatus("No hay texto");
    return;
  }

  try {
    await navigator.clipboard.writeText(lyricsOutput.value);
    setLyricsStatus("Copiado");
  } catch {
    lyricsOutput.focus();
    lyricsOutput.select();
    document.execCommand("copy");
    setLyricsStatus("Copiado");
  }
}

function clearLyrics() {
  lyricsInput.value = "";
  lyricsOutput.value = "";
  setLyricsStatus("");
  lyricsInput.focus();
}

function setLyricsStatus(message) {
  lyricsStatus.textContent = message;
}

function isTypingTarget(target) {
  const tagName = target?.tagName;
  return target?.isContentEditable || tagName === "INPUT" || tagName === "TEXTAREA" || tagName === "SELECT";
}

function clampBpm() {
  const value = Number(bpmInput.value);
  if (!Number.isFinite(value)) return;
  if (value < 40) bpmInput.value = 40;
  if (value > 260) bpmInput.value = 260;
}

function getBpm() {
  const value = Number(bpmInput.value);
  if (!Number.isFinite(value)) return 120;
  return Math.min(260, Math.max(40, value));
}

function formatTime(seconds) {
  const safeSeconds = Math.max(0, Math.floor(seconds || 0));
  const minutes = Math.floor(safeSeconds / 60);
  const rest = String(safeSeconds % 60).padStart(2, "0");
  return `${minutes}:${rest}`;
}
