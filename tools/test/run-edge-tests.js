/**
 * 경계 상황 테스트 — 이미 쌓여 있던 자료, 설정 오타, 서머타임, 마감 처리.
 *
 * 실행:  node tools/test/run-edge-tests.js
 */
const { loadApp, setConfig, formatDate, instantFromWall } = require('./harness');

let pass = 0, fail = 0;
const failures = [];

function check(name, got, want) {
  const ok = String(got) === String(want);
  if (ok) pass++;
  else { fail++; failures.push(name + ' (기대 ' + want + ' / 실제 ' + got + ')'); }
  console.log('   ' + (ok ? 'PASS' : 'FAIL') + '  ' + name + (ok ? '' : '   ← 기대 ' + want + ' / 실제 ' + got));
}

function prepare(opts) {
  const app = loadApp({
    spreadsheetTz: opts.spreadsheetTz,
    scriptTz: opts.scriptTz || 'Asia/Seoul',
    dateReadTz: opts.dateReadTz || 'sheet',
    now: opts.now
  });
  app.call('setupSpreadsheet');
  const block = app.ss.getSheetByName('상담불가');
  while (block.getLastRow() > 1) block.deleteRow(block.getLastRow());
  setConfig(app, 'AI 분석 사용', 'FALSE');
  setConfig(app, '신청 알림 메일', 'FALSE');
  if (opts.config) Object.keys(opts.config).forEach(function (k) { setConfig(app, k, opts.config[k]); });
  return app;
}

const NOW = instantFromWall('Asia/Seoul', 2026, 9, 14, 9, 0, 0);

/* ---------- 1. 예전에 쌓인 자료 되살리기 ---------- */

console.log('\n■ 1. 미국 시간대 시트에 이미 쌓여 있던 예약을 다시 설정하면');
(function () {
  // 고치기 전 코드가 남겼을 법한 상태: 상담일이 '날짜값'으로 들어 있고, 시트는 미국 시간대
  const app = loadApp({
    spreadsheetTz: 'America/Los_Angeles', scriptTz: 'Asia/Seoul', dateReadTz: 'script', now: NOW
  });
  app.call('setupSpreadsheet');

  const booking = app.ss.getSheetByName('예약');
  const headers = booking.getRange(1, 1, 1, booking.getLastColumn()).getValues()[0].map(String);
  const dateCol = headers.indexOf('상담일') + 1;

  // 옛 방식 그대로 흉내: 날짜 서식을 되돌리고 날짜값으로 한 줄 넣습니다.
  const rowNo = booking.getLastRow() + 1;
  const line = new Array(headers.length).fill('');
  line[headers.indexOf('예약번호')] = '260910-AB12';
  line[headers.indexOf('시작시각')] = '13:10';
  line[headers.indexOf('종료시각')] = '13:40';
  line[headers.indexOf('이름')] = '이순신';
  line[headers.indexOf('반')] = '10';
  line[headers.indexOf('상태')] = '예약됨';
  booking.appendRow(line);
  booking.getRange(rowNo, dateCol).setNumberFormat('yyyy-mm-dd').setValue('2026-09-18');

  check('고치기 전: 시트에 보이는 날짜', booking.getRange(rowNo, dateCol).getDisplayValue(), '2026-09-18');

  // 다시 [최초 설정 실행]
  app.call('setupSpreadsheet');

  check('정리 뒤: 시트에 보이는 날짜가 그대로', booking.getRange(rowNo, dateCol).getDisplayValue(), '2026-09-18');
  check('정리 뒤: 앱이 읽는 날짜', app.call('toDateKey_', booking.getRange(rowNo, dateCol).getValue(), app.call('getConfig').tz), '2026-09-18');

  const byDate = app.call('readBookingsByDate_', app.call('getConfig'));
  const found = Object.keys(byDate).filter(function (k) {
    return byDate[k].some(function (b) { return b.who.indexOf('이순신') >= 0; });
  })[0];
  check('정리 뒤: 상담 달력에 놓이는 날짜', found || '(없음)', '2026-09-18');
  check('시트 시간대가 표준 시간대로 맞춰짐', app.ss.getSpreadsheetTimeZone(), 'Asia/Seoul');
})();

/* ---------- 2. 표준 시간대에 이상한 값을 적었을 때 ---------- */

