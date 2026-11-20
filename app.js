import { parseSentenceToChoices } from './parser.js';

const STORAGE_KEYS = {
  theme: 'qd_theme',
  lists: 'qd_saved_lists',
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

function haptic(ms = 14) {
  if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
    navigator.vibrate(ms);
  }
}

// State
const state = {
  mode: 'pick', // 'pick' | 'coin' | 'dice'
  choices: [],
  savedLists: loadSavedLists(),
  isAnimating: false,
  coinRotation: 0,
  diceSides: 6,
  diceValue: 6,
};

// Elements
const els = {
  themeToggle: document.getElementById('theme-toggle'),
  tabs: [...document.querySelectorAll('.tab-btn')],
  panels: {
    pick: document.getElementById('panel-pick'),
    coin: document.getElementById('panel-coin'),
    dice: document.getElementById('panel-dice'),
  },
  sentenceInput: document.getElementById('sentence-input'),
  micBtn: document.getElementById('mic-btn'),
  micStatus: document.getElementById('mic-status'),
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
  pickAgainBtn: document.getElementById('pick-again-btn'),
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
  coinShortcutBtn: document.getElementById('coin-shortcut-btn'),
  primaryActionBtn: document.getElementById('primary-action-btn'),
};

// Theme
function initTheme() {
  const saved = localStorage.getItem(STORAGE_KEYS.theme);
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const theme = saved || (prefersDark ? 'dark' : 'light');
  document.documentElement.dataset.theme = theme;
}

els.themeToggle.addEventListener('click', () => {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  localStorage.setItem(STORAGE_KEYS.theme, next);
});

// Storage for Saved Lists
function loadSavedLists() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.lists);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function persistSavedLists() {
  try {
    localStorage.setItem(STORAGE_KEYS.lists, JSON.stringify(state.savedLists));
  } catch {
    // Ignore storage quota errors
  }
}

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
  tab.addEventListener('click', () => setMode(tab.dataset.mode));
});

// Dock Button State
function updateDock() {
  if (state.mode === 'pick') {
    els.primaryActionBtn.textContent = 'Decide';
    els.primaryActionBtn.disabled = state.choices.length < 2 || state.isAnimating;
    els.coinShortcutBtn.hidden = state.choices.length !== 2;
  } else if (state.mode === 'coin') {
    els.primaryActionBtn.textContent = 'Flip Coin';
    els.primaryActionBtn.disabled = state.isAnimating;
    els.coinShortcutBtn.hidden = true;
  } else {
    els.primaryActionBtn.textContent = `Roll d${state.diceSides}`;
    els.primaryActionBtn.disabled = state.isAnimating;
    els.coinShortcutBtn.hidden = true;
  }
}

// Render Choices
function renderChoices(highlightIndex = -1) {
  els.choiceCount.textContent = String(state.choices.length);
  els.clearChoicesBtn.hidden = state.choices.length === 0;
  els.saveListBtn.hidden = state.choices.length < 2;

  els.choiceChips.innerHTML = '';
  state.choices.forEach((choice, idx) => {
    const chip = document.createElement('span');
    chip.className = 'choice-chip';
    if (idx === highlightIndex) chip.classList.add('is-highlighted');

    const label = document.createElement('span');
    label.textContent = choice;

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.setAttribute('aria-label', `Remove ${choice}`);
    removeBtn.textContent = '×';
    removeBtn.addEventListener('click', () => {
      state.choices.splice(idx, 1);
      els.pickResultCard.hidden = true;
      renderChoices();
    });

    chip.append(label, removeBtn);
    els.choiceChips.appendChild(chip);
  });

  updateDock();
}

