'use strict';

/* ============================================================
   VoiceInput — 음성 인식 + 마이크 권한 안내
   ------------------------------------------------------------
   음성 인식을 시작하기 직전에 권한 상태에 따라 매번 다른 안내를
   먼저 들려주고, 그 다음 음성 인식을 시작한다.
   - 권한이 아직 없거나 거부 상태: 권한 팝업 안내 후 요청
   - 권한이 이미 허용됨: "지금 듣겠습니다" 안내 후 바로 듣기
   ============================================================ */

var VoiceInput = {
  recognition: null,
  supported: false,
  listening: false,
  continuous: false,        // 연속 듣기 모드 (onend 시 자동 재시작)
  _stopping: false,         // stop() 호출 중 플래그 (재시작 방지)
  onResult: null,
  onAnnounce: null,
  onError: null,

  /* 연속 듣기 모드 켜기/끄기. 켜면 인식 종료 시 자동으로 다시 시작된다. */
  setContinuous: function (on) {
    this.continuous = !!on;
  },

  init: function (announceFn, resultFn, errorFn) {
    this.onAnnounce = announceFn;
    this.onResult = resultFn;
    this.onError = errorFn;

    var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      this.supported = false;
      return false;
    }
    this.supported = true;
    this.recognition = new SR();
    this.recognition.lang = 'ko-KR';
    this.recognition.interimResults = false;
    this.recognition.maxAlternatives = 1;

    var self = this;
    this.recognition.onstart = function () {
      /* 사용자가 권한 팝업에서 "허용"을 누른 뒤 호출되는 시점.
         음성 인식이 실제로 활성된 순간이므로, 이때 후속 안내(질문 등)를 시작한다. */
      if (self._onStart) {
        var cb = self._onStart;
        self._onStart = null;
        cb();
      }
    };
    this.recognition.onresult = function (e) {
      var text = e.results[0][0].transcript;
      self.listening = false;
      if (self.onResult) self.onResult(text);
    };
    this.recognition.onerror = function (e) {
      self.listening = false;
      /* 권한 거부도 여기로 옴 — 진행 중이던 _onStart 콜백은 호출하지 않음 */
      self._onStart = null;
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        if (self.onError) self.onError('denied');
      } else if (e.error === 'no-speech') {
        if (self.onError) self.onError('no-speech');
      } else if (e.error === 'audio-capture') {
        if (self.onError) self.onError('no-mic');
      } else {
        if (self.onError) self.onError('unknown');
      }
    };
    this.recognition.onend = function () {
      self.listening = false;
      /* 연속 듣기 모드면 자동으로 다시 시작.
         사용자가 답할 때까지 마이크가 꺼지지 않게 한다.
         no-speech나 부정 응답으로 인식이 끝나도 다시 켜짐. */
      if (self.continuous && !self._stopping) {
        setTimeout(function () {
          if (self.continuous && !self._stopping) {
            self.beginListening();
          }
        }, 250);
      }
    };
    return true;
  },

  /* 현재 마이크 권한 상태 조회 — 'granted' / 'denied' / 'prompt' / 'unknown' */
  checkPermission: function () {
    if (!navigator.permissions || !navigator.permissions.query) {
      return Promise.resolve('unknown');
    }
    return navigator.permissions.query({ name: 'microphone' })
      .then(function (status) { return status.state; })
      .catch(function () { return 'unknown'; });
  },

  /* 권한 상태에 따라 매번 다른 안내를 들려준 뒤 음성 인식 시작.
     첫 인자 onPreSpeak는 안내 음성이 끝난 뒤 실제 듣기 시작 직전에
     호출되는 콜백 (UI에 "듣는 중..." 표시 등에 사용). */
  startWithAnnouncement: function (onPreSpeak) {
    if (!this.supported) {
      if (this.onAnnounce) {
        this.onAnnounce(
          '이 브라우저는 음성 인식을 지원하지 않습니다. ' +
          '아래 버튼을 눌러 진행해 주세요.',
          function () { if (this.onError) this.onError('unsupported'); }.bind(this)
        );
      }
      return;
    }
    if (this.listening) return;

    var self = this;
    this.checkPermission().then(function (state) {
      if (state === 'denied') {
        /* 차단됨 — 멘트만 안내하고 시작하지 않음 */
        if (self.onAnnounce) {
          self.onAnnounce(
            '마이크 권한이 차단되어 있습니다. ' +
            '브라우저 주소창 옆 자물쇠 아이콘에서 마이크를 허용으로 바꾼 뒤 ' +
            '아래 버튼을 다시 눌러 주세요.'
          );
        }
        return;
      }

      if (state === 'granted') {
        /* 이미 허용된 상태 — 짧은 신호 멘트 후 곧바로 듣기 시작.
           onstart 시점에 후속 안내(onPreSpeak)를 실행한다. */
        self._onStart = onPreSpeak || null;
        if (self.onAnnounce) {
          self.onAnnounce('지금부터 듣겠습니다.', function () {
            self.beginListening();
          });
        } else {
          self.beginListening();
        }
        return;
      }

      /* prompt 상태 — 권한 팝업이 곧 뜬다.
         (이전 환영 멘트에서 이미 안내했으므로 여기선 추가 음성 없이) 곧바로 권한 요청.
         사용자가 팝업에 응답하기 전까지는 어떤 음성도 자동으로 나가지 않는다.
         사용자가 허용을 누르면 onstart가 호출되고, 그 시점에 후속 안내가 실행된다. */
      self._onStart = onPreSpeak || null;
      self.beginListening();
    });
  },

  beginListening: function () {
    if (this.listening) return;
    this.listening = true;
    try {
      this.recognition.start();
    } catch (err) {
      this.listening = false;
      if (this.onError) this.onError('start-failed');
    }
  },

  stop: function () {
    /* 연속 듣기 모드도 끄고, 진행 중인 자동 재시작을 막는다. */
    this.continuous = false;
    this._stopping = true;
    if (this.recognition && this.listening) {
      try { this.recognition.stop(); } catch (e) {}
      this.listening = false;
    }
    /* 250ms 후 _stopping 해제 (onend 안에서 재시작이 막힌 뒤 풀어줌) */
    var self = this;
    setTimeout(function () { self._stopping = false; }, 400);
  }
};

/* "네/예/응" 류의 명확한 긍정 답변인지 판정.
   부분 매칭은 위험하다 — "시작하지 않을게요"에 "시작"이 들어 있다고
   긍정으로 인정하면 사용자 의도와 다르게 다음 단계로 넘어가 버린다.
   그래서 발화 전체가 화이트리스트 단어와 정확히 일치할 때만 긍정으로 본다. */
function isYesResponse(text) {
  if (!text) return false;
  /* 공백·구두점 제거 후 비교 */
  var t = text.trim().toLowerCase().replace(/[\s!.?,~"']/g, '');
  if (!t) return false;
  var yes = [
    '네', '넵', '네네',
    '예', '예예',
    '응', '응응',
    '맞아', '맞아요', '맞습니다',
    '좋아', '좋아요', '좋습니다',
    '네시작', '예시작', '응시작',
    '네시작해', '예시작해',
    '네좋아', '예좋아',
    '네좋아요', '예좋아요',
    'yes', 'ok', '오케이'
  ];
  for (var i = 0; i < yes.length; i++) {
    if (t === yes[i]) return true;
  }
  return false;
}
