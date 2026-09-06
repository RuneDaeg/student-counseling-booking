/**
 * 예약 접수 · 취소 · 교사 알림
 */

const MAX_TEXT = 4000;

/** 학생이 [신청하기]를 누르면 실행됩니다. */
function submitReservation(payload) {
  const cfg = getConfig();
  const tz = cfg.tz;
  payload = payload || {};

  const data = {
    date: String(payload.date || '').trim(),
    start: String(payload.start || '').trim(),
    // 설정에 고정 학년·반이 있으면 학생이 보낸 값 대신 그것을 씁니다.
    grade: cfg.fixedGrade || clean_(payload.grade, 10),
    classNo: cfg.fixedClass || clean_(payload.classNo, 10),
    studentNo: clean_(payload.studentNo, 10),
    name: clean_(payload.name, 30),
    topic: clean_(payload.topic, 40),
    concern: clean_(payload.concern, MAX_TEXT),
    aiConsent: payload.aiConsent === true
  };

  const problem = validate_(cfg, data);
  if (problem) return { ok: false, message: problem };

  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
  } catch (e) {
    return { ok: false, message: '지금 신청이 몰리고 있습니다. 잠시 뒤 다시 눌러 주세요.' };
  }

  let row;
  let bookingId;
  try {
    const slotProblem = isSlotOpen_(cfg, data.date, data.start);
    if (slotProblem) return { ok: false, message: slotProblem, refresh: true };

    const dup = countActiveBookings_(cfg, data);
    if (dup >= cfg.maxPerStudent) {
      return {
        ok: false,
        message: '이미 신청한 상담이 있습니다. (동시에 ' + cfg.maxPerStudent + '건까지 신청할 수 있어요)\n' +
          '시간을 바꾸고 싶다면 먼저 기존 신청을 취소해 주세요.'
      };
    }

    const sheet = getSheet_(SHEET_BOOKING);
    const table = readTable_(sheet);
    bookingId = makeBookingId_(tz, table);
    const startMin = parseTimeToMinutes_(data.start, tz, 0);

    row = new Array(table.headers.length).fill('');
    setCell_(row, table.index, '예약번호', bookingId);
    setCell_(row, table.index, '신청시각', new Date());
    setCell_(row, table.index, '상담일', data.date);
    setCell_(row, table.index, '시작시각', minutesToTime_(startMin));
    setCell_(row, table.index, '종료시각', minutesToTime_(startMin + cfg.slotMinutes));
    setCell_(row, table.index, '학년', data.grade);
    setCell_(row, table.index, '반', data.classNo);
    setCell_(row, table.index, '번호', data.studentNo);
    setCell_(row, table.index, '이름', data.name);
    setCell_(row, table.index, '상담유형', data.topic);
    setCell_(row, table.index, '고민내용', data.concern);
    setCell_(row, table.index, 'AI분석동의', data.aiConsent ? '동의' : '미동의');
    setCell_(row, table.index, '상태', STATUS_ACTIVE);
    sheet.appendRow(row);
    sheet.getRange(sheet.getLastRow(), table.index['고민내용'] + 1).setWrap(true);
  } finally {
    lock.releaseLock();
  }

  const willAnalyze = cfg.aiEnabled && data.concern && (data.aiConsent || !cfg.aiConsentRequired);
  if (willAnalyze) {
    scheduleAnalysis_(); // 분석이 끝나면 그때 교사에게 메일이 갑니다.
  } else if (cfg.notifyMail) {
    try {
      notifyTeacher_(cfg, bookingFromRow_(cfg, rowToObject_(row)), null);
    } catch (e) {
      console.error('알림 메일 실패: ' + e.message);
    }
  }

  return {
    ok: true,
    bookingId: bookingId,
    dateLabel: formatDayLabel_(data.date),
    timeLabel: data.start + ' ~ ' + minutesToTime_(parseTimeToMinutes_(data.start, tz, 0) + cfg.slotMinutes),
    name: data.name
  };
}

/** 학생이 예약번호로 직접 취소합니다. */
function cancelReservation(bookingId, name) {
  const cfg = getConfig();
  const id = String(bookingId || '').trim().toUpperCase();
  const who = String(name || '').trim();
  if (!id || !who) return { ok: false, message: '예약번호와 이름을 모두 입력해 주세요.' };

  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
  } catch (e) {
    return { ok: false, message: '잠시 뒤 다시 시도해 주세요.' };
  }
  try {
    const sheet = getSheet_(SHEET_BOOKING);
    const table = readTable_(sheet);
    for (let i = 0; i < table.rows.length; i++) {
      const row = table.rows[i];
      if (String(row[table.index['예약번호']]).trim().toUpperCase() !== id) continue;
      if (String(row[table.index['이름']]).trim() !== who) {
        return { ok: false, message: '예약번호와 이름이 맞지 않습니다.' };
      }
      if (String(row[table.index['상태']]).trim() === STATUS_CANCELED) {
        return { ok: false, message: '이미 취소된 신청입니다.' };
      }
      sheet.getRange(i + 2, table.index['상태'] + 1).setValue(STATUS_CANCELED);
      const dateKey = toDateKey_(row[table.index['상담일']], cfg.tz);
      return {
        ok: true,
        message: formatDayLabel_(dateKey) + ' ' + minutesToTime_(parseTimeToMinutes_(row[table.index['시작시각']], cfg.tz, 0)) + ' 신청을 취소했습니다.'
      };
    }
    return { ok: false, message: '그런 예약번호를 찾지 못했습니다.' };
  } finally {
    lock.releaseLock();
  }
}

