const GO_MOVE_ART = Object.fromEntries([
  ["attack_hit01", 70, 70, 24],
  ["magic_enhance02", 115, 110, 32],
  ["magic_fire01", 125, 125, 24],
  ["magic_shieldbreak01", 135, 121, 40],
  ["magic_sonicwave01", 240, 170, 24],
].map(([id, width, height, frames]) => [id, {
  path: "./asset/battle-animation/" + id + ".png", width, height, columns: 8,
  order: Array.from({ length: frames }, (_, index) => index),
}]));

const geneOrderUI = (() => {
  const SIDES = ["player", "enemy"];
  const LABELS = { player: "自分", enemy: "相手" };
  const STATS = { hp: "体力", phy_atk: "物理攻撃", phy_def: "物理防御", sp_atk: "特殊攻撃", sp_def: "特殊防御", speed: "敏捷" };
  const MODES = { enemy: "プレイヤー対AI", manual: "手動対手動", auto: "AI対AI" };
  const SWITCHES = { "tail-purge": "テールパージ", relay: "パワーリレー", "post-attack": "燕返し", replacement: "戦闘不能後の補充" };
  const TEAM_LIMIT = 4;
  const DODGE = "skill_000";
  const BATTLE_BGM = "go_free_battle";
  const aiRandom = () => crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32;
  const otherSide = (side) => side === "player" ? "enemy" : "player";

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

  function captureFrame(battle) {
    const teams = Object.fromEntries(SIDES.map((side) => [side, battle.teams[side].map((fighter) => {
      const { base, hp, maxHp, energy, fainted, dodgeActive, halfGuard, bind, pending, decoy, stages, statuses, defenses, timedEffects, passive } = fighter;
      return { base, hp, maxHp, energy, fainted, dodgeActive, halfGuard, bind: bind && { turns: bind.turns },
        pending: pending && { ...pending }, decoy: decoy && { ...decoy }, stages: { ...stages },
        statuses: statuses.map((status) => ({ ...status })), defenses: new Map([...defenses].map(([id, entry]) => [id, { ...entry }])),
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

  function mount(root, data, { limit = TEAM_LIMIT } = {}) {
    const template = document.getElementById("legacy-screens");
    const debug = document.querySelector(".go-preview");
    const go = geneOrderBattle;
    const esc = escapeHtml;
    data.bgmMap.set(BATTLE_BGM, { bgm_path: "./asset/bgm/free-battle.mp3" });
    const clone = (selector) => template.content.querySelector(selector).cloneNode(true);
    const shell = document.createElement("main");
    shell.className = "app-shell";
    const title = clone("#titleView");
    const setup = clone("#setupView");
    const arena = clone("#battleView");
    const dex = clone("#dexOverlay");
    title.querySelector(".title-stage").innerHTML = `
      <div class="team-panel go-title-panel">
        <h1>GENE ORDER</h1><p>v0.64</p>
        <button class="primary-button" id="battleModeButton" type="button">バトルモード</button>
        <div class="setup-actions">
          <button class="small-button" data-go-page="dex" type="button">図鑑</button>
          <button class="small-button" data-go-page="debug" type="button">デバッグ</button>
        </div>
      </div>`;
    setup.querySelector(".brand-mark").textContent = "GO";
    setup.querySelector(".brand-sub").textContent = "GENE ORDER";
    setup.querySelector(".roster-panel .panel-title").textContent = "キャラクター";
    setup.querySelector("#randomBattleButton").remove();
    setup.querySelector(".team-panel").insertAdjacentHTML("beforeend", `
      <label class="go-mode">対戦モード<select id="go-official-mode">
        ${Object.entries(MODES).map(([key, label]) => `<option value="${key}">${label}</option>`).join("")}
      </select></label>
      <p class="command-note" id="go-team-notice" aria-live="polite"></p>
      <button type="button" class="small-button" data-go-page="title">タイトルへ</button>`);
    arena.querySelector("#battleTutorialOverlay").remove();
    arena.querySelector("#exchangePanel").remove();
    arena.querySelector("#glossaryPanel").innerHTML = "<p>HP＝体力、PA＝物理攻撃、PD＝物理防御、SA＝特殊攻撃、SD＝特殊防御、SP＝敏捷。回復力は個体の回復力を表します。ENは技の使用に必要です。</p>";
    arena.querySelector(".battle-card").insertAdjacentHTML("beforeend", `
      <div class="go-battle-footer">
        <label><input type="checkbox" id="go-fast-battle"> 演出をスキップ</label>
        <label><input type="checkbox" id="go-battle-bgm" checked> BGM</label>
        <button type="button" class="small-button" data-go-page="setup">編成へ</button>
        <button type="button" class="small-button" data-go-page="title">タイトルへ</button>
        <details><summary>戦闘ログ</summary><ol id="go-official-log"></ol></details>
      </div>`);
    arena.querySelector("#battleLog").setAttribute("role", "status");
    dex.setAttribute("role", "dialog");
    dex.setAttribute("aria-modal", "true");
    shell.append(title, setup, arena, dex);
    root.append(shell);
    const $ = (id) => shell.querySelector("#" + id);
    const debugBack = document.createElement("button");
    debugBack.className = "small-button";
    debugBack.type = "button";
    debugBack.textContent = "タイトルへ";
    debugBack.addEventListener("click", () => showPage("title"));
    debug.prepend(debugBack);

    const settings = { team: { player: [], enemy: [] }, lead: {}, mode: "enemy" };
    let side = "player";
    let returnFocus;
    let match;
    let phase = "choice";
    let turnSide = "player";
    let selected = {};
    let switchOpen = false;
    let inspectSide = null;
    let epoch = 0;
    let motion;

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
      epoch++;
      motion?.cancel();
      match = null;
      stopBgm();
      $("battleAnimationLayer").replaceChildren();
      setPage(next);
      if (next === "setup") renderSetup();
    }

    const typeBadge = (id, hud = false) => {
      const value = data.elements.get(id);
      return value ? goAttributeIcon(id, value.name) : "";
    };
    const attributes = (base, hud) => [base.element_1, base.element_2].filter(Boolean).map((id) => typeBadge(id, hud)).join(" ") || "属性未設定";
    const picture = (base, className) => base.imageSrc
      ? `<img class="${className}" src="${esc(base.imageSrc)}" alt="${esc(base.name)}">` : '<span class="go-missing-image">画像未設定</span>';

    function profile(base) {
      const skills = base.skillIds.map((id) => {
        const move = data.skills.get(id);
        if (!move) return `<p>${esc(id)}（未設定）</p>`;
        const issue = go.moveAvailability(move, data).issues.join("、");
        return `<div class="detail-skill"><strong>${esc(move.name)} ${typeBadge(move.element)}</strong>
          <p>${esc(goStatText(move.text))}${issue ? `（未対応 ${esc(issue)}）` : ""}</p></div>`;
      });
      const passive = data.passives.get(base.passive_id);
      const details = passive ? `${esc(passive.name)}${passive.status === "implemented" ? "" : "（未対応）"}　${esc(goStatText(passive.text))}` : "未設定";
      const species = data.speciesMap.get(base.species_id)?.name || "種族未設定";
      const evasion = base.evasion_percent == null ? "未設定" : `${base.evasion_percent}%`;
      return `<div class="dex-profile">
        <div class="detail-image-frame dex-image-frame">${picture(base, "detail-image")}</div>
        <div class="dex-summary"><div class="detail-title">${esc(base.name)}</div>
          <div class="detail-subtitle">${attributes(base)}　${esc(species)}</div>
          <div class="dex-data-row"><span>スロット</span><strong>${esc(base.slot)}</strong></div>
          <div class="dex-data-row"><span>EN回復</span><strong>${energyBadge(base.energy_charge)}</strong></div>
          <div class="dex-data-row"><span>回避率</span><strong>${evasion}</strong></div></div>
      </div>
      <div class="detail-stats dex-stats">${Object.keys(STATS).concat("regen_value").map((stat) => goCharacterStat(stat, base[stat])).join("")}</div>
      <div class="detail-section-title">パッシブ</div><p>${details}</p>
      <div class="detail-section-title">習得技</div>${skills.join("") || "<p>未設定</p>"}`;
    }

    function showDex(id) {
      const base = data.characterMap.get(id);
      if (!base) return;
      $("dexPanel").innerHTML = `<div class="detail-header"><div class="detail-title">図鑑</div>
        <button class="small-button dex-close" type="button" data-go-close="dex">閉じる</button></div>
        <div class="dex-layout"><aside class="dex-list" aria-label="キャラクター一覧">
        ${data.characters.map((entry) => `<button type="button" class="dex-list-button ${entry === base ? "is-selected" : ""}"
          data-go-dex="${esc(entry.character_id)}"><span>${esc(entry.name)}</span>${attributes(entry)}</button>`).join("")}
        </aside><section class="dex-content">${profile(base)}</section></div>`;
      dex.classList.remove("is-hidden");
      $("dexPanel").querySelector(".dex-close").focus();
    }

    function renderSetup() {
      $("setupPanelTitle").textContent = LABELS[side] + "チーム";
      for (const candidate of SIDES) {
        const tab = $(candidate === "player" ? "setupPlayerModeButton" : "setupEnemyModeButton");
        tab.classList.toggle("is-active", side === candidate);
        tab.setAttribute("aria-pressed", String(side === candidate));
      }
      $("go-official-mode").value = settings.mode;
      $("selectedSlots").innerHTML = SIDES.map((candidate) => `
        <section class="setup-party-slots ${side === candidate ? "is-active" : ""}">
          <button type="button" class="team-slot-summary" data-go-side="${candidate}">
            <span>${LABELS[candidate]}チーム</span><strong>${settings.team[candidate].length}/${limit}体</strong>
          </button>
          ${settings.team[candidate].map((id) => {
            const base = data.characterMap.get(id);
            const leading = settings.lead[candidate] === id;
            return `<div class="selected-slot is-filled"><div class="slot-name">${esc(base.name)}${leading ? "（先発）" : ""}</div>
              <div class="slot-meta">${attributes(base)} スロット ${esc(base.slot)}</div>
              <div class="setup-actions">
                <button type="button" class="small-button" data-go-lead="${esc(id)}" data-go-team="${candidate}" ${leading ? "disabled" : ""}>先発にする</button>
                <button type="button" class="small-button" data-go-remove="${esc(id)}" data-go-team="${candidate}">外す</button>
              </div></div>`;
          }).join("") || '<div class="selected-slot">未編成</div>'}
        </section>`).join("");
      $("rosterGrid").innerHTML = data.characters.map((base) => {
        const id = base.character_id;
        const issue = fighterIssue(base, data);
        const chosen = settings.team[side].includes(id);
        const full = settings.team[side].length >= limit && !chosen;
        return `<article class="character-card ${chosen ? "is-selected" : ""}">
          <button class="card-select-button" type="button" data-go-pick="${esc(id)}" aria-pressed="${chosen}" ${issue || full ? "disabled" : ""}>
            <div class="card-topline"><span class="card-name">${esc(base.name)}</span><span>${attributes(base)}</span></div>
            <div class="card-image-frame">${picture(base, "card-image")}</div>
            <div class="card-slot-meta">スロット ${esc(base.slot)}${issue ? ` · ${esc(issue)}` : ""}</div>
          </button>
          <button class="detail-button" type="button" data-go-detail="${esc(id)}">詳細</button>
        </article>`;
      }).join("");
      const ready = SIDES.every((candidate) => settings.team[candidate].length && settings.lead[candidate]);
      $("startButton").disabled = !ready;
      $("go-team-notice").textContent = ready ? `各側 最大${limit}体（暫定）` : "両チームにキャラクターを選択してください。";
    }

    function updateTeam(candidate, ids) {
      settings.team[candidate] = ids;
      if (!ids.includes(settings.lead[candidate])) settings.lead[candidate] = ids[0];
      renderSetup();
    }

    function renderDetail(id) {
      const base = data.characterMap.get(id);
      if (!base) return;
      $("detailPanel").innerHTML = `<div class="detail-header"><div class="detail-title">キャラクター詳細</div>
        <button class="small-button detail-close" type="button" data-go-close="detail">閉じる</button></div>${profile(base)}`;
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
      return labels;
    }

    function drawBoard(frame) {
      const status = [];
      for (const candidate of SIDES) {
        const index = frame.active[candidate];
        const team = frame.teams[candidate];
        const fighter = team[index];
        const hud = $(candidate + "Hud");
        const sprite = $(candidate + "Sprite");
        const activeFlags = flags(fighter, frame, candidate);
        const meterWidth = 100 * fighter.hp / fighter.maxHp;
        const key = fighter.base.character_id + "/" + index;
        if (hud.dataset.renderedFighterKey !== key) {
          hud.dataset.renderedFighterKey = key;
          hud.innerHTML = `<div class="hud-row"><div class="hud-name">${attributes(fighter.base, true)}
          <span class="hud-character-name">${esc(fighter.base.name)}</span></div></div>
          <div class="hp-line"><span>体力</span><div class="meter"><div class="meter-fill hp-fill ${meterWidth <= 28 ? "is-low" : ""}"
            style="width:${meterWidth}%"></div></div><span class="hud-value hp-value"></span></div>
          <div class="energy-line"><span>EN</span><div class="meter energy-meter">${renderEnergySegments({ energy: fighter.energy, maxEnergy: go.MAX_ENERGY })}</div>
            <span class="hud-value go-en-value"></span></div>
          <div class="battle-info-stack"><div class="battle-info-line"><span>ランク</span>
            <span class="battle-info-chips go-hud-ranks"></span></div>
          <div class="battle-info-line"><span>状態</span><span class="battle-info-chips go-hud-flags"></span></div>
          <div class="battle-info-line"><span>パッシブ</span><span class="battle-info-chips">${esc(fighter.passive?.name ?? "未設定")}</span></div></div>
          <div class="party-pips"></div>`;
        }
        const bar = hud.querySelector(".hp-fill");
        bar.style.width = meterWidth + "%";
        bar.classList.toggle("is-low", meterWidth <= 28);
        hud.querySelector(".hp-value").textContent = fighter.hp + "/" + fighter.maxHp;
        hud.querySelector(".go-en-value").textContent = fighter.energy + "/" + go.MAX_ENERGY;
        hud.querySelectorAll(".energy-segment").forEach((segment, slot) => segment.classList.toggle("is-filled", slot < fighter.energy));
        hud.querySelector(".go-hud-ranks").textContent = Object.entries(fighter.stages)
          .map(([stat, value]) => STATS[stat] + (value >= 0 ? "+" : "") + value).join(" ");
        hud.querySelector(".go-hud-flags").textContent = activeFlags.join(" / ") || "なし";
        hud.querySelector(".party-pips").innerHTML = team.map((member, i) =>
          `<span class="pip ${member.fainted ? "is-fainted" : "is-alive"} ${index === i ? "is-active" : ""}"></span>`).join("");
        if (sprite.dataset.renderedFighterKey !== key) {
          sprite.dataset.renderedFighterKey = key;
          sprite.innerHTML = renderSprite({ id: fighter.base.character_id, name: fighter.base.name, base: fighter.base }, candidate, index,
            attributes(fighter.base), '<span class="go-missing-image">画像未設定</span>');
        }
        sprite.classList.toggle("is-position-hidden", !fighter.fainted && fighter.pending?.definition.battle_effect_group === "position");
        sprite.classList.toggle("go-fainted", fighter.fainted);
        status.push(...activeFlags.map((label) => `<div class="battle-status-line">${LABELS[candidate]}:${esc(label)}</div>`));
      }
      $("battleStatusPanel").innerHTML = status.join("") || '<div class="battle-status-empty">状態効果なし</div>';
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
      inspectSide = candidate;
      switchOpen = false;
      renderCommands();
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
      $("dexButton").disabled = blocking || forced;
      $("glossaryButton").disabled = blocking || forced;
      if (phase === "finished") {
        const label = battle.winner === "draw" ? "引き分け" : battle.winner === "player" ? "勝利" : "敗北";
        $("enemyInfoPanel").innerHTML = `<div class="battle-inspect-header"><strong class="detail-title">${label}</strong></div>
          <div class="setup-actions"><button class="primary-button" type="button" data-go-replay>再戦</button>
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
        const inspected = go.activeFighter(battle, inspectSide);
        const opponent = go.activeFighter(battle, otherSide(inspectSide));
        const rows = Object.keys(inspected.stages).map((stat) => {
          const { multiplier } = go.effectiveStat(inspected, stat, { opponent });
          const value = stat === "speed" ? go.effectiveSpeed(battle, inspectSide) : go.statValue(inspected, stat, { opponent });
          const rank = inspected.stages[stat];
          return `<div class="dex-data-row"><span>${STATS[stat]}</span><strong>${value}（ランク ${rank >= 0 ? "+" : ""}${rank}${multiplier === 1 ? "" : "、パッシブ ×" + multiplier}）</strong></div>`;
        }).join("");
        $("enemyInfoPanel").innerHTML = `<div class="battle-inspect-header"><strong class="detail-title">${esc(inspected.base.name)} ${attributes(inspected.base)}</strong>
          <button class="small-button battle-inspect-back" type="button" data-go-inspect-back>戻る</button></div>${rows}`;
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
              <span class="switch-name">${esc(member.base.name)} ${attributes(member.base)}</span>
              <span class="switch-meta">体力 ${member.hp}/${member.maxHp} / ${energyBadge(member.energy)} ${esc(reason)}</span></button>`;
          }).join("") || '<div class="command-note">交代可能な控えがいません。</div>');
        return;
      }
      if (match.isAI(candidate)) {
        $("moveGrid").innerHTML = '<button class="move-button" type="button" data-go-turn>AIのターンを実行</button>';
        return;
      }
      const buttons = [...new Set([...actor.base.skillIds, DODGE])].map((id) => {
        const move = data.skills.get(id);
        if (!move) return "";
        const issue = go.checkAction(battle, candidate, { type: "move", moveId: id });
        const releasing = actor.pending?.moveId === id;
        const kind = move.category === "attack" ? attackTypeLabel(move.attack_type) : "変化";
        return `<button class="move-button move-element-${esc(move.element ?? "")}" type="button" data-go-move="${esc(id)}"
          ${issue ? "disabled" : ""} title="${esc(goStatText(issue || move.text))}">
          <span class="move-name">${id === DODGE ? "共通回避" : esc(move.name)}</span>
          <span class="move-cost">${energyBadge(releasing ? 0 : move.cost)}</span>
          <span class="move-element">${typeBadge(move.element)}</span><span class="move-kind">${esc(kind)}</span>
          <span class="move-power power-chip">威力 ${move.category === "attack" ? releasing ? actor.pending.power : move.power : "—"}</span>
          <span class="move-text">優先度 ${move.priority} · ${esc(goStatText(move.text))}${issue ? ` · ${esc(issue)}` : ""}</span></button>`;
      });
      const wait = go.checkAction(battle, candidate, { type: "wait" });
      $("moveGrid").innerHTML = `<div class="command-note">${LABELS[candidate]}の行動を選択</div>${buttons.join("")}
        <button class="move-button move-save-energy-button" type="button" data-go-wait ${wait ? "disabled" : ""}><span class="move-name">待機</span>
          <span class="move-text">${esc(wait || "ターン終了時のEN回復を待つ")}</span></button>`;
    }

    function start() {
      try {
        match = createMatch(data, settings, { limit });
      } catch (error) {
        $("go-team-notice").textContent = error.message;
        return;
      }
      epoch++;
      motion?.cancel();
      phase = "choice";
      turnSide = "player";
      selected = {};
      switchOpen = false;
      inspectSide = null;
      $("go-official-log").replaceChildren();
      $("glossaryPanel").classList.add("is-hidden");
      setPage("battle");
      if ($("go-battle-bgm").checked) playBgm(BATTLE_BGM);
      for (const entry of match.battle.startEvents) appendLog(describeGeneOrderEvent(entry));
      message("");
      drawBoard(captureFrame(match.battle));
      renderCommands();
    }

    function effectMotion(event) {
      const move = event.type === "move" && data.skills.get(event.moveId);
      const hit = move?.category === "attack";
      const target = hit || ["reflected", "revenge"].includes(event.type) ? otherSide(event.side) : event.side;
      const sprite = $(target + "Sprite");
      const layer = $("battleAnimationLayer");
      motion?.cancel();
      layer.replaceChildren();
      const asset = move && GO_MOVE_ART[move.animation_id];
      if (asset && !["evaded", "passive-immune", "blocked", "position-miss"].includes(event.reason)) {
        const marker = document.createElement("div");
        marker.className = "battle-animation go-sheet";
        const a = sprite.getBoundingClientRect();
        const b = layer.getBoundingClientRect();
        Object.assign(marker.style, { left: (a.left + a.width / 2 - b.left) + "px", top: (a.top + a.height / 2 - b.top) + "px",
          width: asset.width + "px", height: asset.height + "px", backgroundImage: "url(" + asset.path + ")" });
        layer.append(marker);
        const frames = asset.order.map((cell) => {
          const point = animationFramePosition(cell, asset.columns, asset.width, asset.height);
          return { backgroundPosition: point.x + "px " + point.y + "px", easing: "steps(1, end)" };
        });
        const duration = Math.min(450, Math.max(160, move.animation_duration_ms || 250));
        motion = marker.animate(frames, { duration });
        return duration;
      }
      if (sprite && ["move", "residual", "faint", "switch", "replacement", "absorbed", "heal", "reflected", "revenge", "passive", "decoy-hit"].includes(event.type)) {
        const positive = ["absorbed", "heal", "passive"].includes(event.type);
        motion = sprite.animate?.([{ opacity: 0.78, filter: positive ? "brightness(1.45)" : "brightness(.8)" },
          { opacity: 1, filter: "none" }], { duration: 130 });
      }
      return 130;
    }

    async function play(resolve) {
      const current = ++epoch;
      const running = match;
      phase = running.isAI("enemy") || running.isAI("player") ? "ai" : "resolving";
      renderCommands();
      try {
        let result = resolve();
        for (;;) {
          phase = "playback";
          for (let i = 0; i < result.events.length; i++) {
            if (current !== epoch) return;
            const event = result.events[i];
            const text = describeGeneOrderEvent(event);
            drawBoard(result.frames[i]);
            appendLog(text);
            const fast = $("go-fast-battle").checked || globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
            if (text && !fast) {
              message(text, true);
              const delay = effectMotion(event);
              await new Promise((done) => setTimeout(done, delay));
            }
          }
          if (current !== epoch) return;
          if (!result.pendingSwitch || !running.isAI(result.pendingSwitch.side)) break;
          phase = "ai";
          result = running.resume();
        }
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
        selected[turnSide] = action;
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
      if (event.key === "Escape") {
        const overlay = [$("dexOverlay"), $("detailOverlay")].find((node) => !node.classList.contains("is-hidden"));
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
      const battleAction = ["goMove", "goSwitch", "goWait", "goTurn", "goReplay"].some((key) => Object.hasOwn(command, key));
      if (battleAction && event.detail > 1) return;
      if (command.goPage) return showPage(command.goPage);
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
        else if (ids.length < limit) updateTeam(side, [...ids, command.goPick]);
      } else if (control.id === "clearTeamButton") {
        updateTeam(side, []);
      } else if (control.id === "randomTeamButton") {
        const roster = data.characters.filter((base) => !fighterIssue(base, data)).map((base) => base.character_id);
        const size = Math.min(limit, 3, roster.length);
        updateTeam(side, Array.from({ length: size }, () => roster.splice(Math.floor(aiRandom() * roster.length), 1)[0]));
      } else if (control.id === "battleModeButton") {
        showPage("setup");
      } else if (control.id === "startButton" || Object.hasOwn(command, "goReplay")) {
        start();
      } else if (control.id === "dexButton") {
        showPage("dex");
      } else if (control.id === "glossaryButton") {
        $("glossaryPanel").classList.toggle("is-hidden");
      } else if (control.id === "switchTab" || control.id === "fightTab" || Object.hasOwn(command, "goInspectBack")) {
        if (phase !== "choice") return;
        inspectSide = null;
        switchOpen = control.id === "switchTab";
        renderCommands();
      } else if (command.goSwitch !== undefined) {
        const index = Number(command.goSwitch);
        if (phase === "switch") play(() => match.resume(index));
        else choose({ type: "switch", index });
      } else if (command.goMove) {
        choose({ type: "move", moveId: command.goMove });
      } else if (Object.hasOwn(command, "goWait") || Object.hasOwn(command, "goTurn")) {
        choose({ type: "wait" });
      }
    });
    $("go-fast-battle").addEventListener("change", (event) => arena.classList.toggle("go-fast", event.target.checked));
    $("go-battle-bgm").addEventListener("change", (event) => {
      if (event.target.checked && match) playBgm(BATTLE_BGM);
      else stopBgm();
    });
    $("go-official-mode").addEventListener("change", (event) => { settings.mode = event.target.value; });
    setPage("title");
  }

  return { mount, createMatch, fighterIssue, captureFrame };
})();