console.log('\n■ 2. [표준 시간대] 에 "KST" 처럼 잘못 적었을 때');
(function () {
  const app = prepare({ spreadsheetTz: 'Asia/Seoul', now: NOW, config: { '표준 시간대': 'KST' } });
  check('알아보지 못하는 값이면 시트 시간대로 되돌아감', app.call('getConfig').tz, 'Asia/Seoul');
  check('오늘 판정은 그대로', app.call('todayKey_', app.call('getConfig').tz), '2026-09-14');
})();

console.log('\n■ 3. [표준 시간대] 를 비워 두었을 때는 스크립트 시간대를 씁니다');
(function () {
  const app = prepare({ spreadsheetTz: 'America/New_York', scriptTz: 'Asia/Seoul', now: NOW, config: { '표준 시간대': '' } });
  check('스크립트 시간대가 쓰임', app.call('getConfig').tz, 'Asia/Seoul');
  // 비운 채로 [최초 설정 실행] 을 다시 누르면, 실제로 쓰는 값이 시트에 적혀야 합니다.
  app.call('setupSpreadsheet');
  check('설정 시트에 실제 값이 적힘', String(app.call('readConfigValue_', '표준 시간대')), 'Asia/Seoul');

  // 한국이 아닌 학교: 스크립트 시간대를 그 지역으로 맞춰 두면 그대로 따릅니다.
  const berlin = prepare({ spreadsheetTz: 'America/New_York', scriptTz: 'Europe/Berlin', now: NOW, config: { '표준 시간대': '' } });
  check('서울로 강제되지 않음', berlin.call('getConfig').tz, 'Europe/Berlin');

  // 설정 시트에 직접 적은 값이 가장 우선합니다.
  const explicit = prepare({ spreadsheetTz: 'America/New_York', scriptTz: 'Asia/Seoul', now: NOW, config: { '표준 시간대': 'Europe/Berlin' } });
  check('설정 시트 값이 가장 우선', explicit.call('getConfig').tz, 'Europe/Berlin');
})();

/* ---------- 4. 서머타임이 있는 지역 ---------- */

console.log('\n■ 4. 서머타임이 있는 학교 (Europe/Berlin), 전환 주간 예약');
(function () {
  // 2026-10-25 새벽에 서머타임이 끝납니다. 그 전후로 날짜가 밀리지 않아야 합니다.
  const now = instantFromWall('Europe/Berlin', 2026, 10, 22, 9, 0, 0);
  const app = prepare({
    spreadsheetTz: 'Europe/Berlin', now: now,
    config: { '표준 시간대': 'Europe/Berlin', '구글 캘린더 연동': 'TRUE', '예약 시작': 1, '예약 종료': 14 }
  });
  const avail = app.call('getAvailability');
  const target = avail.days.filter(function (d) { return d.status === 'open' && d.date >= '2026-10-26'; })[0];
  check('서머타임 종료 뒤 날짜를 고를 수 있음', target ? 'ok' : '(없음)', 'ok');
  if (!target) return;

  const slot = target.slots.filter(function (s) { return s.available; })[0];
  const res = app.call('submitReservation', {
    date: target.date, start: slot.start, studentNo: '3', name: '박보검',
    topic: '진로·진학', concern: '진로를 어떻게 정해야 할지 고민이 많습니다. 도와주세요 부탁드립니다.', aiConsent: true
  });
  check('신청 성공', res.ok ? 'ok' : res.message, 'ok');
  app.call('syncCalendarQuietly_');

  const booking = app.ss.getSheetByName('예약');
  const headers = booking.getRange(1, 1, 1, booking.getLastColumn()).getValues()[0].map(String);
  const dateCol = headers.indexOf('상담일') + 1;
  check('시트에 적힌 날짜', booking.getRange(booking.getLastRow(), dateCol).getDisplayValue(), target.date);

  const ev = app.calendarEvents[0];
  check('구글 캘린더 날짜', ev ? formatDate(ev.getStartTime(), 'Europe/Berlin', 'yyyy-MM-dd') : '(없음)', target.date);
  check('구글 캘린더 시각', ev ? formatDate(ev.getStartTime(), 'Europe/Berlin', 'HH:mm') : '(없음)', slot.start);
})();

