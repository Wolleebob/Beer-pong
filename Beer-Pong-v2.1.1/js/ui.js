import { saveStore, resetStats } from './store.js';

const $ = (selector) => document.querySelector(selector);

export function initUI({ store, audio, game }) {
  const hud = $('#hud');
  const screens = new Map(
    [...document.querySelectorAll('.screen')].map((el) => [el.id.replace('screen-', ''), el]),
  );

  const el = {
    turnLabel: $('#turn-label'),
    score: $('#hud-score'),
    accuracy: $('#hud-accuracy'),
    streak: $('#hud-streak'),
    best: $('#hud-best'),
    modeLabel: $('#mode-label'),
    modeValue: $('#mode-value'),
    streakChip: $('#streak-chip'),
    streakValue: $('#streak-value'),
    toast: $('#toast'),
    hint: $('#aim-hint'),
    soundBtn: $('#btn-sound'),
  };

  let currentScreen = 'menu';
  let toastTimer = null;
  let hintTimer = null;
  let deferredPrompt = null;

  /* ---------------------------------------------------------
     Screens
     --------------------------------------------------------- */
  function setScreen(name) {
    currentScreen = name;
    for (const [key, node] of screens) {
      node.classList.toggle('is-open', key === name);
    }
    hud.hidden = name !== null;
    document.body.dataset.screen = name || 'game';
    if (name === null) {
      el.hint.classList.add('is-visible');
      clearTimeout(hintTimer);
      hintTimer = setTimeout(() => el.hint.classList.remove('is-visible'), 12000);
    } else {
      el.hint.classList.remove('is-visible');
    }
  }

  function startGame(mode) {
    audio.unlock();
    audio.play('ui');
    setScreen(null);
    game.start(mode);
  }

  function hideHint() {
    el.hint.classList.remove('is-visible');
    clearTimeout(hintTimer);
  }

  /* ---------------------------------------------------------
     Toast
     --------------------------------------------------------- */
  function toast(text, tone = '') {
    if (!text) return;
    el.toast.textContent = text;
    el.toast.className = 'toast is-visible';
    if (tone === 'good') el.toast.classList.add('is-good');
    if (tone === 'hot') el.toast.classList.add('is-hot');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      el.toast.classList.remove('is-visible');
    }, 1900);
  }

  /* ---------------------------------------------------------
     HUD
     --------------------------------------------------------- */
  function updateHud(data) {
    if (!data) return;
    const practice = data.mode === 'practice';

    el.score.textContent = String(data.score);
    el.accuracy.textContent = `${data.accuracy}%`;
    el.streak.textContent = String(data.streak);
    el.best.textContent = String(data.bestScore);
    el.turnLabel.textContent = practice ? 'Treino livre' : 'Partida real';

    if (practice) {
      el.modeLabel.textContent = 'Copos';
      el.modeValue.textContent = String(data.cupsLeft);
    } else {
      el.modeLabel.textContent = 'Chances';
      el.modeValue.textContent = String(data.lives);
    }

    if (data.streak >= 2) {
      el.streakChip.hidden = false;
      el.streakValue.textContent = String(data.streak);
    } else {
      el.streakChip.hidden = true;
    }
  }

  /* ---------------------------------------------------------
     Settings sync
     --------------------------------------------------------- */
  function syncSettings() {
    const soundOn = Boolean(store.settings.sound);
    const vibOn = Boolean(store.settings.vibrate);

    $('#toggle-sound').setAttribute('aria-checked', String(soundOn));
    $('#toggle-vibrate').setAttribute('aria-checked', String(vibOn));
    el.soundBtn.setAttribute('aria-pressed', String(soundOn));
    el.soundBtn.setAttribute('aria-label', soundOn ? 'Desligar som' : 'Ligar som');
    el.soundBtn.querySelector('use').setAttribute('href', soundOn ? '#i-sound' : '#i-mute');

    syncStats();
  }

  function syncStats() {
    const { throws, hits, bestScore } = store.stats;
    const acc = throws ? Math.round((hits / throws) * 100) : 0;
    $('#stat-throws').textContent = String(throws);
    $('#stat-hits').textContent = String(hits);
    $('#stat-acc').textContent = `${acc}%`;
    $('#stat-best').textContent = String(bestScore);
  }

  function setSound(value) {
    store.settings.sound = value;
    audio.setEnabled(value);
    saveStore(store);
    syncSettings();
    if (value) audio.play('ui');
  }

  function setVibrate(value) {
    store.settings.vibrate = value;
    saveStore(store);
    syncSettings();
  }

  /* ---------------------------------------------------------
     Game over
     --------------------------------------------------------- */
  function showGameOver(result) {
    $('#over-title').textContent = 'Fim da partida';
    $('#over-sub').textContent = 'Você perdeu as 3 chances';
    $('#over-score-value').textContent = String(result.score);
    $('#over-score-label').textContent = result.score === 1 ? 'ponto' : 'pontos';
    $('#over-throws').textContent = String(result.throws);
    $('#over-hits').textContent = String(result.hits);
    $('#over-acc').textContent = `${result.accuracy}%`;
    $('#over-streak').textContent = String(result.bestStreak);

    syncStats();
    setTimeout(() => setScreen('over'), 900);
  }

  /* ---------------------------------------------------------
     Install prompt
     --------------------------------------------------------- */
  function isStandalone() {
    return (
      window.matchMedia('(display-mode: standalone)').matches ||
      window.navigator.standalone === true
    );
  }

  function isIos() {
    const ua = navigator.userAgent || '';
    if (/iPad|iPhone|iPod/.test(ua)) return true;
    return /Macintosh/.test(ua) && navigator.maxTouchPoints > 1;
  }

  function refreshInstallButton() {
    const btn = $('#btn-install');
    if (isStandalone()) {
      btn.hidden = true;
      return;
    }
    btn.hidden = !(deferredPrompt || isIos());
  }

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredPrompt = event;
    refreshInstallButton();
  });

  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    refreshInstallButton();
    toast('App instalado! 🎉', 'good');
  });

  $('#btn-install').addEventListener('click', async () => {
    audio.play('ui');
    if (deferredPrompt) {
      deferredPrompt.prompt();
      try {
        await deferredPrompt.userChoice;
      } catch {
        /* ignore */
      }
      deferredPrompt = null;
      refreshInstallButton();
    } else {
      $('#ios-hint').hidden = false;
    }
  });

  $('#btn-ios-close').addEventListener('click', () => {
    $('#ios-hint').hidden = true;
  });

  $('#ios-hint').addEventListener('click', (event) => {
    if (event.target === $('#ios-hint')) $('#ios-hint').hidden = true;
  });

  /* ---------------------------------------------------------
     Wiring
     --------------------------------------------------------- */
  $('#btn-match').addEventListener('click', () => startGame('match'));
  $('#btn-practice').addEventListener('click', () => startGame('practice'));

  $('#btn-howto').addEventListener('click', () => {
    audio.play('ui');
    setScreen('howto');
  });
  $('#btn-settings').addEventListener('click', () => {
    audio.play('ui');
    syncSettings();
    setScreen('settings');
  });

  for (const btn of document.querySelectorAll('[data-back]')) {
    btn.addEventListener('click', () => {
      audio.play('ui');
      setScreen('menu');
    });
  }

  $('#btn-pause').addEventListener('click', () => {
    if (game.phase === 'menu' || game.phase === 'over') return;
    audio.play('ui');
    game.pause();
    setScreen('pause');
  });

  $('#btn-resume').addEventListener('click', () => {
    audio.play('ui');
    game.resume();
    setScreen(null);
  });

  $('#btn-restart').addEventListener('click', () => {
    audio.play('ui');
    game.resume();
    setScreen(null);
    game.restart();
  });

  $('#btn-quit').addEventListener('click', () => {
    audio.play('ui');
    game.toMenu();
    setScreen('menu');
    syncStats();
  });

  $('#btn-rematch').addEventListener('click', () => {
    audio.play('ui');
    setScreen(null);
    game.start(game.lastMode);
  });

  $('#btn-menu').addEventListener('click', () => {
    audio.play('ui');
    game.toMenu();
    setScreen('menu');
    syncStats();
  });

  el.soundBtn.addEventListener('click', () => {
    setSound(!store.settings.sound);
  });

  $('#toggle-sound').addEventListener('click', () => {
    setSound(!store.settings.sound);
  });

  $('#toggle-vibrate').addEventListener('click', () => {
    setVibrate(!store.settings.vibrate);
  });

  $('#btn-reset').addEventListener('click', () => {
    // eslint-disable-next-line no-alert
    if (window.confirm('Apagar todas as estatísticas?')) {
      resetStats(store);
      syncStats();
      toast('Estatísticas apagadas', 'good');
    }
  });

  document.addEventListener('visibilitychange', () => {
    if (
      document.hidden &&
      currentScreen === null &&
      game.phase !== 'menu' &&
      game.phase !== 'over'
    ) {
      game.pause();
      setScreen('pause');
    }
  });

  document.addEventListener('gesturestart', (event) => {
    event.preventDefault();
  });

  window.addEventListener('keydown', (event) => {
    if (
      event.key === 'Escape' &&
      currentScreen === null &&
      game.phase !== 'menu' &&
      game.phase !== 'over'
    ) {
      game.pause();
      setScreen('pause');
    }
  });

  syncSettings();
  refreshInstallButton();
  setScreen('menu');

  return {
    setScreen,
    startGame,
    updateHud,
    toast,
    showGameOver,
    hideHint,
    syncSettings,
    syncStats,
    refreshInstallButton,
  };
}
