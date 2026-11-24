import { parseSentenceToChoices } from './parser.js';

const STORAGE_KEYS = {
  theme: 'qd_theme',
  lists: 'qd_saved_lists',
  locks: 'qd_locked_decisions',
};

// Unbiased random integer in [0, max - 1]
function randomInt(max) {
  if (max <= 1) return 0;
  const buf = new Uint32Array(1);
  const limit = Math.floor(0xffffffff / max) * max;
  let value;
  do {
    crypto.getRandomValues(buf);
    value = buf[0];
  } while (value >= limit);
  return value % max;
}

// Tactile haptic engine:
// - Android/Chrome: navigator.vibrate with distinct tap / tick / lock patterns
// - iOS Safari 17.4+: native Taptic Engine click via hidden <input type="checkbox" switch>
let iosHapticLabel = null;
function initIosHapticSwitch() {
  if (typeof document === 'undefined') return;
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.setAttribute('switch', '');
  input.id = 'qd-ios-haptic';
  input.tabIndex = -1;
  input.setAttribute('aria-hidden', 'true');
  input.style.cssText = 'position:fixed;opacity:0;pointer-events:none;width:1px;height:1px;left:-9999px;';

  const label = document.createElement('label');
  label.htmlFor = input.id;
  label.setAttribute('aria-hidden', 'true');
  label.style.cssText = 'position:fixed;opacity:0;pointer-events:none;width:1px;height:1px;left:-9999px;';

  document.body.append(input, label);
  iosHapticLabel = label;
}

function haptic(kind = 'tap') {
  const patterns = {
    tap: 8,
    tick: 6,
    launch: [14],
    lock: [18, 36, 28],
  };
  const pattern = patterns[kind] ?? 10;

  if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
    navigator.vibrate(pattern);
    return;
  }

  // Fallback for iOS Safari 17.4+ Taptic feedback on user-gesture taps
  if (iosHapticLabel) {
    iosHapticLabel.click();
  }
}

function loadJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function saveJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Ignore storage quota errors
  }
}

// Persistent locked decisions per mode (survives page refresh so users cannot re-roll)
const savedLocks = loadJSON(STORAGE_KEYS.locks, {});

// State
const state = {
  mode: 'pick', // 'pick' | 'coin' | 'dice'
  choices: Array.isArray(savedLocks.pick?.choices) ? [...savedLocks.pick.choices] : [],
  savedLists: loadJSON(STORAGE_KEYS.lists, []),
  isAnimating: false,
  coinRotation: savedLocks.coin?.isHeads === false ? 180 : 0,
  diceSides: savedLocks.dice?.sides || 6,
  diceValue: savedLocks.dice?.value || 6,
  locks: {
    pick: savedLocks.pick || null, // { choices, winnerIndex, winner }
    coin: savedLocks.coin || null, // { headsLabel, tailsLabel, isHeads, winner }
    dice: savedLocks.dice || null, // { sides, value }
  },
};

function persistLocks() {
  saveJSON(STORAGE_KEYS.locks, state.locks);
}

// Elements
const els = {
  themeToggle: document.getElementById('theme-toggle'),
  tabs: [...document.querySelectorAll('.tab-btn')],
  panels: {
    pick: document.getElementById('panel-pick'),
    coin: document.getElementById('panel-coin'),
    dice: document.getElementById('panel-dice'),
  },
  inputCard: document.querySelector('.input-card'),
  sentenceInput: document.getElementById('sentence-input'),
  choiceCount: document.getElementById('choice-count'),
  choiceChips: document.getElementById('choice-chips'),
  saveListBtn: document.getElementById('save-list-btn'),
  clearChoicesBtn: document.getElementById('clear-choices-btn'),
  manualAddForm: document.getElementById('manual-add-form'),
  manualOptionInput: document.getElementById('manual-option-input'),
  savedListsBlock: document.getElementById('saved-lists-block'),
  savedLists: document.getElementById('saved-lists'),
  pickResultCard: document.getElementById('pick-result-card'),
  pickResultValue: document.getElementById('pick-result-value'),
  coinHeadsInput: document.getElementById('coin-heads-input'),
  coinTailsInput: document.getElementById('coin-tails-input'),
  coinStageBtn: document.getElementById('coin-stage-btn'),
  coinEl: document.getElementById('coin-el'),
  coinResultCard: document.getElementById('coin-result-card'),
  coinResultValue: document.getElementById('coin-result-value'),
  dicePresetBtns: [...document.querySelectorAll('.pill-btn[data-sides]')],
  customSidesInput: document.getElementById('custom-sides-input'),
  customSidesWrap: document.querySelector('.custom-sides'),
  diceStageBtn: document.getElementById('dice-stage-btn'),
  dieEl: document.getElementById('die-el'),
  dieFace: document.getElementById('die-face'),
  diceResultCard: document.getElementById('dice-result-card'),
  diceResultEyebrow: document.getElementById('dice-result-eyebrow'),
  diceResultValue: document.getElementById('dice-result-value'),
  primaryActionBtn: document.getElementById('primary-action-btn'),
};

