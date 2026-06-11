'use strict';

/* ============================================================
   듣는 뉴스 — 단계 1: 화면 사이 이동 + 진입 음성 안내
   ------------------------------------------------------------
   data-go="화면이름" 속성이 있는 요소를 누르면 해당 화면으로 전환.
   진입 화면을 누르면 환영 음성이 두 단계로 안내됩니다.
   더 풍부한 음성 흐름은 단계 2에서 추가됩니다.
   ============================================================ */

(function () {

  /* ----- TTS (음성 합성) -----
     브라우저 정책상 사용자의 첫 행동 이후에만 재생됩니다. */
  var TTS = {
    supported: 'speechSynthesis' in window,
    rate: 0.95,
    voice: null,

    init: function () {
      if (!this.supported) return;
      var self = this;
      function pickKoVoice() {
        var ko = window.speechSynthesis.getVoices().filter(function (v) {
          return v.lang && v.lang.toLowerCase().indexOf('ko') === 0;
        });
        if (ko.length) self.voice = ko[0];
      }
      pickKoVoice();
      window.speechSynthesis.onvoiceschanged = pickKoVoice;
    },

    /* text를 음성으로 읽고, 끝나면 onEnd 콜백을 호출.
       이미 재생 중인 음성이 있으면 깨끗하게 끊고 새로 시작. */
    speak: function (text, onEnd) {
      if (!this.supported) {
        if (onEnd) setTimeout(onEnd, 400);
        return;
      }
      var self = this;
      window.speechSynthesis.cancel();
      /* cancel 직후 곧바로 speak하면 일부 브라우저에서 음성이 씹히므로
         아주 짧은 지연을 둔다. */
      setTimeout(function () {
        var u = new SpeechSynthesisUtterance(text);
        u.lang = 'ko-KR';
        u.rate = self.rate;
        if (self.voice) u.voice = self.voice;
        u.onend = function () { if (onEnd) onEnd(); };
        u.onerror = function () { if (onEnd) onEnd(); };
        window.speechSynthesis.speak(u);
      }, 130);
    }
  };
  TTS.init();

  /* 모든 화면 요소를 미리 모아둔다 */
  var screens = {};
  document.querySelectorAll('.screen').forEach(function (el) {
    screens[el.dataset.screen] = el;
  });

  /* 현재 화면 (시작은 진입 화면) */
  var current = 'entry';

  /* 방문 경로 스택 — 백스페이스로 뒤로 갈 때 사용.
     goTo 호출마다 직전 화면이 쌓이고, goBack은 한 단계씩 꺼낸다. */
  var historyStack = [];

  /* 화면 전환 함수
     - 현재 화면을 숨기고 대상 화면을 보여준다
     - 직전 화면을 historyStack에 쌓는다 (단 같은 화면 연속 진입은 쌓지 않음)
     - 스크롤을 위로 올린다
     - 대상 화면의 첫 포커스 가능 요소로 포커스 이동
     - 화면별 진입·이탈 훅을 호출한다
     - options.fromBack=true면 뒤로가기 호출이므로 스택에 안 쌓음 */
  function goTo(name, options) {
    options = options || {};
    if (!screens[name] || name === current) return;

    /* 이탈 훅 */
    if (screenHooks[current] && screenHooks[current].onLeave) {
      screenHooks[current].onLeave();
    }

    /* 직전 화면을 스택에 쌓는다 (뒤로 가기 호출일 때는 제외) */
    if (!options.fromBack) {
      historyStack.push(current);
    }

    screens[current].hidden = true;
    screens[name].hidden = false;
    current = name;

    /* 새 화면 진입 시 스크롤 맨 위로 */
    var body = screens[name].querySelector('.screen-body');
    if (body) body.scrollTop = 0;

    /* 포커스를 새 화면의 제목 또는 본문 시작점으로 이동.
       스크린리더 사용자가 새 화면 진입을 인지할 수 있게 한다. */
    var focusTarget =
      screens[name].querySelector('.screen-title, .entry-title, .screen-body');
    if (focusTarget) {
      focusTarget.setAttribute('tabindex', '-1');
      focusTarget.focus({ preventScroll: true });
    }

    /* 진입 훅 — fromBack 정보를 함께 전달해서, 백스페이스로 돌아온 경우와
       첫 진입을 구분할 수 있게 한다. */
    if (screenHooks[name] && screenHooks[name].onEnter) {
      screenHooks[name].onEnter({ fromBack: !!options.fromBack });
    }
  }

  /* 백스페이스로 뒤로 가기.
     historyStack에서 직전 화면을 꺼내 그쪽으로 이동.
     화면 진입 안내(onEnter)가 자동으로 다시 재생돼서 "내가 지금 어디 있는지" 음성으로 알려준다.
     스택이 비어 있으면(진입 화면 등) 음성으로 안내만 한다. */
  function goBack() {
    if (historyStack.length === 0) {
      TTS.speak('처음 화면입니다. 더 이상 뒤로 갈 수 없습니다.');
      return;
    }
    var prev = historyStack.pop();
    goTo(prev, { fromBack: true });
  }

  /* 화면별 진입·이탈 동작 */
  var screenHooks = {};

  /* ============================================================
     키보드 입력 시스템 — 사용자가 명시적으로 누른 키만 동작을 일으킨다.
     - 스페이스: "다음 진행" (화면마다 정의)
     - 백스페이스: "이전 화면으로" (전역 동일)
     - 입력 필드(input/textarea)에서 키를 입력 중일 때만 통과
     ------------------------------------------------------------
     "오류 0에 가까운 일관성" 원칙:
     - 마우스 클릭은 거의 동작하지 않음 (포커스가 닿기만 해도 정보가 흐르는 문제 방지)
     - 모바일에서는 화면 어디든 단발 탭이 스페이스와 같은 역할 (백업 경로)
     - 응답 영역의 두 버튼만 직접 클릭 가능 (음성·키보드 둘 다 안 쓸 때의 최후 경로)
     ============================================================ */
  var KeyHandlers = {
    /* 화면별 "스페이스를 누르면 무엇을 할지" 등록 — 등록 안 된 화면은 스페이스 무시 */
    spaceAction: {},

    register: function (screenName, action) {
      this.spaceAction[screenName] = action;
    },

    triggerSpace: function () {
      var action = this.spaceAction[current];
      if (typeof action === 'function') {
        action();
      }
    }
  };

  /* 전역 키 리스너 — 모든 키 입력은 여기로 모인다. */
  document.addEventListener('keydown', function (e) {
    var tag = (e.target && e.target.tagName) || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;

    if (e.key === ' ' || e.code === 'Space') {
      e.preventDefault();
      KeyHandlers.triggerSpace();
      return;
    }
    if (e.key === 'Backspace') {
      e.preventDefault();
      goBack();
      return;
    }
  });

  /* 전역 클릭 리스너 — 모바일·터치 백업 경로.
     단발 탭은 현재 화면의 스페이스 동작과 동일하게 작동.
     단 응답 영역의 두 버튼은 직접 동작 (음성 불가 + 화면 다른 영역 못 누르는 환경) */
  document.addEventListener('click', function (e) {
    var responseBtn = e.target.closest('.response-btn');
    if (responseBtn) {
      e.stopPropagation();
      if (responseBtn.id === 'response-yes') proceedToMain();
      else if (responseBtn.id === 'response-no') declineWelcome();
      return;
    }

    var tag = (e.target && e.target.tagName) || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;

    KeyHandlers.triggerSpace();
  });

  /* ----- 진입 화면 → 결과 전환 환영 흐름 -----
     1. 화면 클릭 즉시 환영 + 권한 안내 + 스크린리더기 안내 (통합 멘트)
     2. 환영 멘트 끝 → 음성 인식 시작 시도 → 브라우저가 권한 팝업 표시
     3. 사용자가 허용 → "지금부터 듣겠습니다" 짧은 신호 →
        "오늘 날짜로 등록된 뉴스 기사를 확인하시겠습니까?" 질문이 자연스럽게 이어짐
     4. "네/예/응" 류로 답하면 곧바로 결과 화면으로 (중간 안내 없이)
     5. "나중에" 버튼이나 부정 응답이면 다시 묻기
     (단계 2B에서 "다른 것" 흐름 추가 예정) */
  var welcomeStarted = false;
  var entryEl = screens.entry;
  var responseArea = document.getElementById('response-area');
  var responsePrompt = document.getElementById('response-prompt');
  var btnYes = document.getElementById('response-yes');
  var btnNo = document.getElementById('response-no');

  /* VoiceInput 초기화: 안내는 TTS로, 결과는 응답 판정으로 */
  var voiceOk = VoiceInput.init(
    function announce(msg, onEnd) {
      /* 음성 인식 모듈이 화면 텍스트도 함께 갱신할 수 있도록 prompt 영역 사용 */
      responsePrompt.innerHTML = msg;
      TTS.speak(msg, onEnd);
    },
    function onResult(text) {
      handleUserResponse(text);
    },
    function onError(kind) {
      /* 핵심 원칙: 사용자가 명확히 "네"라고 답하기 전엔
         시스템이 먼저 말하거나 다음 단계로 가지 않는다.
         일시적인 인식 실패는 침묵 처리 — 연속 듣기 모드 덕에
         음성 인식은 곧 자동으로 다시 켜진다. */
      if (kind === 'no-speech') {
        /* 음성이 안 들렸을 때 — 완전 침묵.
           음성 인식이 자동 재시작되어 사용자 답을 계속 기다린다. */
        return;
      } else if (kind === 'denied') {
        /* 권한 거부는 시스템 문제이므로 안내 필요 */
        showPrompt('마이크 권한이 거부되었습니다. 아래 "네, 시작하기" 버튼을 눌러 진행해 주세요.');
        TTS.speak('마이크 권한이 거부되었습니다. 아래 버튼을 눌러 진행해 주세요.');
      } else if (kind === 'no-mic') {
        showPrompt('마이크를 찾을 수 없습니다. 아래 버튼을 눌러 진행해 주세요.');
        TTS.speak('마이크를 찾을 수 없습니다. 아래 버튼을 눌러 진행해 주세요.');
      } else if (kind === 'unsupported') {
        showPrompt('이 브라우저는 음성 인식을 지원하지 않습니다. 아래 버튼을 눌러 진행해 주세요.');
      } else {
        /* 기타 일시 오류도 침묵 처리 — 자동 재시작에 맡김 */
        return;
      }
    }
  );

  function showPrompt(text) {
    responsePrompt.innerHTML = text;
    responseArea.hidden = false;
  }
  function showListeningPrompt(text) {
    responsePrompt.innerHTML = '<span class="listening-dot" aria-hidden="true"></span>' + text;
    responseArea.hidden = false;
  }

  function startWelcomeFlow() {
    if (welcomeStarted) return;
    welcomeStarted = true;

    /* 시작 안내 박스(CTA)와 보조 안내를 감춰서, 응답 영역이 그 자리를 차지하게 한다.
       사용자가 누른 위치에 곧바로 환영·질문이 떠올라 시선·손가락 흐름이 끊기지 않는다. */
    var ctaBox = entryEl.querySelector('.entry-cta');
    var subText = entryEl.querySelector('.entry-sub');
    if (ctaBox) ctaBox.hidden = true;
    if (subText) subText.hidden = true;

    /* 첫 클릭 즉시 환영 + 질문으로 진입 */
    askWelcomeQuestion();

    /* 안전망: 어떤 이유로든 음성 onEnd가 안 오면 5초 뒤 강제 진행 */
    setTimeout(function () {
      if (responseArea.hidden) askWelcomeQuestion();
    }, 5000);
  }

  function askWelcomeQuestion() {
    /* 환영 + 키 안내 + 권한 안내 + 스크린리더기 안내 (통합 멘트) */
    var welcome =
      '듣는 뉴스 스크랩에 오신 것을 환영합니다. ' +
      '스페이스 키로 다음으로 진행하시고, 백스페이스 키로 뒤로 돌아가실 수 있습니다. ' +
      '잠시 후 브라우저가 마이크 사용 권한을 묻는 창을 띄웁니다. ' +
      '음성으로 답하시려면 허용을 선택해 주세요. ' +
      '스크린 리더기를 활용할 수 있습니다.';

    /* 화면에 환영 안내 표시 */
    showPrompt(welcome);

    /* 환영 멘트 후 곧바로 권한 요청 → 허용 → 질문으로 이어진다.
       권한 팝업과 사용자 응답 사이에 다른 음성이 끼지 않도록 한 흐름으로 묶음. */
    TTS.speak(welcome, function () {
      setTimeout(startListeningForYes, 400);
    });
  }

  function startListeningForYes() {
    if (!voiceOk) {
      /* 음성 인식 미지원 — 버튼만 안내 */
      showPrompt('아래 "네, 시작하기" 버튼을 눌러 진행해 주세요.');
      TTS.speak('아래 버튼을 눌러 진행해 주세요.');
      return;
    }
    /* 권한 요청 → (사용자 허용) → "지금부터 듣겠습니다" 짧은 신호 →
       음성 인식 활성. 활성되는 시점에 onPreSpeak이 호출되어
       "오늘 뉴스 확인" 질문을 음성과 화면으로 동시에 안내한다.
       연속 듣기 모드를 켜서, 인식이 끝나도 자동으로 다시 듣기 시작한다. */
    VoiceInput.setContinuous(true);
    VoiceInput.startWithAnnouncement(function onPreSpeak() {
      showListeningPrompt(TODAY_NEWS_QUESTION);
      TTS.speak(TODAY_NEWS_QUESTION, function () {
        /* 질문 멘트가 끝난 시점부터 1분 대기 타이머 시작 */
        startWaitTimer();
      });
    });
  }

  /* "오늘 뉴스 확인" 질문 멘트 — 한 곳에서 정의해서 여러 시점에 재사용 */
  var TODAY_NEWS_QUESTION =
    '오늘 날짜로 등록된 뉴스 기사를 확인하시겠습니까? ' +
    '확인하시려면 네 라고 답해 주세요.';

  /* ----- 1분 대기 타이머 -----
     사용자가 답하기 전엔 시스템이 침묵해야 한다는 원칙을 지키되,
     너무 오래 방치되면 사용자가 화면을 잊을 수 있으니 1분 후 같은 질문을 다시 안내한다.
     사용자가 음성으로 답하거나 화면을 이탈할 때 타이머는 정리된다. */
  var WAIT_BEFORE_REASK_MS = 60000;
  var waitTimer = null;

  function startWaitTimer() {
    clearWaitTimer();
    waitTimer = setTimeout(function () {
      waitTimer = null;
      /* 1분 대기 종료 — 같은 질문을 다시 안내하고 타이머를 다시 시작한다.
         continuous 모드라 음성 인식은 이미 켜져 있으므로 다시 시작할 필요 없다. */
      reaskTodayNews();
    }, WAIT_BEFORE_REASK_MS);
  }

  function clearWaitTimer() {
    if (waitTimer) {
      clearTimeout(waitTimer);
      waitTimer = null;
    }
  }

  /* 질문을 다시 안내. continuous 모드라 음성 인식은 켜져 있는 상태.
     음성 안내가 끝나면 타이머만 새로 시작하면 된다. */
  function reaskTodayNews() {
    showListeningPrompt(TODAY_NEWS_QUESTION);
    TTS.speak(TODAY_NEWS_QUESTION, function () {
      startWaitTimer();
    });
  }

  function handleUserResponse(text) {
    if (isYesResponse(text)) {
      /* "네" 류 답변 — 결과 화면으로 진행 */
      proceedToMain();
    } else {
      /* "네"가 아닌 응답 — 시스템은 침묵하고 그저 기다린다.
         음성 인식은 continuous 모드라 자동으로 다시 켜져, 사용자의 다음 발화를 듣는다.
         1분 타이머는 그대로 흘러가며, 만료되면 그제서야 같은 질문이 다시 안내된다.
         (시각 사용자가 아니므로 화면 표시도 따로 갱신하지 않는다.) */
      return;
    }
  }

  /* 사용자가 "네" 답하면 결과 화면으로 직행한다.
     중간 안내 멘트는 두지 않는다 — 사용자는 답하자마자 결과를 듣기 시작한다.
     연속 듣기·1분 타이머는 모두 정리된다. */
  function proceedToMain() {
    clearWaitTimer();
    VoiceInput.stop();
    responseArea.hidden = true;
    goTo('results');
  }

  function declineWelcome() {
    clearWaitTimer();
    VoiceInput.stop();
    showPrompt('나중에 다시 시도해 주세요. 화면을 다시 누르면 시작합니다.');
    TTS.speak('나중에 다시 시도해 주세요.');
    welcomeStarted = false;
    responseArea.hidden = true;
    /* CTA·sub 복원 — 다시 누르면 시작할 수 있다는 안내를 살림 */
    var ctaBox = entryEl.querySelector('.entry-cta');
    var subText = entryEl.querySelector('.entry-sub');
    if (ctaBox) ctaBox.hidden = false;
    if (subText) subText.hidden = false;
  }

  /* 진입 화면 자동 포커스 — 페이지가 열리면 진입 화면에 포커스 (스크린리더가 곧장 안내). */
  setTimeout(function () {
    if (current === 'entry' && !welcomeStarted) {
      entryEl.focus({ preventScroll: true });
    }
  }, 100);

  /* ============================================================
     화면별 스페이스 동작 등록 — "스페이스 = 다음 진행"의 의미를 각 화면에서 정의
     ============================================================ */

  /* 진입 화면: 환영 흐름이 시작되지 않았다면 시작. 시작된 뒤엔 "네"로 진행(응답 영역 표시 중일 때). */
  KeyHandlers.register('entry', function () {
    if (!welcomeStarted) {
      startWelcomeFlow();
    } else if (!responseArea.hidden) {
      /* 환영 흐름이 진행 중이고 응답 영역이 떠 있으면 — 사용자가 "네"로 진행한 것으로 해석.
         음성 인식이 막혀 있거나 사용자가 음성 대신 키를 쓰고 싶을 때의 백업 경로. */
      proceedToMain();
    }
  });

  /* ============================================================
     화면별 스페이스 동작 등록 (진입 화면)
     키보드 시스템과 전역 핸들러는 위쪽에 정의돼 있음.
     ============================================================ */

  /* 진입 화면: 환영 흐름이 시작되지 않았다면 시작.
     시작된 뒤엔 응답 영역이 떠 있으면 "네"로 진행 (음성 백업 경로). */
  KeyHandlers.register('entry', function () {
    if (!welcomeStarted) {
      startWelcomeFlow();
    } else if (!responseArea.hidden) {
      proceedToMain();
    }
  });

  /* ============================================================
     메인 화면 (단계 2A) — 음성 우선 흐름
     ------------------------------------------------------------
     - 메인 진입 시 음성 안내 → 자동 마이크 시작
     - 사용자가 질문을 말하면 결과로 이동
     - "멈춰"라고 하거나 화면을 탭하면 마이크 멈춤
     - 멈춘 뒤 화면을 다시 탭하면 다시 마이크 켜짐
     - 음성 사용이 어려우면 칩(자주 듣는 주제)으로도 진행
     ============================================================ */
  var Main = {
    state: 'idle',   // 'idle' | 'announcing' | 'listening' | 'processing' | 'stopped'
    el: {},
    autoStartTimer: null,

    init: function () {
      this.el.area      = document.getElementById('main-listening-area');
      this.el.state     = document.getElementById('mic-state');
      this.el.status    = document.getElementById('mic-status-line');
      this.el.help      = document.getElementById('mic-help-line');
      this.el.recoQ     = document.getElementById('recognized-q');
      /* 직접 클릭/키 핸들러는 두지 않는다 — 전역 KeyHandlers에 등록된 동작이 작동.
         단계 2A의 자동 마이크 토글은 KeyHandlers.register('main', ...) 으로 옮겨졌다.
         칩(자주 듣는 주제) 클릭도 전역 클릭 핸들러에서 처리하지 않는다.
         (단계 2B에서 칩 흐름을 음성 기반으로 다시 설계할 예정) */
    },

    /* 상태 표시 변경 */
    setState: function (state, statusLine, helpLine) {
      this.state = state;
      this.el.state.classList.remove('listening', 'stopped', 'processing');
      if (state === 'listening')  this.el.state.classList.add('listening');
      if (state === 'stopped')    this.el.state.classList.add('stopped');
      if (state === 'processing') this.el.state.classList.add('processing');
      if (statusLine) this.el.status.textContent = statusLine;
      if (helpLine)   this.el.help.textContent   = helpLine;
    },

    /* 메인 화면 진입 — 매번 같은 흐름 */
    onEnter: function () {
      this.el.recoQ.hidden = true;
      this.el.recoQ.textContent = '';
      this.setState('idle', '곧 마이크가 켜집니다…',
                    '멈추려면 "멈춰"라고 말하거나 화면을 누르세요');

      var self = this;
      /* 진입 음성 안내 */
      TTS.speak(
        '메인 페이지입니다. 어떤 뉴스를 들어볼까요? 곧 마이크가 켜집니다. ' +
        '멈추려면 멈춰라고 말씀하시거나 화면을 누르세요.',
        function () {
          /* 안내 후 1초 더 두고 자동 시작 */
          self.autoStartTimer = setTimeout(function () {
            self.startListening();
          }, 1000);
        }
      );

      /* 안전망: 안내 음성이 막혀 있어도 4초 뒤 자동 시작 */
      setTimeout(function () {
        if (self.state === 'idle') self.startListening();
      }, 5000);
    },

    /* 메인 이탈 — 마이크와 음성 모두 정리 */
    onLeave: function () {
      if (this.autoStartTimer) {
        clearTimeout(this.autoStartTimer);
        this.autoStartTimer = null;
      }
      VoiceInput.stop();
      TTS.stop && TTS.stop();
      if (window.speechSynthesis) window.speechSynthesis.cancel();
    },

    /* 듣기 시작 */
    startListening: function () {
      if (this.state === 'listening' || this.state === 'processing') return;
      var self = this;

      if (!VoiceInput.supported) {
        this.setState('stopped',
          '음성 인식을 지원하지 않는 브라우저입니다',
          '아래 주제 중 하나를 눌러주세요');
        TTS.speak('음성 인식을 사용할 수 없습니다. 아래 주제 중 하나를 눌러 주세요.');
        return;
      }

      VoiceInput.startWithAnnouncement(function onPreSpeak() {
        self.setState('listening',
          '지금 듣고 있습니다',
          '뉴스 주제를 말씀해 주세요. 멈추려면 화면을 누르세요');
      });
    },

    /* 멈춤 */
    stopListening: function (sayIt) {
      VoiceInput.stop();
      this.setState('stopped',
        '마이크를 멈췄습니다',
        '다시 들으려면 화면을 누르세요');
      if (sayIt) {
        TTS.speak('마이크를 멈췄습니다. 다시 들으려면 화면을 누르세요.');
      }
    },

    /* 화면 탭 = 토글 */
    toggle: function () {
      if (this.state === 'listening') {
        this.stopListening(true);
      } else if (this.state === 'stopped' || this.state === 'idle') {
        if (this.autoStartTimer) {
          clearTimeout(this.autoStartTimer);
          this.autoStartTimer = null;
        }
        this.startListening();
      }
    },

    /* 사용자가 말한 텍스트 처리 */
    handleResult: function (text) {
      /* "멈춰" 류 키워드는 멈춤 명령 */
      if (this.isStopCommand(text)) {
        this.stopListening(true);
        return;
      }
      this.processQuery(text);
    },

    isStopCommand: function (text) {
      if (!text) return false;
      var t = text.trim().toLowerCase().replace(/[!.?,]/g, '');
      var stops = ['멈춰', '멈춰줘', '그만', '그만해', '정지', '스톱', 'stop', '중지'];
      for (var i = 0; i < stops.length; i++) {
        if (t === stops[i] || t.indexOf(stops[i]) !== -1) return true;
      }
      return false;
    },

    /* 검색어로 결과 화면 이동 (칩 클릭과 음성 인식 모두 여기로) */
    processQuery: function (query) {
      var self = this;
      this.setState('processing',
        '"' + query + '" 관련 뉴스를 찾고 있습니다',
        '잠시만 기다려 주세요');
      this.el.recoQ.textContent = query;
      this.el.recoQ.hidden = false;

      TTS.speak(query + ' 관련 뉴스를 찾겠습니다.', function () {
        /* 결과 화면으로 이동 — 단계 2B에서 결과의 풍부한 음성 흐름을 입힘 */
        setTimeout(function () { goTo('results'); }, 400);
      });
      /* 안전망 */
      setTimeout(function () {
        if (current === 'main') goTo('results');
      }, 3000);
    }
  };

  /* 진입 화면 훅 — 다른 화면으로 떠날 때 1분 타이머와 음성 인식을 안전하게 정리.
     proceedToMain/declineWelcome이 이미 이를 하지만, 다른 경로로 이탈할 때도 안전망. */
  screenHooks.entry = {
    /* 진입 화면 진입 — 첫 진입이든 백스페이스 복귀든 환영 흐름을 처음 상태로 리셋.
       사용자가 명시적으로 스페이스를 눌러야 환영 흐름이 시작되도록 한다. */
    onEnter: function (info) {
      /* 진행 중인 음성·타이머·마이크 정리 (백스페이스 복귀 시 잔여 동작 방지) */
      clearWaitTimer();
      VoiceInput.stop();
      if (window.speechSynthesis) window.speechSynthesis.cancel();

      /* 환영 흐름 상태 리셋 — 다시 누르면 처음부터 시작 */
      welcomeStarted = false;
      responseArea.hidden = true;

      /* CTA 박스와 보조 안내 복원 — "화면 아무 곳이나 눌러 시작하기"가 다시 보이게 */
      var ctaBox = entryEl.querySelector('.entry-cta');
      var subText = entryEl.querySelector('.entry-sub');
      if (ctaBox) ctaBox.hidden = false;
      if (subText) subText.hidden = false;

      /* 백스페이스로 돌아온 경우에만 짧은 안내 — 사용자에게 "지금 어디인지" 알려줌.
         첫 진입(페이지 로드 직후)에는 안내가 필요 없다 (사용자가 자연스럽게 스페이스를 누름). */
      if (info && info.fromBack) {
        TTS.speak('처음 화면입니다. 다시 시작하시려면 스페이스 키를 눌러 주세요.');
      }
    },
    onLeave: function () {
      clearWaitTimer();
      VoiceInput.stop();
      if (window.speechSynthesis) window.speechSynthesis.cancel();
    }
  };

  /* 메인 화면 훅 등록 */
  screenHooks.main = {
    onEnter: function () { Main.onEnter(); },
    onLeave: function () { Main.onLeave(); }
  };

  /* ============================================================
     결과 화면 — 진입 시 안내 + 기사 제목 차례로 읽어주기
     ============================================================ */
  var ResultsScreen = {
    speaking: false,
    cancelled: false,
    headlines: [],
    focusIndex: -1,

    onEnter: function () {
      var self = this;
      this.cancelled = false;
      this.speaking = true;

      /* DOM에서 현재 표시된 결과 화면의 헤드라인을 모두 수집 */
      var headlines = [];
      var cards = screens.results.querySelectorAll('.article-card .card-headline');
      cards.forEach(function (el) { headlines.push(el.textContent.trim()); });
      this.headlines = headlines;
      this.focusIndex = -1;  /* -1 = 아직 어느 항목도 선택 안 됨 */

      /* 1) 결과 규모 안내 (가상 데이터: 4건) */
      var intro = '오늘 뉴스 ' + headlines.length + '건을 찾았습니다. ' +
                  '최신 등록순 기사부터 기사 제목을 말씀드리겠습니다. ' +
                  '스페이스 키로 다음 기사로 넘기실 수 있습니다.';
      TTS.speak(intro, function () {
        if (self.cancelled) return;
        /* 2) 제목을 하나씩 순서대로 — 각 사이 짧은 숨 */
        self.readHeadlines(headlines, 0);
      });
    },

    readHeadlines: function (list, i) {
      if (this.cancelled) return;
      if (i >= list.length) {
        /* 모든 제목을 다 읽음 — 단계 2B에서 다음 안내(어떤 기사 자세히?) 추가 예정 */
        this.speaking = false;
        return;
      }
      var self = this;
      this.focusIndex = i;
      this.highlightCard(i);
      var text = (i + 1) + '번째 기사. ' + list[i] + '.';
      TTS.speak(text, function () {
        if (self.cancelled) return;
        /* 제목 사이 0.6초 짧은 숨 */
        setTimeout(function () {
          self.readHeadlines(list, i + 1);
        }, 600);
      });
    },

    /* 사용자가 스페이스를 눌렀을 때: 자동 재생을 멈추고 다음 항목으로 직접 이동.
       그 항목의 제목을 한 번 더 읽어준다. */
    nextItem: function () {
      if (!this.headlines || this.headlines.length === 0) return;
      /* 진행 중인 자동 재생 중단 */
      if (window.speechSynthesis) window.speechSynthesis.cancel();
      var nextIdx = this.focusIndex + 1;
      if (nextIdx >= this.headlines.length) {
        /* 마지막 항목을 넘어가면 처음으로 순환 */
        nextIdx = 0;
        TTS.speak('처음 기사로 돌아갑니다.', function () {
          ResultsScreen.speakFocusedItem(nextIdx);
        });
        return;
      }
      this.speakFocusedItem(nextIdx);
    },

    speakFocusedItem: function (i) {
      this.focusIndex = i;
      this.highlightCard(i);
      var text = (i + 1) + '번째 기사. ' + this.headlines[i] + '.';
      TTS.speak(text);
    },

    /* 현재 포커스된 카드에 시각적 표시 (저시력 사용자가 위치를 인지) */
    highlightCard: function (i) {
      var cards = screens.results.querySelectorAll('.article-card');
      cards.forEach(function (c, idx) {
        if (idx === i) c.classList.add('focused');
        else c.classList.remove('focused');
      });
    },

    onLeave: function () {
      this.cancelled = true;
      this.speaking = false;
      this.focusIndex = -1;
      if (window.speechSynthesis) window.speechSynthesis.cancel();
    }
  };

  screenHooks.results = {
    onEnter: function () { ResultsScreen.onEnter(); },
    onLeave: function () { ResultsScreen.onLeave(); }
  };

  /* ============================================================
     화면별 스페이스 동작 등록 (메인·결과·기타)
     ============================================================ */

  /* 메인 화면: 스페이스 = 마이크 토글 (기존 화면 탭 동작과 동일) */
  KeyHandlers.register('main', function () {
    Main.toggle();
  });

  /* 결과 화면: 스페이스 = 다음 항목으로 (A+B 결합의 B 케이스) */
  KeyHandlers.register('results', function () {
    ResultsScreen.nextItem();
  });

  /* 상세·스크랩·설정 화면: 단계 2B·2C에서 정의 예정.
     지금은 스페이스를 눌러도 동작 없음 (등록되지 않은 화면은 무시). */

  /* 상세·스크랩·설정의 onLeave에서도 음성 정리 (단계 2B·2C에서 onEnter 추가) */
  ['detail', 'scraps', 'settings'].forEach(function (s) {
    screenHooks[s] = screenHooks[s] || {};
    screenHooks[s].onLeave = function () {
      if (window.speechSynthesis) window.speechSynthesis.cancel();
    };
  });

  Main.init();

  /* VoiceInput의 결과를 누가 처리할지 라우팅:
     현재 메인 화면이라면 Main으로, 진입 환영 흐름이면 환영 로직으로 */
  var originalOnResult = VoiceInput.onResult;
  VoiceInput.onResult = function (text) {
    if (current === 'main') {
      Main.handleResult(text);
    } else {
      if (originalOnResult) originalOnResult(text);
    }
  };

  /* 스크랩 토글 (단계 1: 시각적 상태만 토글) */
  var scrapToggle = document.getElementById('scrap-toggle');
  if (scrapToggle) {
    var scrapped = false;
    scrapToggle.addEventListener('click', function () {
      scrapped = !scrapped;
      scrapToggle.querySelector('span').textContent = scrapped ? '★' : '☆';
      scrapToggle.setAttribute('aria-label', scrapped ? '스크랩됨' : '스크랩하기');
    });
  }

  /* 설정 화면의 토글 버튼들 (단계 1: 시각적 상태만) */
  document.querySelectorAll('.toggle').forEach(function (t) {
    t.addEventListener('click', function () {
      var on = t.getAttribute('aria-checked') === 'true';
      t.setAttribute('aria-checked', !on);
      t.classList.toggle('on', !on);
      t.textContent = !on ? '켜짐' : '꺼짐';
      /* aria-label도 동기화 */
      var name = t.getAttribute('aria-label').replace(/켜짐|꺼짐/, '').trim();
      t.setAttribute('aria-label', name + ' ' + (!on ? '켜짐' : '꺼짐'));
    });
  });
})();