/* ---------- 5. 마감·지난 시간 처리 ---------- */

console.log('\n■ 5. 오늘 이미 지난 시간은 막혀야 합니다');
(function () {
  // 오늘(월요일) 15:00 에 접속. 13:10 자리는 이미 지났습니다.
  const now = instantFromWall('Asia/Seoul', 2026, 9, 14, 15, 0, 0);
  const app = prepare({
    spreadsheetTz: 'America/Los_Angeles', now: now,
    config: { '예약 시작': 0, '예약 종료': 7, '마감 유예 시간(분)': 60 }
  });
  const avail = app.call('getAvailability');
  const today = avail.days.filter(function (d) { return d.date === '2026-09-14'; })[0];
  check('오늘이 목록에 있음', today ? today.date : '(없음)', '2026-09-14');
  if (!today) return;

  const past = today.slots.filter(function (s) { return s.start === '13:10'; })[0];
  check('지난 시간은 고를 수 없음', past ? String(past.available) : '(없음)', 'false');

  // 서버도 막아야 합니다.
  const res = app.call('submitReservation', {
    date: '2026-09-14', start: '13:10', studentNo: '5', name: '강감찬',
    topic: '학교생활', concern: '학교 생활에 적응이 어렵습니다. 이야기를 나누고 싶어요 도와주세요.', aiConsent: true
  });
  check('서버에서도 지난 시간 신청 거절', res.ok ? '통과됨(버그)' : '막힘', '막힘');
})();

/* ---------- 6. 한 학생이 두 번 신청 ---------- */

console.log('\n■ 6. 한 학생이 두 번 신청하면');
(function () {
  const app = prepare({ spreadsheetTz: 'America/New_York', now: NOW });
  const avail = app.call('getAvailability');
  const days = avail.days.filter(function (d) { return d.status === 'open'; });
  const who = { studentNo: '7', name: '유관순' };
  const mk = function (d) {
    return {
      date: d.date, start: d.slots.filter(function (s) { return s.available; })[0].start,
      studentNo: who.studentNo, name: who.name, topic: '가정',
      concern: '집에서 있었던 일 때문에 마음이 복잡합니다. 선생님과 이야기하고 싶어요.', aiConsent: true
    };
  };
  const first = app.call('submitReservation', mk(days[0]));
  check('첫 신청 성공', first.ok ? 'ok' : first.message, 'ok');
  const second = app.call('submitReservation', mk(days[1]));
  check('둘째 신청은 막힘', second.ok ? '통과됨(버그)' : '막힘', '막힘');

  // 취소하면 다시 신청할 수 있어야 합니다.
  const cancel = app.call('cancelReservation', first.bookingId, who.name);
  check('취소 성공', cancel.ok ? 'ok' : cancel.message, 'ok');
  const third = app.call('submitReservation', mk(days[1]));
  check('취소 뒤 재신청 성공', third.ok ? 'ok' : third.message, 'ok');
})();

/* ---------- 7. 예약 기간을 날짜로 못 박았을 때 ---------- */

console.log('\n■ 7. 예약 기간을 날짜로 지정했을 때');
(function () {
  const app = prepare({
    spreadsheetTz: 'Etc/UTC', now: NOW,
    config: { '예약 시작': '2026-09-21', '예약 종료': '2026-09-25' }
  });
  const avail = app.call('getAvailability');
  check('첫 날짜', avail.days[0].date, '2026-09-21');
  check('마지막 날짜', avail.days[avail.days.length - 1].date, '2026-09-25');

  const outside = app.call('submitReservation', {
    date: '2026-09-18', start: '13:10', studentNo: '9', name: '신사임당',
    topic: '기타', concern: '기간 밖 날짜로 신청이 되는지 확인하는 내용입니다. 충분히 길게 씁니다.', aiConsent: true
  });
  check('기간 밖 날짜는 거절', outside.ok ? '통과됨(버그)' : '막힘', '막힘');
})();

console.log('\n=== 결과: ' + pass + ' 통과 / ' + fail + ' 실패 ===');
if (failures.length) {
  console.log('\n실패 목록');
  failures.forEach(function (f, i) { console.log('  ' + (i + 1) + ') ' + f); });
}
process.exit(fail ? 1 : 0);