// Theme
function initTheme() {
  const saved = localStorage.getItem(STORAGE_KEYS.theme);
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  document.documentElement.dataset.theme = saved || (prefersDark ? 'dark' : 'light');
}

els.themeToggle.addEventListener('click', () => {
  haptic('tap');
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  localStorage.setItem(STORAGE_KEYS.theme, next);
});

// Mode Switching
function setMode(mode) {
  state.mode = mode;
  for (const tab of els.tabs) {
    const active = tab.dataset.mode === mode;
    tab.classList.toggle('is-active', active);
    tab.setAttribute('aria-selected', String(active));
  }
  for (const [key, panel] of Object.entries(els.panels)) {
    const active = key === mode;
    panel.hidden = !active;
    panel.classList.toggle('is-active', active);
  }
  updateDock();
}

els.tabs.forEach((tab) => {
  tab.addEventListener('click', () => {
    haptic('tap');
    setMode(tab.dataset.mode);
  });
});

// Dock Button State
function updateDock() {
  const locked = Boolean(state.locks[state.mode]);
  els.primaryActionBtn.classList.toggle('is-secondary-mode', locked);

  if (state.mode === 'pick') {
    els.primaryActionBtn.textContent = locked ? 'Start New Decision' : 'Decide';
    els.primaryActionBtn.disabled = locked
      ? state.isAnimating
      : state.choices.length < 2 || state.isAnimating;
  } else if (state.mode === 'coin') {
    els.primaryActionBtn.textContent = locked ? 'Start New Flip' : 'Flip Coin';
    els.primaryActionBtn.disabled = state.isAnimating;
  } else {
    els.primaryActionBtn.textContent = locked ? 'Start New Roll' : `Roll d${state.diceSides}`;
    els.primaryActionBtn.disabled = state.isAnimating;
  }
}

// Render Picker UI & Lock State
function renderPicker(highlightIndex = -1) {
  const locked = Boolean(state.locks.pick);
  const activeHighlight = locked ? state.locks.pick.winnerIndex : highlightIndex;

  els.inputCard.classList.toggle('is-locked', locked);
  els.sentenceInput.disabled = locked;
  els.manualAddForm.hidden = locked;

  els.choiceCount.textContent = String(state.choices.length);
  els.clearChoicesBtn.hidden = locked || state.choices.length === 0;
  els.saveListBtn.hidden = locked || state.choices.length < 2;

  els.choiceChips.innerHTML = '';
  state.choices.forEach((choice, idx) => {
    const chip = document.createElement('span');
    chip.className = 'choice-chip';
    if (idx === activeHighlight) chip.classList.add('is-highlighted');
    else if (locked) chip.classList.add('is-dimmed');

    const label = document.createElement('span');
    label.textContent = choice;
    chip.append(label);

    if (!locked) {
      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.setAttribute('aria-label', `Remove ${choice}`);
      removeBtn.textContent = '×';
      removeBtn.addEventListener('click', () => {
        state.choices.splice(idx, 1);
        renderPicker();
      });
      chip.append(removeBtn);
    }

    els.choiceChips.appendChild(chip);
  });

  if (locked) {
    els.pickResultValue.textContent = state.locks.pick.winner;
    els.pickResultCard.hidden = false;
  } else {
    els.pickResultCard.hidden = true;
  }

  renderSavedLists();
  updateDock();
}

function renderSavedLists() {
  const locked = Boolean(state.locks.pick);
  els.savedListsBlock.hidden = locked || state.savedLists.length === 0;
  els.savedLists.innerHTML = '';

  state.savedLists.forEach((list, idx) => {
    const pill = document.createElement('span');
    pill.className = 'saved-pill';

    const loadBtn = document.createElement('button');
    loadBtn.type = 'button';
    loadBtn.className = 'saved-pill-load';
    loadBtn.textContent = `${list.name} (${list.items.length})`;
    loadBtn.addEventListener('click', () => {
      if (state.locks.pick) return;
      state.choices = [...list.items];
      els.sentenceInput.value = '';
      renderPicker();
    });

    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'saved-pill-del';
    delBtn.setAttribute('aria-label', `Delete ${list.name}`);
    delBtn.textContent = '×';
    delBtn.addEventListener('click', () => {
      state.savedLists.splice(idx, 1);
      saveJSON(STORAGE_KEYS.lists, state.savedLists);
      renderSavedLists();
    });

    pill.append(loadBtn, delBtn);
    els.savedLists.appendChild(pill);
  });
}

