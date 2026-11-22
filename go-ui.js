const geneOrderUI = (() => {
  const SIDES = ["player", "enemy"];
  const LABELS = { player: "自分", enemy: "相手" };
  const STATS = { hp: "体力", phy_atk: "物理攻撃", phy_def: "物理防御", sp_atk: "特殊攻撃", sp_def: "特殊防御", speed: "敏捷" };
  const MODES = { enemy: "プレイヤー対AI", manual: "手動対手動", auto: "AI対AI" };
  const SETUP_MODES = { "random-enemy": "自分の3体 対 ランダムAI", ...MODES };
  const SWITCHES = { "tail-purge": "テールパージ", relay: "パワーリレー", "post-attack": "燕返し", replacement: "戦闘不能後の補充" };
  const TEAM_LIMIT = 4;
  const RANDOM_TEAM_SIZE = 3;
  const DODGE = "skill_000";
  // MHB pause() doubles its source delays. These values are the actual milliseconds.
  const PLAYBACK_TIMING = Object.freeze({
    input: 500,
    moveName: 500,
    damage: 1000,
    stage: 1000,
    status: 1000,
    passive: 1000,
    faint: 1000,
    switch: 1000,
    residual: 1000,
    energy: 750,
    message: 1500,
    actionGap: 500,
    turnEnd: 750,
    hpGauge: 750,
    flash: 500,
    minimumAnimation: 250,
  });
  function eventHold(event) {
    if (event.type === "move") return event.category === "attack" ? PLAYBACK_TIMING.damage : PLAYBACK_TIMING.status;
    if (["faint", "win", "draw"].includes(event.type)) return PLAYBACK_TIMING.faint;
    if (["switch", "replacement"].includes(event.type)) return PLAYBACK_TIMING.switch;
    if (["residual", "heal", "absorbed"].includes(event.type)) return PLAYBACK_TIMING.residual;
    if (["reflected", "revenge", "recoil", "decoy-hit"].includes(event.type)) return PLAYBACK_TIMING.damage;
    if (event.type === "stage") return PLAYBACK_TIMING.stage;
    if (event.type === "passive") return PLAYBACK_TIMING.passive;
    if (["energy", "effect-energy", "en-drain", "en-modifier", "insufficient-energy"].includes(event.type)) return PLAYBACK_TIMING.energy;
    return PLAYBACK_TIMING.message;
  }
  const aiRandom = () => crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32;
  const otherSide = (side) => side === "player" ? "enemy" : "player";

  // Attribute matchup only: deliberately excludes STAB, guards and power modifiers.
  function moveMatchup(move, defender, data) {
    if (move.category !== "attack") return null;
    const go = geneOrderBattle;
    const override = go.moveEffects(move).filter(({ table, chance }) => table === "battleEffects" && chance > 0)
      .map(({ id }) => data.battleEffects.get(id)).find((effect) => effect && go.battleEffectKind(effect) === "type-override");
    return {
      multiplier: go.moveWeaknessMultiplier(defender.base, move, data.effectiveness, override),
      passiveImmune: Boolean(geneOrderPassives.first(defender, "element-immunity",
        (effect) => go.moveHasElement(move, effect.element) && effect.value > 0)),
    };
  }

  function fighterIssue(base, data) {
    if (!base) return "キャラクター未設定";
    if (!base.element_1 || !data.elements.has(base.element_1) || (base.element_2 && !data.elements.has(base.element_2))) return "属性未設定";
    if (!Object.keys(STATS).every((stat) => Number.isSafeInteger(base[stat]) && base[stat] > 0) ||
      !Number.isSafeInteger(base.energy_charge) || base.energy_charge < 0) return "能力値が未設定または無効";
    if (!base.skillIds.some((id) => data.skills.has(id))) return "習得技未設定";
    if (!base.skillIds.some((id) => data.skills.has(id) && !geneOrderBattle.moveAvailability(data.skills.get(id), data).issues.length)) {
      return "使用可能な習得技なし";
    }
    return "";
  }

  function orderedTeam(team, lead, data, limit) {
    if (!team.length || team.length > limit || new Set(team).size !== team.length || !team.includes(lead)) {
      throw new Error(`各チームは1〜${limit}体を選び、先発を指定してください。`);
    }
    return [lead, ...team.filter((id) => id !== lead)].map((id) => {
      const base = data.characterMap.get(id);
      const issue = fighterIssue(base, data);
      if (issue) throw new Error(issue);
      return base;
    });
  }

  function usableRandomRoster(data) {
    return [...new Map(data.characters.filter((base) => base.character_id && base.name &&
      Number.isSafeInteger(base.slot) && base.slot > 0 && !fighterIssue(base, data))
      .map((base) => [base.character_id, base])).values()];
  }

  function drawRandomTeam(roster, random) {
    if (roster.length < RANDOM_TEAM_SIZE) throw new Error("ランダムバトルには使用可能なキャラクターが3体以上必要です。");
    const available = [...roster];
    return Array.from({ length: RANDOM_TEAM_SIZE }, () => {
      const roll = random();
      if (!Number.isFinite(roll) || roll < 0 || roll >= 1) throw new Error("抽選用の乱数が無効です。");
      return available.splice(Math.floor(roll * available.length), 1)[0].character_id;
    });
  }

  function minimumSlotLead(ids, data) {
    return ids.reduce((first, id) => !first || data.characterMap.get(id).slot < data.characterMap.get(first).slot ? id : first, null);
  }

  function randomBattleSettings(data, random = aiRandom) {
    const roster = usableRandomRoster(data);
    const team = Object.fromEntries(SIDES.map((side) => [side, drawRandomTeam(roster, random)]));
    const rosterMap = new Map(roster.map(base => [base.character_id, base]));
    const lead = Object.fromEntries(SIDES.map(side => [side, minimumSlotLead(team[side], { characterMap: rosterMap })]));
    return { team, lead, mode: "enemy" };
  }

  function randomOpponentSettings(data, playerIds, random = aiRandom) {
    if (playerIds.length !== RANDOM_TEAM_SIZE) throw new Error("自分のチームを3体選択してください。");
    const roster = usableRandomRoster(data);
    if (new Set(playerIds).size !== RANDOM_TEAM_SIZE || playerIds.some(id => !roster.some(base => base.character_id === id))) {
      throw new Error("使用可能なキャラクターを重複なしで3体選択してください。");
    }
    const opponents = roster.filter(base => !playerIds.includes(base.character_id));
    const team = { player: [...playerIds], enemy: drawRandomTeam(opponents.length >= RANDOM_TEAM_SIZE ? opponents : roster, random) };
    const lead = Object.fromEntries(SIDES.map(side => [side, minimumSlotLead(team[side], data)]));
    return { team, lead, mode: "enemy" };
  }

  function captureFrame(battle) {
    const teams = Object.fromEntries(SIDES.map((side) => [side, battle.teams[side].map((fighter) => {
      const { base, hp, maxHp, energy, fainted, dodgeActive, halfGuard, bind, pending, decoy, stages, statuses, defenses, timedEffects, nextElementPower, passive } = fighter;
      return { base, hp, maxHp, energy, fainted, dodgeActive, halfGuard, bind: bind && { turns: bind.turns },
        pending: pending && { ...pending }, decoy: decoy && { ...decoy }, stages: { ...stages },
        statuses: statuses.map((status) => ({ ...status })), defenses: new Map([...defenses].map(([id, entry]) => [id, { ...entry }])),
        nextElementPower: new Map(nextElementPower),
        timedEffects: new Map([...timedEffects].map(([id, entry]) => [id, { ...entry }])), passive };
    })]));
    return { teams, active: { ...battle.active }, turn: battle.turn,
      fields: Object.fromEntries(SIDES.map((side) => [side, new Map([...battle.fields[side]].map(([id, entry]) => [id, { ...entry }]))])) };
  }

  function createMatch(data, settings, { limit = TEAM_LIMIT, random, aiRoll = aiRandom } = {}) {
    const { team, lead, mode } = settings;
    if (!Object.hasOwn(MODES, mode)) throw new Error("対戦モードが不明です。");
    const go = geneOrderBattle;
    const battle = go.createBattle({
      player: orderedTeam(team.player, lead.player, data, limit),
      enemy: orderedTeam(team.enemy, lead.enemy, data, limit),
      skills: data.skills, effects: data.effects, battleEffects: data.battleEffects,
      powerRules: data.powerRules, passives: data.passives, effectiveness: data.effectiveness,
      manualSwitches: true, random, captureFrame,
    });
    const history = { player: new Map(), enemy: new Map() };
    const switches = {};
    const isAI = (side) => mode === "auto" || (mode === "enemy" && side === "enemy");
    const aiAction = (side) => geneOrderAI.choose(
      geneOrderAI.observe(battle, side, { history, previousSwitch: switches[side] }), { random: aiRoll },
    ).action;
    function record(result) {
      geneOrderAI.record(history, result.events);
      for (const event of result.events) {
        if (event.type === "switch" || event.type === "replacement") switches[event.side] = { turn: result.turn };
      }
      return result;
    }
    return {
      battle, isAI,
      resolve(input) {
        if (battle.winner || battle.pendingSwitch) throw new Error("行動を選べません。");
        const actions = Object.fromEntries(SIDES.map((side) => [side, isAI(side) ? aiAction(side) : input[side]]));
        return record(go.resolveTurn(battle, actions));
      },
      resume(index) {
        if (!battle.pendingSwitch) throw new Error("交代選択待ちではありません。");
        const { side } = battle.pendingSwitch;
        return record(go.continueSwitch(battle, side, isAI(side) ? aiAction(side).index : index));
      },
    };
  }

  function stageMarks(stage) {
    const count = Math.min(6, Math.abs(stage));
    return (stage > 0 ? "▲" : "▼").repeat(count) + "・".repeat(6 - count);
  }

  function battleStatMarkup(stat, value, stage, hideValue = false) {
    const grade = goStatRank(stat, value);
    const marks = Number.isInteger(stage) ? stageMarks(stage) : "";
    const slots = [...marks].map(mark => '<span class="go-stage-slot ' +
      (mark === "▲" ? "go-stage-up" : mark === "▼" ? "go-stage-down" : "go-stage-empty") +
      '" aria-hidden="true">' + mark + '</span>').join("");
    return '<div class="detail-stat detail-stat-' + stat + ' go-battle-stat' + (hideValue ? ' go-stat-hidden' : '') + '">' +
      '<span class="detail-stat-label">' + escapeHtml(STAT_LABELS[stat]) + '</span>' +
      '<span class="go-battle-stage" aria-label="能力変化 ' + marks + '">' + slots + '</span>' +
      '<span class="detail-stat-grade"' + (grade ? ' style="--stat-rank-color:' + grade.color + '"' : '') + '>' + (grade?.letter ?? '') + '</span>' +
      (hideValue ? '' : '<strong class="detail-stat-value">' + escapeHtml(value) + '</strong>') + '</div>';
  }

  function mount(root, data, { limit = TEAM_LIMIT } = {}) {
    const template = document.getElementById("legacy-screens");
    const debug = document.querySelector(".go-preview");
    const go = geneOrderBattle;
    const esc = escapeHtml;
    registerGoBattleBgm(data.bgmMap);
    const clone = (selector) => template.content.querySelector(selector).cloneNode(true);
    const shell = document.createElement("main");
    shell.className = "app-shell";
    const title = clone("#titleView");
    const setup = clone("#setupView");
    const arena = clone("#battleView");
    arena.querySelector(".battle-card").insertAdjacentHTML("afterbegin",
      '<header class="go-mobile-battle-header"><strong>GENE ORDER</strong><span id="go-mobile-turn"></span></header>');
    const dex = clone("#dexOverlay");
    title.querySelector(".title-stage").innerHTML = `
      <div class="team-panel go-title-panel">
        <h1>GENE ORDER</h1><p>v0.66</p>
        <button class="primary-button" id="battleModeButton" type="button">BattleMode</button>
        <button class="primary-button" type="button" data-go-random-battle>Random(3vs3)</button>
        <p id="go-random-notice" role="status"></p>
        <div class="setup-actions">
          <button class="small-button" data-go-page="dex" type="button">GENE名鑑</button>
          <button class="small-button" data-go-chart type="button">属性相性表</button>
          <button class="small-button" data-go-page="debug" type="button">Debug</button>
        </div>
      </div>`;
    setup.querySelector(".brand-mark").textContent = "GO";
    setup.querySelector(".brand-sub").textContent = "GENE ORDER";
    setup.querySelector(".roster-panel .panel-title").textContent = "GENE";
    setup.querySelector("#randomBattleButton").textContent = "Random(3vs3)";
    setup.querySelector("#randomBattleButton").setAttribute("data-go-random-battle", "");
    setup.querySelector(".team-panel").insertAdjacentHTML("beforeend", `
      <label class="go-mode">対戦モード<select id="go-official-mode">
        ${Object.entries(SETUP_MODES).map(([key, label]) => `<option value="${key}">${label}</option>`).join("")}
      </select></label>
      <p class="command-note" id="go-team-notice" aria-live="polite"></p>
      <button type="button" class="small-button" data-go-chart>属性相性表</button>
      <button type="button" class="small-button" data-go-page="title">Title</button>`);
    arena.querySelector("#battleTutorialOverlay").remove();
    arena.querySelector("#exchangePanel").remove();
    arena.querySelector("#dexButton").remove();
    arena.querySelector("#switchTab").insertAdjacentHTML("beforebegin",
      `<button id="go-dodge" class="tab-button" type="button" data-go-move="${DODGE}">回避</button>`);
    arena.querySelector("#glossaryPanel").remove();
    arena.querySelector("#glossaryButton").outerHTML =
      '<button id="go-battle-chart" class="tab-button" type="button" data-go-chart aria-haspopup="dialog">相性</button>';
    arena.querySelector(".battle-card").insertAdjacentHTML("beforeend", `
      <div class="go-battle-footer">
        <label><input type="checkbox" id="go-fast-battle"> 演出Skip</label>
        <label><input type="checkbox" id="go-battle-bgm" checked> BGM</label>
        <button type="button" class="small-button" data-go-page="setup">編成</button>
        <button type="button" class="small-button" data-go-page="title">Title</button>
        <details><summary>戦闘ログ</summary><ol id="go-official-log"></ol></details>
      </div>`);
    arena.querySelector("#battleLog").setAttribute("role", "status");
    dex.setAttribute("role", "dialog");
    dex.setAttribute("aria-modal", "true");
    const chartDialog = document.createElement("dialog");
    chartDialog.className = "detail-panel go-chart-panel";
    chartDialog.setAttribute("aria-label", "属性相性一覧表");
    chartDialog.innerHTML = `<div class="detail-header"><strong>GENE ORDER</strong>
      <form method="dialog"><button class="small-button" autofocus>閉</button></form></div>${goAttributeChart(data)}`;
    chartDialog.addEventListener("click", (event) => {
      if (event.target !== chartDialog) return;
      const { left, right, top, bottom } = chartDialog.getBoundingClientRect();
      if (event.clientX < left || event.clientX > right || event.clientY < top || event.clientY > bottom) {
        chartDialog.close();
      }
    });
    const skillDialog = document.createElement("dialog");
    skillDialog.className = "detail-panel go-skill-dialog";
    skillDialog.setAttribute("aria-label", "技の詳細");
    skillDialog.innerHTML = '<div class="detail-header"><strong>技の詳細</strong><form method="dialog"><button class="small-button" autofocus>閉じる</button></form></div><div class="go-skill-dialog-content"></div>';
    shell.append(title, setup, arena, dex, chartDialog, skillDialog);
    root.append(shell);
    const $ = (id) => shell.querySelector("#" + id);
    const debugBack = document.createElement("button");
    debugBack.className = "small-button";
    debugBack.type = "button";
    debugBack.textContent = "タイトルへ";
    debugBack.addEventListener("click", () => showPage("title"));
    debug.prepend(debugBack);

    const settings = { team: { player: [], enemy: [] }, lead: {}, mode: "random-enemy" };
    let side = "player";
    let returnFocus;
    let match;
    let randomBattle = false;
    let randomOpponent = false;
    let lastMatchSettings = null;
    let currentBattleBgm = "";
    let phase = "choice";
    let turnSide = "player";
    let selected = {};
    let switchOpen = false;
    let inspectSide = null;
    let expandedMoveId = null;
    let epoch = 0;
    let motion;
    let finishWait;
    arena.style.setProperty("--go-hp-transition-ms", PLAYBACK_TIMING.hpGauge + "ms");

    function skipping() {
      return $("go-fast-battle").checked || globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    }

    function waitPlayback(milliseconds, current) {
      if (skipping() || current !== epoch) return Promise.resolve();
      return new Promise((done) => {
        const finish = () => {
          clearTimeout(timer);
          if (finishWait === finish) finishWait = null;
          done();
        };
        const timer = setTimeout(finish, milliseconds);
        finishWait = finish;
      });
    }

    function setPage(next) {
      debug.hidden = next !== "debug";
      shell.classList.toggle("is-hidden", next === "debug");
      for (const [name, view] of [["title", title], ["setup", setup], ["battle", arena]]) view.classList.toggle("is-hidden", name !== next);
    }

    function showPage(next) {
      if (next === "dex") {
        returnFocus = document.activeElement;
        showDex(data.characters[0]?.character_id);
        return;
      }
      expandedMoveId = null;
      epoch++;
      if (skillDialog.open) skillDialog.close();
      finishWait?.();
      motion?.cancel();
      match = null;
      stopBgm();
      $("battleAnimationLayer").replaceChildren();
      setPage(next);
      if (next === "setup") renderSetup();
    }

    const typeBadge = (id) => {
      const value = data.elements.get(id);
      return value ? goAttributeIcon(id, value.name) : "";
    };
    const attributeIcons = (...ids) => ids.filter(Boolean).map(typeBadge).filter(Boolean).join(" ") || "属性未設定";
    const attributes = (base) => attributeIcons(base.element_1, base.element_2);
    const moveAttributes = (move) => attributeIcons(move.element, move.element2);
    const picture = (base, className) => base.imageSrc
      ? `<img class="${className}" src="${esc(base.imageSrc)}" alt="${esc(base.name)}">` : '<span class="go-missing-image">画像未設定</span>';

    function profileSubtitle(base) {
      const species = data.speciesMap.get(base.species_id)?.name || "種族未設定";
      return `${attributes(base)}　${esc(species)}`;
    }

    function profileSummary(base) {
      const evasion = base.evasion_percent == null ? "未設定" : `${base.evasion_percent}%`;
      return `<div class="detail-summary">
        <div class="dex-data-row"><span>スロット</span><strong>${esc(base.slot)}</strong></div>
        <div class="dex-data-row"><span>EN回復</span><strong>${energyBadge(base.energy_charge)}</strong></div>
        <div class="dex-data-row"><span>回避率</span><strong>${evasion}</strong></div>
      </div>`;
    }

    function profileStats(base) {
      return `<div class="detail-stats">${Object.keys(STATS).concat("regen_value").map((stat) => goCharacterStat(stat, base[stat])).join("")}</div>`;
    }

    function profileSections(base) {
      const skills = base.skillIds.map((id) => {
        const move = data.skills.get(id);
        if (!move) return `<article class="detail-skill-card">${esc(id)}（未設定）</article>`;
        return renderSkillDetail(move, {
          attributeMarkup: moveAttributes(move),
          description: goStatText(move.text),
          issue: goStatText(go.moveAvailability(move, data).issues.join("、")),
        });
      });
      const passive = data.passives.get(base.passive_id);
      return `<section class="detail-passive">
        <div class="detail-section-title">パッシブ</div>
        <article class="detail-passive-card">
          <strong class="detail-passive-name">${esc(passive?.name ?? "未設定")}${passive && passive.status !== "implemented" ? "（未対応）" : ""}</strong>
          ${passive?.text ? `<div class="detail-passive-text">${esc(goStatText(passive.text))}</div>` : ""}
        </article>
      </section>
      <section class="detail-skills">
        <div class="detail-section-title">習得技</div>
        ${skills.join("") || '<article class="detail-skill-card">未設定</article>'}
      </section>`;
    }

    function showDex(id) {
      const base = data.characterMap.get(id);
      if (!base) return;
      $("dexPanel").innerHTML = `<div class="detail-header"><div class="detail-title">図鑑</div>
        <button class="small-button dex-close" type="button" data-go-close="dex">閉じる</button></div>
        <div class="dex-layout"><aside class="dex-list" aria-label="キャラクター一覧">
        ${data.characters.map((entry) => `<button type="button" class="dex-list-button ${entry === base ? "is-selected" : ""}"
          data-go-dex="${esc(entry.character_id)}"><span>${esc(entry.name)}</span><span class="go-dex-attributes">${attributes(entry)}</span></button>`).join("")}
        </aside><section class="dex-content">
          <div class="dex-profile">
            <div class="detail-image-frame dex-image-frame">${picture(base, "detail-image")}</div>
            <div class="dex-summary">
              <div class="detail-title">${esc(base.name)}</div>
              <div class="detail-subtitle">${profileSubtitle(base)}</div>
              ${profileSummary(base)}
            </div>
          </div>
          <div class="detail-section-title">パラメータ</div>
          ${profileStats(base)}
          ${profileSections(base)}
        </section></div>`;
      dex.classList.remove("is-hidden");
      $("dexPanel").querySelector(".dex-close").focus();
    }

    function renderSetup() {
      const automaticEnemy = settings.mode === "random-enemy";
      const teamLimit = automaticEnemy ? RANDOM_TEAM_SIZE : limit;
      if (automaticEnemy) side = "player";
      $("setupEnemyModeButton").classList.toggle("is-hidden", automaticEnemy);
      $("setupPanelTitle").textContent = LABELS[side] + "チーム";
      for (const candidate of SIDES) {
        const tab = $(candidate === "player" ? "setupPlayerModeButton" : "setupEnemyModeButton");
        tab.classList.toggle("is-active", side === candidate);
        tab.setAttribute("aria-pressed", String(side === candidate));
      }
      $("go-official-mode").value = settings.mode;
      $("selectedSlots").innerHTML = (automaticEnemy ? ["player"] : SIDES).map((candidate) => `
        <section class="setup-party-slots ${side === candidate ? "is-active" : ""}">
          <button type="button" class="team-slot-summary" data-go-side="${candidate}">
            <span>${LABELS[candidate]}チーム</span><strong>${settings.team[candidate].length}/${teamLimit}体</strong>
          </button>
          ${settings.team[candidate].map((id) => {
            const base = data.characterMap.get(id);
            const leading = settings.lead[candidate] === id;
            return `<div class="selected-slot is-filled"><div class="slot-name">${esc(base.name)}${leading ? "（先発）" : ""}</div>
              <div class="slot-meta">${attributes(base)} スロット ${esc(base.slot)}</div>
              <div class="setup-actions">
                <button type="button" class="small-button ${automaticEnemy ? "is-hidden" : ""}" data-go-lead="${esc(id)}" data-go-team="${candidate}" ${leading ? "disabled" : ""}>先発にする</button>
                <button type="button" class="small-button" data-go-remove="${esc(id)}" data-go-team="${candidate}">外す</button>
              </div></div>`;
          }).join("") || '<div class="selected-slot">未編成</div>'}
        </section>`).join("");
      $("rosterGrid").innerHTML = data.characters.map((base) => {
        const id = base.character_id;
        const issue = fighterIssue(base, data);
        const chosen = settings.team[side].includes(id);
        const full = settings.team[side].length >= teamLimit && !chosen;
        return `<article class="character-card ${chosen ? "is-selected" : ""}">
          <button class="card-select-button" type="button" data-go-pick="${esc(id)}" aria-pressed="${chosen}" ${issue || full ? "disabled" : ""}>
            <div class="card-topline"><span class="card-name">${esc(base.name)}</span><span class="go-card-attributes">${attributes(base)}</span></div>
            <div class="card-image-frame">${picture(base, "card-image")}</div>
            <div class="card-slot-meta">スロット ${esc(base.slot)}${issue ? ` · ${esc(goStatText(issue))}` : ""}</div>
          </button>
          <button class="detail-button" type="button" data-go-detail="${esc(id)}">詳細</button>
        </article>`;
      }).join("");
      const ready = automaticEnemy ? limit >= RANDOM_TEAM_SIZE && settings.team.player.length === RANDOM_TEAM_SIZE
        : SIDES.every((candidate) => settings.team[candidate].length && settings.lead[candidate]);
      $("startButton").disabled = !ready;
      $("go-team-notice").textContent = automaticEnemy
        ? "自分の3体を選択してください。相手は開始時に3体をランダム編成します。先発は最小スロットです。"
        : ready ? `各側 最大${limit}体（暫定）` : "両チームにキャラクターを選択してください。";
    }

    function updateTeam(candidate, ids) {
      settings.team[candidate] = ids;
      if (settings.mode === "random-enemy") settings.lead[candidate] = minimumSlotLead(ids, data);
      else if (!ids.includes(settings.lead[candidate])) settings.lead[candidate] = ids[0];
      renderSetup();
    }

    function renderDetail(id) {
      const base = data.characterMap.get(id);
      if (!base) return;
      $("detailPanel").innerHTML = `
        <div class="detail-header">
          <div>
            <div class="detail-title">${esc(base.name)}</div>
            <div class="detail-subtitle">${profileSubtitle(base)}</div>
          </div>
          <button class="small-button detail-close" type="button" data-go-close="detail">閉じる</button>
        </div>
        <div class="detail-body">
          <div class="detail-profile-column">
            <div class="detail-image-frame">${picture(base, "detail-image")}</div>
            ${profileSummary(base)}
          </div>
          ${profileStats(base)}
          ${profileSections(base)}
        </div>`;
      $("detailPanel").scrollTop = 0;
      $("detailOverlay").classList.remove("is-hidden");
      $("detailPanel").querySelector(".detail-close").focus();
    }

    function flags(fighter, frame, candidate) {
      const labels = fighter.statuses.map(({ definition, turns }) => `${definition.name}（${turns}）`);
      if (fighter.fainted) labels.push("戦闘不能");
      if (fighter.bind) labels.push(`締め付け（${fighter.bind.turns}）`);
      if (fighter.dodgeActive) labels.push("回避状態");
      if (fighter.halfGuard || fighter.defenses.has("bf_half_guard")) labels.push("半減防御");
      if (fighter.decoy) labels.push(`デコイ 体力 ${fighter.decoy.hp}/${fighter.decoy.maxHp}`);
      if (fighter.pending) labels.push(`予約 ${data.skills.get(fighter.pending.moveId)?.name ?? ""}（威力${fighter.pending.power}）`);
      for (const { definition, expires, starts } of [...fighter.defenses.values(), ...fighter.timedEffects.values(), ...frame.fields[candidate].values()]) {
        if (!["bf_half_guard", "bf_dodge_guard"].includes(definition.battle_effect_id)) {
          labels.push(`${definition.name}（${starts > frame.turn ? "次ターン" : Math.max(0, expires - frame.turn)}）`);
        }
      }
      for (const [element, effect] of fighter.nextElementPower) {
        labels.push("次の" + (data.elements.get(element)?.name ?? element) + "属性攻撃の威力 ×" + effect.modifier);
      }
      return labels;
    }

    function drawBoard(frame) {
      $("go-mobile-turn").textContent = `${frame.turn}ターン`;
      for (const candidate of SIDES) {
        const index = frame.active[candidate];
        const team = frame.teams[candidate];
        const fighter = team[index];
        const hud = $(candidate + "Hud");
        const sprite = $(candidate + "Sprite");
        const meterWidth = 100 * fighter.hp / fighter.maxHp;
        const key = fighter.base.character_id + "/" + index;
        if (hud.dataset.renderedFighterKey !== key) {
          hud.dataset.renderedFighterKey = key;
          hud.innerHTML = `<div class="hud-row"><div class="hud-name">${attributes(fighter.base)}
          <span class="hud-character-name">${esc(fighter.base.name)}</span></div></div>
          <div class="hp-line"><span>体力</span><div class="meter"><div class="meter-fill hp-fill ${meterWidth <= 28 ? "is-low" : ""}"
            style="width:${meterWidth}%"></div></div><span class="hud-value hp-value"></span></div>
          <div class="energy-line"><span>EN</span><div class="meter energy-meter">${renderEnergySegments({ energy: fighter.energy, maxEnergy: go.MAX_ENERGY })}</div>
            <span class="hud-value go-en-value"></span></div>
          <div class="party-pips"></div>`;
        }
        const bar = hud.querySelector(".hp-fill");
        bar.style.width = meterWidth + "%";
        bar.classList.toggle("is-low", meterWidth <= 28);
        hud.querySelector(".hp-value").textContent = fighter.hp + "/" + fighter.maxHp;
        hud.querySelector(".go-en-value").textContent = fighter.energy + "/" + go.MAX_ENERGY;
        hud.querySelectorAll(".energy-segment").forEach((segment, slot) => segment.classList.toggle("is-filled", slot < fighter.energy));
        hud.querySelector(".party-pips").innerHTML = team.map((member, i) =>
          `<span class="pip ${member.fainted ? "is-fainted" : "is-alive"} ${index === i ? "is-active" : ""}"></span>`).join("");
        if (sprite.dataset.renderedFighterKey !== key) {
          sprite.dataset.renderedFighterKey = key;
          sprite.innerHTML = renderSprite({ id: fighter.base.character_id, name: fighter.base.name, base: fighter.base }, candidate, index,
            attributes(fighter.base), '<span class="go-missing-image">画像未設定</span>');
          const image = sprite.querySelector("img");
          if (image) {
            const setSourceSize = () => {
              if (image.naturalWidth > 0) image.style.setProperty("--go-source-width", image.naturalWidth + "px");
            };
            if (image.complete) setSourceSize();
            else image.addEventListener("load", setSourceSize, { once: true });
          }
        }
        sprite.classList.toggle("is-position-hidden", !fighter.fainted && fighter.pending?.definition.battle_effect_group === "position");
        sprite.classList.toggle("go-fainted", fighter.fainted);
      }
      $("battleStatusPanel").replaceChildren();
      $("battleStatusPanel").classList.add("is-hidden");
      $("commandLights").innerHTML = frame.teams.player.map((fighter, i) =>
        `<span class="command-light ${fighter.fainted ? "is-fainted" : i === frame.active.player ? "is-active" : "is-ready"}"></span>`).join("");
    }

    function message(text, visible = false) {
      $("battleLog").textContent = text;
      $("battleLog").classList.toggle("is-visible", visible);
    }

    function appendLog(text) {
      if (!text) return;
      const row = document.createElement("li");
      row.textContent = text;
      $("go-official-log").append(row);
    }

    function openInspect(candidate) {
      if (phase !== "choice" || !match) return;
      expandedMoveId = null;
      inspectSide = candidate;
      switchOpen = false;
      renderCommands();
    }

    function inspectMarkup(battle, side) {
      const fighter = go.activeFighter(battle, side);
      const opponent = go.activeFighter(battle, otherSide(side));
      const hidden = side === "enemy";
      const conditions = flags(fighter, battle, side);
      const statusClasses = new Map(fighter.statuses.map(({ definition, turns }) =>
        [definition.name + "（" + turns + "）", effectChipClass(definition.effect_id)]));
      const chips = conditions.length
        ? conditions.map(label => '<span class="effect-chip ' + (statusClasses.get(label) ?? 'effect-other') + '">' + esc(label) + '</span>').join("")
        : '<span class="effect-chip effect-none">なし</span>';
      const stats = BATTLE_INSPECT_GRAPH_STAT_KEYS.map(stat => {
        const value = stat === "speed" ? go.effectiveSpeed(battle, side) : go.statValue(fighter, stat, { opponent });
        return battleStatMarkup(stat, value, fighter.stages[stat], hidden);
      });
      if (!hidden) stats.push(battleStatMarkup("regen_value", fighter.base.regen_value));
      const passive = fighter.passive ? renderDexPassiveSection({
        passive: { ...fighter.passive, text: goStatText(fighter.passive.text) },
      }) : "";
      const resistances = [...data.elements.keys()].map((element) => {
        const multiplier = go.effectivenessFor(element, fighter.base, data.effectiveness);
        if (multiplier === 1) return "";
        const style = multiplier > 1 ? "is-weak" : "is-resistant";
        const label = multiplier > 1 ? "弱点" : "耐性";
        return `<div class="resistance-cell ${style}">${typeBadge(element)}<strong>${Math.round(multiplier * 100)}%</strong><span>${label}</span></div>`;
      });
      return `<div class="battle-inspect-header">
        <div>
          <div class="detail-title">${side === "player" ? "自分情報" : "相手情報"}</div>
          <div class="detail-subtitle">${esc(fighter.base.name)}</div>
        </div>
        <button class="small-button battle-inspect-back" type="button" data-go-inspect-back>戻る</button>
      </div>
      <div class="battle-inspect-body">
        <div class="dex-data-row battle-inspect-row"><span>状態</span><strong class="battle-info-chips">${chips}</strong></div>
        ${hidden ? "" : `<div class="dex-data-row battle-inspect-row"><span>回避率</span><strong>${go.evasionRate(fighter, battle.turn)}%</strong></div>
        <div class="dex-data-row battle-inspect-row"><span>EN回復</span><strong>${go.effectiveEnergyCharge(fighter, battle.turn)} EN / ターン</strong></div>`}
        <div class="battle-inspect-stats">
          <div class="detail-section-title">能力値</div>
          <div class="detail-stats battle-inspect-stat-list">${stats.join("")}</div>
        </div>
        ${passive}
        <div class="detail-section-title">属性耐性</div>
        <div class="resistance-grid battle-inspect-resistance-grid">${resistances.join("")}</div>
      </div>`;
    }

    function renderCommands() {
      const battle = match.battle;
      const candidate = phase === "switch" ? battle.pendingSwitch.side : turnSide;
      const actor = go.activeFighter(battle, candidate);
      const blocking = !["choice", "switch"].includes(phase);
      const forced = phase === "switch";
      const switching = forced || switchOpen;
      const inspecting = phase === "choice" && inspectSide;
      $("moveGrid").classList.toggle("is-hidden", Boolean(switching || inspecting || phase === "finished"));
      $("switchGrid").classList.toggle("is-hidden", !switching || phase === "finished");
      $("enemyInfoPanel").classList.toggle("is-hidden", phase !== "finished" && !inspecting);
      $("switchTab").disabled = blocking || forced || match.isAI(candidate);
      $("fightTab").classList.toggle("is-hidden", !switching && !inspecting);
      $("fightTab").disabled = blocking || forced;
      const dodgeIssue = blocking || match.isAI(candidate) ? "行動選択中のみ使用できます。"
        : go.checkAction(battle, candidate, { type: "move", moveId: DODGE });
      $("go-dodge").disabled = Boolean(dodgeIssue);
      $("go-dodge").title = dodgeIssue || "ENを使わず回避を試みる";
      $("go-battle-chart").disabled = blocking || forced;
      if (phase === "finished") {
        const label = battle.winner === "draw" ? "引き分け" : battle.winner === "player" ? "勝利" : "敗北";
        $("enemyInfoPanel").innerHTML = `<div class="battle-inspect-header"><strong class="detail-title">${label}</strong></div>
          <div class="setup-actions"><button class="primary-button" type="button" data-go-replay>${randomBattle || randomOpponent ? "同じ編成で再戦" : "再戦"}</button>
            ${randomBattle ? '<button class="primary-button" type="button" data-go-random-battle>再抽選して対戦</button>' : ""}
            ${randomOpponent ? '<button class="primary-button" type="button" data-go-reroll-opponent>相手を再抽選して対戦</button>' : ""}
            <button class="small-button" type="button" data-go-page="setup">編成画面へ</button>
            <button class="small-button" type="button" data-go-page="title">タイトルへ</button></div>`;
        return;
      }
      if (blocking) {
        $("moveGrid").querySelectorAll("button").forEach((button) => { button.disabled = true; });
        $("switchGrid").querySelectorAll("button").forEach((button) => { button.disabled = true; });
        return;
      }
      if (inspecting) {
        $("enemyInfoPanel").innerHTML = inspectMarkup(battle, inspectSide);
        return;
      }
      if (switching) {
        const indices = forced ? battle.pendingSwitch.candidates : go.switchTargets(battle, candidate);
        const prompt = forced ? SWITCHES[battle.pendingSwitch.reason] : "通常交代";
        $("switchGrid").innerHTML = `<div class="command-note">${LABELS[candidate]}の${prompt ?? "交代"}先を選択</div>` +
          (indices.map((index) => {
            const member = battle.teams[candidate][index];
            const reason = forced ? "" : go.checkAction(battle, candidate, { type: "switch", index });
            return `<button class="switch-button" type="button" data-go-switch="${index}" ${reason ? "disabled" : ""}>
              <span class="switch-name">${esc(member.base.name)}<span class="go-card-attributes">${attributes(member.base)}</span></span>
              <span class="switch-meta">体力 ${member.hp}/${member.maxHp} / ${energyBadge(member.energy)} ${esc(reason)}</span></button>`;
          }).join("") || '<div class="command-note">交代可能な控えがいません。</div>');
        return;
      }
      if (match.isAI(candidate)) {
        $("moveGrid").innerHTML = '<button class="move-button" type="button" data-go-turn>AIのターンを実行</button>';
        return;
      }
      const moveIds = [...new Set(actor.base.skillIds)].filter((id) => id !== DODGE);
      const expanded = moveIds.includes(expandedMoveId) ? data.skills.get(expandedMoveId) : null;
      if (expanded) {
        const issue = go.checkAction(battle, candidate, { type: "move", moveId: expandedMoveId });
        const releasing = actor.pending?.moveId === expandedMoveId;
        const kind = expanded.category === "attack" ? attackTypeLabel(expanded.attack_type) : "変化";
        const matchup = moveMatchup(expanded, go.activeFighter(battle, otherSide(candidate)), data);
        const affinity = matchup ? '<span class="go-move-affinity"><span class="go-move-matchup" aria-label="相手への属性相性 ×' +
          matchup.multiplier + '">×' + matchup.multiplier + '</span>' +
          (matchup.passiveImmune ? '<span class="go-move-immunity">パッシブで無効</span>' : '') + '</span>' : '';
        $("moveGrid").innerHTML = '<div class="command-note">' + LABELS[candidate] + 'の技を確認</div>' +
          '<div class="go-expanded-move"><button class="move-button move-element-' + esc(expanded.element ?? '') +
          '" type="button" data-go-move="' + esc(expandedMoveId) + '" ' + (issue ? 'disabled' : '') +
          ' aria-label="' + esc(expanded.name) + 'を使う">' +
          '<span class="move-name">' + esc(expanded.name) + '</span>' +
          '<span class="move-cost">' + energyBadge(geneOrderBattle.effectiveMoveCost(actor, expanded, battle.turn)) + '</span>' +
          '<span class="move-element">' + moveAttributes(expanded) + '</span>' +
          '<span class="move-kind" data-go-kind="' + esc(expanded.category === 'attack' ? expanded.attack_type : 'status') + '">' + esc(kind) + '</span>' +
          '<span class="move-power power-chip">威力 ' + (expanded.category === 'attack' ? releasing ? actor.pending.power : expanded.power : '—') + '</span>' +
          affinity + '<span class="move-text">' + esc(goStatText(expanded.text)) + '</span>' +
          (issue ? '<span class="go-move-issue">' + esc(goStatText(issue)) + '</span>' : '') +
          '</button><button class="small-button go-move-back" type="button" data-go-move-back>戻る</button></div>';
        return;
      }
      const buttons = [...new Set(actor.base.skillIds)].filter((id) => id !== DODGE).map((id) => {
        const move = data.skills.get(id);
        if (!move) return "";
        const issue = go.checkAction(battle, candidate, { type: "move", moveId: id });
        const releasing = actor.pending?.moveId === id;
        const kind = move.category === "attack" ? attackTypeLabel(move.attack_type) : "変化";
        return `<div class="go-move-card"><button class="move-button move-element-${esc(move.element ?? "")} ${issue ? "go-move-unavailable" : ""}"
          type="button" data-go-open-move="${esc(id)}" aria-label="${esc(move.name)}の詳細" aria-expanded="false">
          <span class="move-name">${esc(move.name)}</span><span class="move-cost">${energyBadge(geneOrderBattle.effectiveMoveCost(actor, move, battle.turn))}</span>
          <span class="move-element">${moveAttributes(move)}</span><span class="move-kind" data-go-kind="${esc(move.category === "attack" ? move.attack_type : "status")}">${esc(kind)}</span>
          <span class="move-power power-chip">威力 ${move.category === "attack" ? releasing ? actor.pending.power : move.power : "—"}</span></button></div>`;

      });
      $("moveGrid").innerHTML = `<div class="command-note">${LABELS[candidate]}の行動を選択</div>${buttons.join("")}`;
    }

    function start({ random = false, replay = false } = {}) {
      try {
        const next = replay ? lastMatchSettings : settings.mode === "random-enemy"
          ? randomOpponentSettings(data, settings.team.player) : settings;
        match = createMatch(data, next, { limit });
        lastMatchSettings = { mode: next.mode, team: { player: [...next.team.player], enemy: [...next.team.enemy] }, lead: { ...next.lead } };
        if (!replay) randomOpponent = settings.mode === "random-enemy";
      } catch (error) {
        $("go-team-notice").textContent = error.message;
        return;
      }
      epoch++;
      expandedMoveId = null;
      randomBattle = random;
      finishWait?.();
      motion?.cancel();
      phase = "choice";
      turnSide = "player";
      selected = {};
      switchOpen = false;
      inspectSide = null;
      $("go-official-log").replaceChildren();
      setPage("battle");
      currentBattleBgm = randomBattleModeBgmId(aiRandom);
      if ($("go-battle-bgm").checked && currentBattleBgm) playBgm(currentBattleBgm);
      for (const entry of match.battle.startEvents) appendLog(describeGeneOrderEvent(entry));
      message("");
      drawBoard(captureFrame(match.battle));
      renderCommands();
    }

    function startRandomBattle() {
      try {
        if (limit < RANDOM_TEAM_SIZE) throw new Error("現在の編成人数上限では3対3を開始できません。");
        const next = randomBattleSettings(data);
        Object.assign(settings, next);
        $("go-random-notice").textContent = "";
        renderSetup();
        start({ random: true });
      } catch (error) {
        $("go-random-notice").textContent = error.message;
        $("go-team-notice").textContent = error.message;
      }
    }

    function effectMotion(event) {
      const move = event.type === "move" && data.skills.get(event.moveId);
      const targetsEnemy = move?.category === "attack" || move?.target === "enemy";
      const target = targetsEnemy || ["reflected", "revenge"].includes(event.type) ? otherSide(event.side) : event.side;
      const sprite = $(target + "Sprite");
      const layer = $("battleAnimationLayer");
      motion?.cancel();
      layer.replaceChildren();
      const asset = move && data.moveAnimations.get(move.animation_id);
      if (asset && !["evaded", "passive-immune", "blocked", "position-miss"].includes(event.reason)) {
        const marker = document.createElement("div");
        marker.className = "battle-animation go-sheet";
        const a = (sprite.querySelector(".sprite-image") ?? sprite).getBoundingClientRect();
        const b = layer.getBoundingClientRect();
        Object.assign(marker.style, { left: (a.left + a.width / 2 - b.left) + "px", top: (a.top + a.height / 2 - b.top) + "px",
          width: asset.width + "px", height: asset.height + "px", backgroundImage: "url(" + asset.path + ")" });
        layer.append(marker);
        const frames = asset.order.map((cell, index) => {
          const point = animationFramePosition(cell, asset.columns, asset.width, asset.height);
          return { offset: index / asset.order.length, backgroundPosition: point.x + "px " + point.y + "px", easing: "steps(1, end)" };
        });
        frames.push({ ...frames.at(-1), offset: 1 });
        const duration = Math.max(PLAYBACK_TIMING.minimumAnimation, move.animation_duration_ms || Math.round(asset.order.length * 1000 / asset.fps));
        const iterations = Math.min(8, move.repeat_count || asset.repeatCount);
        motion = marker.animate(frames, { duration, iterations });
        return duration * iterations;
      }
      if (sprite && ["move", "residual", "faint", "switch", "replacement", "absorbed", "heal", "reflected", "revenge", "passive", "decoy-hit"].includes(event.type)) {
        const positive = ["absorbed", "heal", "passive"].includes(event.type);
        motion = sprite.animate?.([{ opacity: 0.78, filter: positive ? "brightness(1.45)" : "brightness(.8)" },
          { opacity: 1, filter: "none" }], { duration: PLAYBACK_TIMING.flash });
      }
      return PLAYBACK_TIMING.flash;
    }

    async function play(resolve) {
      const current = ++epoch;
      const running = match;
      phase = running.isAI("enemy") || running.isAI("player") ? "ai" : "resolving";
      renderCommands();
      try {
        await waitPlayback(PLAYBACK_TIMING.input, current);
        if (current !== epoch) return;
        let result = resolve();
        for (;;) {
          phase = "playback";
          for (let i = 0; i < result.events.length; i++) {
            if (current !== epoch) return;
            const event = result.events[i];
            const text = describeGeneOrderEvent(event);
            if (["move", "charge"].includes(event.type) && !skipping()) {
              message(goStatText(`${event.actor}の ${event.move}！`), true);
              await waitPlayback(PLAYBACK_TIMING.moveName, current);
              if (current !== epoch) return;
            }
            if (text && event.type === "move" && !skipping()) {
              await waitPlayback(effectMotion(event), current);
              if (current !== epoch) return;
              motion?.cancel();
              $("battleAnimationLayer").replaceChildren();
            }
            drawBoard(result.frames[i]);
            appendLog(text);
            if (text && !skipping()) {
              message(text, true);
              if (event.type !== "move") effectMotion(event);
              await waitPlayback(eventHold(event), current);
              if (current !== epoch) return;
            }
            if (["move", "charge", "switch", "replacement", "wait"].includes(event.type)) {
              await waitPlayback(PLAYBACK_TIMING.actionGap, current);
              if (current !== epoch) return;
            }
          }
          if (current !== epoch) return;
          if (!result.pendingSwitch || !running.isAI(result.pendingSwitch.side)) break;
          phase = "ai";
          result = running.resume();
        }
        await waitPlayback(PLAYBACK_TIMING.turnEnd, current);
        if (current !== epoch) return;
        const battle = running.battle;
        inspectSide = null;
        drawBoard(captureFrame(battle));
        $("battleAnimationLayer").replaceChildren();
        message("");
        selected = {};
        turnSide = "player";
        switchOpen = false;
        phase = battle.winner ? "finished" : battle.pendingSwitch ? "switch" : "choice";
        renderCommands();
      } catch (error) {
        if (current !== epoch) return;
        phase = running.battle.pendingSwitch ? "switch" : running.battle.winner ? "finished" : "choice";
        selected = {};
        turnSide = "player";
        appendLog(error.message);
        message("");
        renderCommands();
        console.error(error);
      }
    }

    function choose(action) {
      if (phase !== "choice" || !match) return;
      if (!match.isAI(turnSide)) {
        if (go.checkAction(match.battle, turnSide, action)) return;
        expandedMoveId = null;
        selected[turnSide] = action;
        inspectSide = null;
        if (settings.mode === "manual" && turnSide === "player") {
          turnSide = "enemy";
          switchOpen = false;
          renderCommands();
          return;
        }
      }
      play(() => match.resolve(selected));
    }

    shell.addEventListener("keydown", (event) => {
      const sprite = event.target.closest("[data-fighter-side]");
      if (sprite && (event.key === "Enter" || event.key === " ")) {
        event.preventDefault();
        openInspect(sprite.dataset.fighterSide);
      }
      if (event.repeat && event.target.closest("[data-go-move], [data-go-open-move], [data-go-move-back]")) {
        event.preventDefault();
        return;
      }
      if (event.key === "Escape" && expandedMoveId && !chartDialog.open) {
        const id = expandedMoveId;
        expandedMoveId = null;
        renderCommands();
        $("moveGrid").querySelector('[data-go-open-move="' + id + '"]')?.focus();
        return;
      }
      if (event.key === "Escape") {
        const overlay = [$("dexOverlay"), $("detailOverlay")].find((node) => node && !node.classList.contains("is-hidden"));
        if (overlay) {
          overlay.classList.add("is-hidden");
          returnFocus?.focus();
        }
      }
    });
    shell.addEventListener("click", (event) => {
      const sprite = event.target.closest("[data-fighter-side]");
      if (sprite) return openInspect(sprite.dataset.fighterSide);
      const control = event.target.closest("button");
      if (!control || control.disabled) return;
      const command = control.dataset;
      const battleAction = ["goMove", "goOpenMove", "goSwitch", "goTurn", "goReplay", "goRandomBattle", "goRerollOpponent"].some((key) => Object.hasOwn(command, key));
      // Opening and confirming a move are separate steps, even within a double-click.
      // choose() clears expandedMoveId on acceptance; resolving phases still reject actions.
      const moveCardStep = command.goOpenMove || (command.goMove && command.goMove === expandedMoveId);
      if (battleAction && event.detail > 1 && !moveCardStep) return;
      if (command.goPage) return showPage(command.goPage);
      if (Object.hasOwn(command, "goRandomBattle")) return startRandomBattle();
      if (Object.hasOwn(command, "goRerollOpponent")) return start();
      if (command.goOpenMove) {
        if (phase !== "choice") return;
        expandedMoveId = command.goOpenMove;
        renderCommands();
        $("moveGrid").querySelector("[data-go-move-back]")?.focus({ preventScroll: true });
        return;
      }
      if (Object.hasOwn(command, "goMoveBack")) {
        const id = expandedMoveId;
        expandedMoveId = null;
        renderCommands();
        $("moveGrid").querySelector('[data-go-open-move="' + id + '"]')?.focus({ preventScroll: true });
        return;
      }
      if (command.goSkillDetail) {
        const move = data.skills.get(command.goSkillDetail);
        if (!move || !["choice", "switch"].includes(phase)) return;
        skillDialog.querySelector(".go-skill-dialog-content").innerHTML = renderSkillDetail(move, {
          attributeMarkup: moveAttributes(move),
          description: goStatText(move.text),
          issue: goStatText(go.checkAction(match.battle, turnSide, { type: "move", moveId: move.skill_id })),
        });
        skillDialog.showModal();
        return;
      }
      if (Object.hasOwn(command, "goChart")) {
        chartDialog.showModal();
        return;
      }
      if (command.goClose) {
        $(command.goClose + "Overlay").classList.add("is-hidden");
        returnFocus?.focus();
      } else if (command.goDex) {
        showDex(command.goDex);
      } else if (command.goDetail) {
        returnFocus = control;
        renderDetail(command.goDetail);
      } else if (command.goSide || ["setupPlayerModeButton", "setupEnemyModeButton"].includes(control.id)) {
        side = command.goSide ?? (control.id === "setupPlayerModeButton" ? "player" : "enemy");
        renderSetup();
      } else if (command.goLead) {
        settings.lead[command.goTeam] = command.goLead;
        renderSetup();
      } else if (command.goRemove) {
        updateTeam(command.goTeam, settings.team[command.goTeam].filter((id) => id !== command.goRemove));
      } else if (command.goPick) {
        const ids = settings.team[side];
        if (fighterIssue(data.characterMap.get(command.goPick), data)) return;
        if (ids.includes(command.goPick)) updateTeam(side, ids.filter((id) => id !== command.goPick));
        else if (ids.length < (settings.mode === "random-enemy" ? RANDOM_TEAM_SIZE : limit)) updateTeam(side, [...ids, command.goPick]);
      } else if (control.id === "clearTeamButton") {
        updateTeam(side, []);
      } else if (control.id === "randomTeamButton") {
        const roster = data.characters.filter((base) => !fighterIssue(base, data)).map((base) => base.character_id);
        const size = Math.min(limit, 3, roster.length);
        updateTeam(side, Array.from({ length: size }, () => roster.splice(Math.floor(aiRandom() * roster.length), 1)[0]));
      } else if (control.id === "battleModeButton") {
        settings.mode = "random-enemy";
        side = "player";
        settings.lead.player = minimumSlotLead(settings.team.player, data);
        showPage("setup");
      } else if (control.id === "startButton" || Object.hasOwn(command, "goReplay")) {
        start({ random: Object.hasOwn(command, "goReplay") && randomBattle, replay: Object.hasOwn(command, "goReplay") });
      } else if (control.id === "switchTab" || control.id === "fightTab" || Object.hasOwn(command, "goInspectBack")) {
        if (phase !== "choice") return;
        inspectSide = null;
        expandedMoveId = null;
        switchOpen = control.id === "switchTab";
        renderCommands();
      } else if (command.goSwitch !== undefined) {
        const index = Number(command.goSwitch);
        if (phase === "switch") play(() => match.resume(index));
        else choose({ type: "switch", index });
      } else if (command.goMove) {
        choose({ type: "move", moveId: command.goMove });
      } else if (Object.hasOwn(command, "goTurn")) {
        choose({ type: "wait" });
      }
    });
    $("go-fast-battle").addEventListener("change", (event) => {
      arena.classList.toggle("go-fast", event.target.checked);
      if (event.target.checked) {
        motion?.cancel();
        $("battleAnimationLayer").replaceChildren();
        finishWait?.();
      }
    });
    $("go-battle-bgm").addEventListener("change", (event) => {
      if (event.target.checked && match && currentBattleBgm) playBgm(currentBattleBgm);
      else stopBgm();
    });
    $("go-official-mode").addEventListener("change", (event) => {
      settings.mode = event.target.value;
      if (settings.mode === "random-enemy") settings.lead.player = minimumSlotLead(settings.team.player, data);
      renderSetup();
    });
    setPage("title");
  }

  return { stageMarks, battleStatMarkup, moveMatchup, mount, createMatch, randomOpponentSettings, randomBattleSettings, fighterIssue, captureFrame, PLAYBACK_TIMING, eventHold };
})();
