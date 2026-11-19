const BGM_VOLUME = 0.65;

const bgmRuntime = {
  audio: null,
  currentBgmId: "",
  pendingBgmId: "",
  volumeTimer: null,
};

function getBgmById(bgmId) {
  return state.bgmMap.get(safeText(bgmId)) ?? null;
}

function playBgm(bgmId, options = {}) {
  const id = safeText(bgmId);
  if (!id) return false;
  const audibleDelayMs = normalizeBgmAudibleDelayMs(options?.audibleDelayMs);

  const bgm = getBgmById(id);
  if (!bgm) {
    console.warn("[BGM] bgm_id not found", { bgmId: id });
    return false;
  }

  if (!bgm.bgm_path) {
    if (bgmRuntime.audio) stopBgm();
    console.warn("[BGM] bgm_path is empty", { bgmId: id });
    return false;
  }

  if (
    bgmRuntime.currentBgmId === id &&
    bgmRuntime.audio &&
    (bgmRuntime.pendingBgmId === id || !bgmRuntime.audio.paused)
  ) {
    return true;
  }

  if (bgmRuntime.audio) stopBgm();
  else clearBgmVolumeTimer();

  const audio = createBgmAudio(bgm.bgm_path, id, options);
  if (!audio) return false;
  if (audibleDelayMs > 0) {
    audio.volume = 0;
  }

  bgmRuntime.audio = audio;
  bgmRuntime.currentBgmId = id;
  bgmRuntime.pendingBgmId = id;

  let playResult = null;
  try {
    playResult = audio.play();
  } catch (error) {
    handleBgmPlayRejected(audio, id, error);
    return false;
  }

  if (playResult && typeof playResult.then === "function") {
    playResult
      .then(() => {
        handleBgmPlayStarted(audio, id, audibleDelayMs);
      })
      .catch((error) => {
        handleBgmPlayRejected(audio, id, error);
      });
  } else {
    handleBgmPlayStarted(audio, id, audibleDelayMs);
  }

  return true;
}

function stopBgm() {
  clearBgmVolumeTimer();
  const audio = bgmRuntime.audio;
  bgmRuntime.audio = null;
  bgmRuntime.currentBgmId = "";
  bgmRuntime.pendingBgmId = "";

  if (!audio) return;

  try {
    audio.pause();
    audio.currentTime = 0;
  } catch (error) {
    console.warn("[BGM] stop failed", error);
  }
}

function normalizeBgmAudibleDelayMs(value) {
  const delayMs = Number(value);
  return Number.isFinite(delayMs) ? Math.max(0, Math.floor(delayMs)) : 0;
}

function handleBgmPlayStarted(audio, bgmId, audibleDelayMs) {
  if (bgmRuntime.audio !== audio || bgmRuntime.currentBgmId !== bgmId) return;

  bgmRuntime.pendingBgmId = "";
  if (audibleDelayMs > 0) {
    scheduleBgmVolumeRestore(audio, bgmId, audibleDelayMs);
  }
}

function scheduleBgmVolumeRestore(audio, bgmId, delayMs) {
  clearBgmVolumeTimer();
  const volumeTimer = window.setTimeout(() => {
    if (bgmRuntime.volumeTimer === volumeTimer) {
      bgmRuntime.volumeTimer = null;
    }
    if (bgmRuntime.audio === audio && bgmRuntime.currentBgmId === bgmId) {
      audio.volume = BGM_VOLUME;
    }
  }, delayMs);
  bgmRuntime.volumeTimer = volumeTimer;
}

function clearBgmVolumeTimer() {
  if (bgmRuntime.volumeTimer == null) return;
  window.clearTimeout(bgmRuntime.volumeTimer);
  bgmRuntime.volumeTimer = null;
}

function createBgmAudio(path, bgmId, options = {}) {
  if (typeof Audio !== "function") {
    console.warn("[BGM] Audio API is unavailable", { bgmId });
    return null;
  }

  try {
    const audio = new Audio(path);
    audio.loop = options.loop !== false;
    audio.volume = BGM_VOLUME;
    if (!audio.loop && typeof options.onEnded === "function") {
      audio.addEventListener("ended", () => {
        if (bgmRuntime.audio !== audio || bgmRuntime.currentBgmId !== bgmId) return;
        bgmRuntime.audio = null;
        bgmRuntime.currentBgmId = "";
        bgmRuntime.pendingBgmId = "";
        options.onEnded();
      }, { once: true });
    }
    return audio;
  } catch (error) {
    console.warn("[BGM] Audio creation failed", { bgmId, error });
    return null;
  }
}

function handleBgmPlayRejected(audio, bgmId, error) {
  if (bgmRuntime.audio === audio && bgmRuntime.currentBgmId === bgmId) {
    clearBgmVolumeTimer();
    bgmRuntime.audio = null;
    bgmRuntime.currentBgmId = "";
    bgmRuntime.pendingBgmId = "";
  }
  console.warn("[BGM] playback was blocked or failed", { bgmId, error });
}

// Same eligible battle_/arena_ tracks as the MHB battle mode; GO owns these copies.
const GO_BATTLE_BGM_TRACKS = Object.freeze([
  "battle_f_1",
  "battle_f_2",
  "battle_e_1",
  "battle_e_2",
  "battle_d_1",
  "battle_d_2",
  "battle_c_1",
  "battle_c_2",
  "battle_b_1",
  "battle_b_2",
  "battle_a_1",
  "battle_a_2",
  "battle_s_1",
  "battle_s_2",
  "battle_ss_1",
  "battle_ss_2",
  "arena_g_1",
  "arena_g_2",
  "arena_g_3",
  "arena_g_4",
  "arena_g_5",
  "arena_g_6",
  "arena_g_7",
  "arena_m_1",
  "arena_m_2",
  "arena_x_1"
]);

function registerGoBattleBgm(map) {
  for (const name of GO_BATTLE_BGM_TRACKS) {
    const id = "go_" + name;
    map.set(id, { bgm_id: id, name, bgm_path: "./asset/bgm/" + name + ".mp3" });
  }
}