function renderSavedLists() {
  els.savedListsBlock.hidden = state.savedLists.length === 0;
  els.savedLists.innerHTML = '';

  state.savedLists.forEach((list, idx) => {
    const pill = document.createElement('span');
    pill.className = 'saved-pill';

    const loadBtn = document.createElement('button');
    loadBtn.type = 'button';
    loadBtn.className = 'saved-pill-load';
    loadBtn.textContent = `${list.name} (${list.items.length})`;
    loadBtn.addEventListener('click', () => {
      state.choices = [...list.items];
      els.sentenceInput.value = '';
      els.pickResultCard.hidden = true;
      renderChoices();
    });

    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'saved-pill-del';
    delBtn.setAttribute('aria-label', `Delete ${list.name}`);
    delBtn.textContent = '×';
    delBtn.addEventListener('click', () => {
      state.savedLists.splice(idx, 1);
      persistSavedLists();
      renderSavedLists();
    });

    pill.append(loadBtn, delBtn);
    els.savedLists.appendChild(pill);
  });
}

// Live Offline Sentence Parsing
function syncFromSentence() {
  const text = els.sentenceInput.value;
  if (!text.trim()) {
    state.choices = [];
    els.pickResultCard.hidden = true;
    renderChoices();
    return;
  }
  const parsed = parseSentenceToChoices(text);
  state.choices = parsed;
  els.pickResultCard.hidden = true;
  renderChoices();
}

els.sentenceInput.addEventListener('input', syncFromSentence);

// Manual Option Add
els.manualAddForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const value = els.manualOptionInput.value.trim();
  if (!value) return;
  const normalized = value.charAt(0).toUpperCase() + value.slice(1);
  if (!state.choices.some((c) => c.toLowerCase() === normalized.toLowerCase())) {
    state.choices.push(normalized);
  }
  els.manualOptionInput.value = '';
  els.pickResultCard.hidden = true;
  renderChoices();
});

els.clearChoicesBtn.addEventListener('click', () => {
  state.choices = [];
  els.sentenceInput.value = '';
  els.pickResultCard.hidden = true;
  renderChoices();
});

els.saveListBtn.addEventListener('click', () => {
  if (state.choices.length < 2) return;
  const defaultName = state.choices.slice(0, 2).join(' / ');
  const name = window.prompt('Name this quick list:', defaultName);
  if (!name || !name.trim()) return;
  state.savedLists.unshift({ name: name.trim(), items: [...state.choices] });
  if (state.savedLists.length > 12) state.savedLists.length = 12;
  persistSavedLists();
  renderSavedLists();
});

// Speech Dictation (Web Speech API)
function initSpeechDictation() {
  const SpeechRecognition =
    window.SpeechRecognition || window.webkitSpeechRecognition;

  if (!SpeechRecognition) {
    els.micBtn.hidden = true;
    return;
  }

  const recognition = new SpeechRecognition();
  recognition.lang = navigator.language || 'en-US';
  recognition.interimResults = true;
  recognition.continuous = false;

  let isListening = false;

  recognition.addEventListener('start', () => {
    isListening = true;
    els.micBtn.classList.add('is-listening');
    els.micStatus.textContent = 'Listening… say your choices (e.g. "ramen, tacos, or sushi")';
  });

  recognition.addEventListener('result', (event) => {
    let transcript = '';
    for (let i = 0; i < event.results.length; i += 1) {
      transcript += event.results[i][0].transcript;
    }
    els.sentenceInput.value = transcript.trim();
    syncFromSentence();
  });

  recognition.addEventListener('error', (event) => {
    els.micStatus.textContent =
      event.error === 'not-allowed'
        ? 'Microphone permission blocked — you can still type or use your phone keyboard mic.'
        : 'Could not hear clearly — try again or type your choices.';
  });

  recognition.addEventListener('end', () => {
    isListening = false;
    els.micBtn.classList.remove('is-listening');
    if (els.micStatus.textContent.startsWith('Listening')) {
      els.micStatus.textContent = '';
    }
  });

  els.micBtn.addEventListener('click', () => {
    els.micStatus.textContent = '';
    if (isListening) {
      recognition.stop();
    } else {
      try {
        recognition.start();
      } catch {
        els.micStatus.textContent = 'Dictation unavailable right now — type or use keyboard mic.';
      }
    }
  });
}