/* ---------- 내부 도우미 ---------- */

function validate_(cfg, d) {
  if (!d.date || !d.start) return '상담 날짜와 시간을 골라 주세요.';
  if (!d.grade || !d.classNo || !d.studentNo) return '학년·반·번호를 모두 입력해 주세요.';
  if (!d.name) return '이름을 입력해 주세요.';

  // 주제는 고르지 않아도 되지만, 목록에 없는 값이 오면 막습니다.
  if (d.topic && cfg.topics.length && cfg.topics.indexOf(d.topic) < 0) return '상담 주제를 다시 골라 주세요.';
  if (d.concern.replace(/\s/g, '').length < cfg.minChars) {
    return '상담 내용을 ' + cfg.minChars + '자 이상 적어 주세요. 자세할수록 선생님이 더 잘 준비할 수 있어요.';
  }
  return '';
}

function clean_(v, max) {
  const s = String(v === undefined || v === null ? '' : v);
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === 127 || (c < 32 && c !== 9 && c !== 10 && c !== 13)) continue;
    out += s.charAt(i);
  }
  return out.trim().slice(0, max);
}

function setCell_(row, index, header, value) {
  if (index[header] !== undefined) row[index[header]] = value;
}

function rowToObject_(row) {
  const sheet = getSheet_(SHEET_BOOKING);
  const table = readTable_(sheet);
  const obj = {};
  Object.keys(table.index).forEach(function (h) { obj[h] = row[table.index[h]]; });
  return obj;
}

function makeBookingId_(tz, table) {
  const used = {};
  table.rows.forEach(function (r) { used[String(r[table.index['예약번호']]).trim().toUpperCase()] = true; });
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 헷갈리는 글자 제외
  for (let attempt = 0; attempt < 50; attempt++) {
    let tail = '';
    for (let i = 0; i < 4; i++) tail += chars.charAt(Math.floor(Math.random() * chars.length));
    const id = Utilities.formatDate(new Date(), tz, 'yyMMdd') + '-' + tail;
    if (!used[id]) return id;
  }
  return Utilities.formatDate(new Date(), tz, 'yyMMddHHmmss');
}

/** 같은 학생의 앞으로 남은 예약 건수 */
function countActiveBookings_(cfg, d) {
  const sheet = getSheet_(SHEET_BOOKING);
  const table = readTable_(sheet);
  const today = todayKey_(cfg.tz);
  let n = 0;
  table.rows.forEach(function (row) {
    if (String(row[table.index['상태']]).trim() !== STATUS_ACTIVE) return;
    const dateKey = toDateKey_(row[table.index['상담일']], cfg.tz);
    if (dateKey < today) return;
    const same = String(row[table.index['학년']]).trim() === d.grade &&
      String(row[table.index['반']]).trim() === d.classNo &&
      String(row[table.index['번호']]).trim() === d.studentNo &&
      String(row[table.index['이름']]).trim() === d.name;
    if (same) n++;
  });
  return n;
}

function bookingFromRow_(cfg, obj) {
  return {
    id: String(obj['예약번호'] || '').trim(),
    dateKey: toDateKey_(obj['상담일'], cfg.tz),
    start: minutesToTime_(parseTimeToMinutes_(obj['시작시각'], cfg.tz, 0)),
    end: minutesToTime_(parseTimeToMinutes_(obj['종료시각'], cfg.tz, 0)),
    grade: String(obj['학년'] || ''),
    classNo: String(obj['반'] || ''),
    studentNo: String(obj['번호'] || ''),
    name: String(obj['이름'] || ''),
    topic: String(obj['상담유형'] || ''),
    concern: String(obj['고민내용'] || ''),
    consent: String(obj['AI분석동의'] || '') === '동의',
    status: String(obj['상태'] || '')
  };
}

/* ---------- 교사 알림 메일 ---------- */