// Render Coin Lock State
function renderCoin() {
  const lock = state.locks.coin;
  const locked = Boolean(lock);

  els.coinHeadsInput.disabled = locked;
  els.coinTailsInput.disabled = locked;
  els.coinStageBtn.disabled = locked || state.isAnimating;

  if (locked) {
    els.coinHeadsInput.value = lock.headsLabel === 'Heads' ? '' : lock.headsLabel;
    els.coinTailsInput.value = lock.tailsLabel === 'Tails' ? '' : lock.tailsLabel;
    els.coinResultValue.textContent = lock.winner;
    els.coinResultCard.hidden = false;
  } else {
    els.coinResultCard.hidden = true;
  }

  els.coinEl.style.transform = `rotateY(${state.coinRotation}deg)`;
  updateDock();
}

// Render Dice Lock State
const D6_PIPS = {
  1: [4],
  2: [0, 8],
  3: [0, 4, 8],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8],
};

function renderDieFace(value, sides) {
  if (sides === 6 && D6_PIPS[value]) {
    const grid = document.createElement('div');
    grid.className = 'pip-grid';
    const active = new Set(D6_PIPS[value]);
    for (let i = 0; i < 9; i += 1) {
      const cell = document.createElement('span');
      if (active.has(i)) cell.className = 'pip';
      grid.appendChild(cell);
    }
    els.dieFace.innerHTML = '';
    els.dieFace.appendChild(grid);
  } else {
    els.dieFace.textContent = String(value);
  }
}

function renderDice() {
  const lock = state.locks.dice;
  const locked = Boolean(lock);

  els.dicePresetBtns.forEach((btn) => {
    btn.disabled = locked;
  });
  els.customSidesInput.disabled = locked;
  els.diceStageBtn.disabled = locked || state.isAnimating;

  renderDieFace(state.diceValue, state.diceSides);

  if (locked) {
    els.diceResultEyebrow.textContent = `Decision locked · d${lock.sides}`;
    els.diceResultValue.textContent = String(lock.value);
    els.diceResultCard.hidden = false;
  } else {
    els.diceResultCard.hidden = true;
  }
  updateDock();
}

// Live Offline Sentence Parsing (handles typing, paste, and native mobile keyboard dictation)
function syncFromSentence() {
  if (state.locks.pick) return;
  const text = els.sentenceInput.value;
  state.choices = text.trim() ? parseSentenceToChoices(text) : [];
  renderPicker();
}

els.sentenceInput.addEventListener('input', syncFromSentence);
els.sentenceInput.addEventListener('change', syncFromSentence);
els.sentenceInput.addEventListener('compositionend', syncFromSentence);

// Manual Option Add
els.manualAddForm.addEventListener('submit', (e) => {
  e.preventDefault();
  if (state.locks.pick) return;
  const value = els.manualOptionInput.value.trim();
  if (!value) return;
  const normalized = value.charAt(0).toUpperCase() + value.slice(1);
  if (!state.choices.some((c) => c.toLowerCase() === normalized.toLowerCase())) {
    state.choices.push(normalized);
  }
  els.manualOptionInput.value = '';
  renderPicker();
});

els.clearChoicesBtn.addEventListener('click', () => {
  if (state.locks.pick) return;
  state.choices = [];
  els.sentenceInput.value = '';
  renderPicker();
});

els.saveListBtn.addEventListener('click', () => {
  if (state.locks.pick || state.choices.length < 2) return;
  const defaultName = state.choices.slice(0, 2).join(' / ');
  const name = window.prompt('Name this quick list:', defaultName);
  if (!name || !name.trim()) return;
  state.savedLists.unshift({ name: name.trim(), items: [...state.choices] });
  if (state.savedLists.length > 12) state.savedLists.length = 12;
  saveJSON(STORAGE_KEYS.lists, state.savedLists);
  renderSavedLists();
});

// Picker Action (locks result — no pick-again or undo on the same choices)
function runPicker() {
  if (state.locks.pick || state.choices.length < 2 || state.isAnimating) return;
  state.isAnimating = true;
  updateDock();
  haptic('launch');

  const winnerIndex = randomInt(state.choices.length);
  const steps = 6;
  let tick = 0;

  const timer = setInterval(() => {
    tick += 1;
    if (tick < steps) {
      haptic('tick');
      renderPicker(randomInt(state.choices.length));
    } else {
      clearInterval(timer);
      state.isAnimating = false;
      state.locks.pick = {
        choices: [...state.choices],
        winnerIndex,
        winner: state.choices[winnerIndex],
      };
      persistLocks();
      haptic('lock');
      renderPicker();
    }
  }, 55);
}