// Picker Action (fast ~320ms shuffle, no dragged-out animation)
function runPicker() {
  if (state.choices.length < 2 || state.isAnimating) return;
  state.isAnimating = true;
  els.pickResultCard.hidden = true;
  updateDock();
  haptic(12);

  const winnerIndex = randomInt(state.choices.length);
  const steps = 6;
  let tick = 0;

  const timer = setInterval(() => {
    tick += 1;
    if (tick < steps) {
      const previewIndex = randomInt(state.choices.length);
      renderChoices(previewIndex);
    } else {
      clearInterval(timer);
      state.isAnimating = false;
      renderChoices(winnerIndex);
      els.pickResultValue.textContent = state.choices[winnerIndex];
      els.pickResultCard.hidden = false;
      haptic(20);
      updateDock();
    }
  }, 50);
}

els.pickAgainBtn.addEventListener('click', runPicker);

// 2-choice shortcut to Coin Flip
els.coinShortcutBtn.addEventListener('click', () => {
  if (state.choices.length !== 2) return;
  els.coinHeadsInput.value = state.choices[0];
  els.coinTailsInput.value = state.choices[1];
  els.coinResultCard.hidden = true;
  setMode('coin');
  runCoinFlip();
});

// Coin Flip Action
function runCoinFlip() {
  if (state.isAnimating) return;
  state.isAnimating = true;
  els.coinResultCard.hidden = true;
  updateDock();
  haptic(14);

  const isHeads = randomInt(2) === 0;
  // Advance rotation by 3 full turns (1080deg) plus final parity so it always spins forward
  const baseSpins = Math.floor(state.coinRotation / 360) * 360 + 1080;
  state.coinRotation = baseSpins + (isHeads ? 0 : 180);
  els.coinEl.style.transform = `rotateY(${state.coinRotation}deg)`;

  setTimeout(() => {
    const headsLabel = els.coinHeadsInput.value.trim() || 'Heads';
    const tailsLabel = els.coinTailsInput.value.trim() || 'Tails';
    els.coinResultValue.textContent = isHeads ? headsLabel : tailsLabel;
    els.coinResultCard.hidden = false;
    state.isAnimating = false;
    haptic(20);
    updateDock();
  }, 560);
}

els.coinStageBtn.addEventListener('click', runCoinFlip);

// Dice Rendering (SVG-like CSS pips for d6, crisp number for all other dice)
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

function selectDiceSides(sides, isCustom = false) {
  state.diceSides = sides;
  els.dicePresetBtns.forEach((btn) => {
    btn.classList.toggle('is-selected', !isCustom && Number(btn.dataset.sides) === sides);
  });
  els.customSidesWrap.classList.toggle('is-selected', isCustom);
  if (!isCustom) els.customSidesInput.value = '';
  els.diceResultCard.hidden = true;
  state.diceValue = Math.min(state.diceValue, sides);
  renderDieFace(state.diceValue, sides);
  updateDock();
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
  if (state.isAnimating) return;
  state.isAnimating = true;
  els.diceResultCard.hidden = true;
  els.dieEl.classList.remove('is-rolling');
  void els.dieEl.offsetWidth; // restart CSS animation
  els.dieEl.classList.add('is-rolling');
  updateDock();
  haptic(14);

  const finalValue = randomInt(state.diceSides) + 1;
  let tick = 0;
  const timer = setInterval(() => {
    tick += 1;
    if (tick < 5) {
      renderDieFace(randomInt(state.diceSides) + 1, state.diceSides);
    } else {
      clearInterval(timer);
      state.diceValue = finalValue;
      renderDieFace(finalValue, state.diceSides);
      els.diceResultEyebrow.textContent = `Rolled d${state.diceSides}`;
      els.diceResultValue.textContent = String(finalValue);
      els.diceResultCard.hidden = false;
      state.isAnimating = false;
      haptic(20);
      updateDock();
    }
  }, 65);
}

els.diceStageBtn.addEventListener('click', runDiceRoll);

// Primary Bottom Button
els.primaryActionBtn.addEventListener('click', () => {
  if (state.mode === 'pick') runPicker();
  else if (state.mode === 'coin') runCoinFlip();
  else runDiceRoll();
});

// PWA Service Worker registration (offline support)
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}

// Init
initTheme();
initSpeechDictation();
renderChoices();
renderSavedLists();
renderDieFace(state.diceValue, state.diceSides);
updateDock();