function notifyTeacher_(cfg, booking, analysis) {
  if (!cfg.notifyMail || !cfg.teacherEmail) return;
  const who = booking.grade + '학년 ' + booking.classNo + '반 ' + booking.studentNo + '번 ' + booking.name;
  const subject = '[상담 신청] ' + formatDayLabel_(booking.dateKey) + ' ' + booking.start + ' · ' + who +
    (analysis && analysis.risk_level === '높음' ? ' · 확인 필요' : '');

  const html =
    '<div style="font-family:-apple-system,Segoe UI,Roboto,\'Malgun Gothic\',sans-serif;font-size:14px;color:#1f2430;line-height:1.65;max-width:720px">' +
    '<h2 style="margin:0 0 4px;font-size:18px">상담 신청이 들어왔습니다</h2>' +
    '<p style="margin:0 0 16px;color:#5b6472">예약번호 ' + esc_(booking.id) + '</p>' +
    '<table style="border-collapse:collapse;width:100%;margin-bottom:20px">' +
    tr_('일시', formatDayLabel_(booking.dateKey) + ' ' + booking.start + ' ~ ' + booking.end) +
    tr_('학생', who) +
    tr_('상담 주제', booking.topic || '-') +
    '</table>' +
    '<h3 style="font-size:15px;margin:0 0 6px">학생이 쓴 내용</h3>' +
    '<div style="white-space:pre-wrap;background:#f6f7f9;border-radius:8px;padding:12px 14px;margin-bottom:20px">' + esc_(booking.concern) + '</div>' +
    (analysis ? renderAnalysisHtml_(analysis) : '<p style="color:#5b6472">AI 분석은 진행하지 않았습니다.</p>') +
    '<p style="color:#8a93a3;font-size:12px;margin-top:24px">학생이 직접 쓴 글과 AI가 정리한 초안입니다. 최종 판단과 상담 진행은 선생님께서 해 주세요.</p>' +
    '</div>';

  MailApp.sendEmail({ to: cfg.teacherEmail, subject: subject, htmlBody: html });
}

function tr_(label, value) {
  return '<tr>' +
    '<td style="padding:6px 12px 6px 0;color:#5b6472;white-space:nowrap;vertical-align:top">' + esc_(label) + '</td>' +
    '<td style="padding:6px 0;font-weight:600">' + esc_(value) + '</td></tr>';
}

function esc_(s) {
  return String(s === undefined || s === null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** 메뉴: 오늘 상담 브리핑 */
function sendTodayBriefing() {
  const cfg = getConfig();
  const ui = SpreadsheetApp.getUi();
  if (!cfg.teacherEmail) {
    ui.alert('설정 시트의 [담당 교사 이메일]을 먼저 채워 주세요.');
    return;
  }
  const today = todayKey_(cfg.tz);
  const sheet = getSheet_(SHEET_BOOKING);
  const table = readTable_(sheet);
  const items = [];
  table.rows.forEach(function (row) {
    const obj = {};
    Object.keys(table.index).forEach(function (h) { obj[h] = row[table.index[h]]; });
    if (String(obj['상태']).trim() === STATUS_CANCELED) return;
    if (toDateKey_(obj['상담일'], cfg.tz) !== today) return;
    items.push(obj);
  });
  if (!items.length) {
    ui.alert('오늘 예정된 상담이 없습니다.');
    return;
  }
  items.sort(function (a, b) {
    return parseTimeToMinutes_(a['시작시각'], cfg.tz, 0) - parseTimeToMinutes_(b['시작시각'], cfg.tz, 0);
  });

  let html = '<div style="font-family:-apple-system,Segoe UI,Roboto,\'Malgun Gothic\',sans-serif;font-size:14px;line-height:1.65;color:#1f2430;max-width:760px">' +
    '<h2 style="font-size:18px;margin:0 0 16px">' + formatDayLabel_(today) + ' 상담 ' + items.length + '건</h2>';
  items.forEach(function (obj) {
    const b = bookingFromRow_(cfg, obj);
    html += '<div style="border:1px solid #e3e6ec;border-radius:10px;padding:14px 16px;margin-bottom:14px">' +
      '<div style="font-weight:700;margin-bottom:6px">' + esc_(b.start) + ' ~ ' + esc_(b.end) + ' · ' +
      esc_(b.grade + '-' + b.classNo + '-' + b.studentNo + ' ' + b.name) + ' · ' + esc_(b.topic) + '</div>' +
      '<div style="color:#5b6472;margin-bottom:8px">' + esc_(String(obj['AI 요약'] || '(요약 없음)')) + '</div>' +
      (obj['AI 관심신호'] ? '<div style="margin-bottom:8px"><b>관심신호</b> ' + esc_(String(obj['AI 관심신호'])) + '</div>' : '') +
      '<details><summary style="cursor:pointer;color:#3b6fd4">상담 초안 펼치기</summary>' +
      '<div style="white-space:pre-wrap;margin-top:8px">' + esc_(String(obj['AI 상담 초안'] || '')) + '</div></details>' +
      '</div>';
  });
  html += '</div>';

  MailApp.sendEmail({
    to: cfg.teacherEmail,
    subject: '[오늘의 상담] ' + formatDayLabel_(today) + ' · ' + items.length + '건',
    htmlBody: html
  });
  ui.alert(cfg.teacherEmail + ' 로 브리핑을 보냈습니다.');
}