function resetPickerForNewDecision() {
  haptic('tap');
  state.locks.pick = null;
  state.choices = [];
  els.sentenceInput.value = '';
  persistLocks();
  renderPicker();
}

// Coin Flip Action (locks result — no re-flipping the same coin)
function runCoinFlip() {
  if (state.locks.coin || state.isAnimating) return;
  state.isAnimating = true;
  els.coinStageBtn.disabled = true;
  els.coinStageBtn.classList.remove('is-tossing');
  void els.coinStageBtn.offsetWidth;
  els.coinStageBtn.classList.add('is-tossing');
  updateDock();
  haptic('launch');

  const isHeads = randomInt(2) === 0;
  const baseSpins = Math.floor(state.coinRotation / 360) * 360 + 1080;
  state.coinRotation = baseSpins + (isHeads ? 0 : 180);
  els.coinEl.style.transform = `rotateY(${state.coinRotation}deg)`;

  setTimeout(() => {
    const headsLabel = els.coinHeadsInput.value.trim() || 'Heads';
    const tailsLabel = els.coinTailsInput.value.trim() || 'Tails';
    els.coinStageBtn.classList.remove('is-tossing');
    state.isAnimating = false;
    state.locks.coin = {
      headsLabel,
      tailsLabel,
      isHeads,
      winner: isHeads ? headsLabel : tailsLabel,
    };
    persistLocks();
    haptic('lock');
    renderCoin();
  }, 560);
}

function resetCoinForNewDecision() {
  haptic('tap');
  state.locks.coin = null;
  els.coinHeadsInput.value = '';
  els.coinTailsInput.value = '';
  persistLocks();
  renderCoin();
}

els.coinStageBtn.addEventListener('click', runCoinFlip);

// Dice Selection & Roll (locks result — no re-rolling)
function selectDiceSides(sides, isCustom = false) {
  if (state.locks.dice) return;
  haptic('tap');
  state.diceSides = sides;
  els.dicePresetBtns.forEach((btn) => {
    btn.classList.toggle('is-selected', !isCustom && Number(btn.dataset.sides) === sides);
  });
  els.customSidesWrap.classList.toggle('is-selected', isCustom);
  if (!isCustom) els.customSidesInput.value = '';
  state.diceValue = Math.min(state.diceValue, sides);
  renderDice();
}

els.dicePresetBtns.forEach((btn) => {
  btn.addEventListener('click', () => selectDiceSides(Number(btn.dataset.sides), false));
});

els.customSidesInput.addEventListener('input', () => {
  const val = Number.parseInt(els.customSidesInput.value, 10);
  if (Number.isFinite(val) && val >= 2 && val <= 999) {
    selectDiceSides(val, true);
  }
});

function runDiceRoll() {
  if (state.locks.dice || state.isAnimating) return;
  state.isAnimating = true;
  els.diceStageBtn.disabled = true;
  els.dieEl.classList.remove('is-rolling');
  void els.dieEl.offsetWidth;
  els.dieEl.classList.add('is-rolling');
  updateDock();
  haptic('launch');

  const finalValue = randomInt(state.diceSides) + 1;
  let tick = 0;
  const timer = setInterval(() => {
    tick += 1;
    if (tick < 5) {
      haptic('tick');
      renderDieFace(randomInt(state.diceSides) + 1, state.diceSides);
    } else {
      clearInterval(timer);
      state.diceValue = finalValue;
      state.isAnimating = false;
      state.locks.dice = {
        sides: state.diceSides,
        value: finalValue,
      };
      persistLocks();
      haptic('lock');
      renderDice();
    }
  }, 68);
}

function resetDiceForNewDecision() {
  haptic('tap');
  state.locks.dice = null;
  persistLocks();
  renderDice();
}

els.diceStageBtn.addEventListener('click', runDiceRoll);

// Primary Bottom Button (Decide/Flip/Roll OR Start New Decision once locked)
els.primaryActionBtn.addEventListener('click', () => {
  if (state.mode === 'pick') {
    if (state.locks.pick) resetPickerForNewDecision();
    else runPicker();
  } else if (state.mode === 'coin') {
    if (state.locks.coin) resetCoinForNewDecision();
    else runCoinFlip();
  } else {
    if (state.locks.dice) resetDiceForNewDecision();
    else runDiceRoll();
  }
});

// PWA Service Worker registration (offline support)
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}

// Init (restore any persisted locked decisions so refreshing cannot undo a pick)
initTheme();
initIosHapticSwitch();
renderPicker();
renderCoin();
renderDice();
updateDock();
