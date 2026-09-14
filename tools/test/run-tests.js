/**
 * 학생이 고른 날짜가 그대로 기록되는지 확인합니다.
 *
 * 실행:  node tools/test/run-tests.js
 *
 * 시트 시간대와 학교가 실제로 쓰는 시간대가 다를 때 날짜가 하루 밀리는지,
 * 예약 시트·상담 달력·구글 캘린더 세 곳을 모두 봅니다.
 */
const { loadApp, setConfig, readBookingRows, formatDate, instantFromWall } = require('./harness');

const SCHOOL_TZ = 'Asia/Seoul'; // 학교가 실제로 쓰는 시간대

let pass = 0, fail = 0;
const failures = [];

function check(scenario, name, got, want) {
  const ok = String(got) === String(want);
  if (ok) pass++;
  else { fail++; failures.push(scenario + ' → ' + name + ' (기대 ' + want + ' / 실제 ' + got + ')'); }
  console.log('   ' + (ok ? 'PASS' : 'FAIL') + '  ' + name + (ok ? '' : '   ← 기대 ' + want + ' / 실제 ' + got));
}

function prepare(opts) {
  const app = loadApp({
    spreadsheetTz: opts.spreadsheetTz,
    scriptTz: 'Asia/Seoul',
    dateReadTz: opts.dateReadTz,
    now: opts.now
  });
  app.call('setupSpreadsheet');

  // 예시로 들어가는 상담불가 줄은 테스트에 방해가 되므로 비웁니다.
  const block = app.ss.getSheetByName('상담불가');
  while (block.getLastRow() > 1) block.deleteRow(block.getLastRow());

  setConfig(app, '구글 캘린더 연동', 'TRUE');
  setConfig(app, 'AI 분석 사용', 'FALSE');
  setConfig(app, '신청 알림 메일', 'FALSE');
  if (opts.config) Object.keys(opts.config).forEach(function (k) { setConfig(app, k, opts.config[k]); });
  return app;
}

function book(app, day, start, who) {
  return app.call('submitReservation', {
    date: day,
    start: start,
    studentNo: who.no,
    name: who.name,
    topic: '학업·성적',
    concern: '요즘 공부가 잘 안 되고 마음이 무겁습니다. 어떻게 해야 할지 모르겠어요.',
    aiConsent: true
  });
}

function runScenario(title, opts) {
  console.log('\n■ ' + title);
  console.log('   시트 시간대 ' + opts.spreadsheetTz +
    ' / 날짜 셀 해석 ' + (opts.dateReadTz === 'script' ? '스크립트 기준' : '시트 기준') +
    ' / 지금 ' + formatDate(opts.now, SCHOOL_TZ, 'yyyy-MM-dd HH:mm') + ' (한국)');

  const app = prepare(opts);
  const avail = app.call('getAvailability');
  const openDay = avail.days.filter(function (d) { return d.status === 'open'; })[0];
  if (!openDay) { check(title, '예약 가능한 날이 있다', 'none', 'some'); return; }
  const slot = openDay.slots.filter(function (s) { return s.available; })[0];
  const picked = openDay.date;

  const res = book(app, picked, slot.start, { no: '12', name: '홍길동' });
  if (!res.ok) { check(title, '신청 성공', res.message, 'ok'); return; }

  app.call('syncCalendarQuietly_');
  const rows = readBookingRows(app);
  const row = rows[rows.length - 1];

  // ① 시트에 실제로 보이는 상담일
  const sheet = app.ss.getSheetByName('예약');
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
  const dateCol = headers.indexOf('상담일') + 1;
  const shown = sheet.getRange(sheet.getLastRow(), dateCol).getDisplayValue();
  check(title, '① 예약 시트에 보이는 상담일', String(shown).slice(0, 10), picked);

  // ② 앱이 그 칸을 다시 읽었을 때
  const reread = app.call('toDateKey_', sheet.getRange(sheet.getLastRow(), dateCol).getValue(), app.call('getConfig').tz);
  check(title, '② 앱이 다시 읽은 상담일', reread, picked);

  // ③ 상담 달력 시트가 이 예약을 놓는 날짜
  const byDate = app.call('readBookingsByDate_', app.call('getConfig'));
  const calDays = Object.keys(byDate).filter(function (k) {
    return byDate[k].some(function (b) { return b.who.indexOf('홍길동') >= 0; });
  });
  check(title, '③ 상담 달력에 찍히는 날짜', calDays[0] || '(없음)', picked);

  // ④⑤ 구글 캘린더 일정 (학교 현지 시간으로 봤을 때)
  const ev = app.calendarEvents[0];
  check(title, '④ 구글 캘린더 날짜(학교 현지)', ev ? formatDate(ev.getStartTime(), SCHOOL_TZ, 'yyyy-MM-dd') : '(없음)', picked);
  check(title, '⑤ 구글 캘린더 시각(학교 현지)', ev ? formatDate(ev.getStartTime(), SCHOOL_TZ, 'HH:mm') : '(없음)', slot.start);

  // ⑥ 같은 자리를 다시 신청하면 막혀야 합니다 (되읽기가 제대로 되는지)
  const again = book(app, picked, slot.start, { no: '13', name: '김영희' });
  check(title, '⑥ 같은 자리 중복 신청 차단', again.ok ? '통과됨(버그)' : '막힘', '막힘');

  // ⑦ 앱이 아는 '오늘' 이 학교 현지 오늘과 같아야 마감 처리가 맞습니다
  check(title, '⑦ 앱이 아는 오늘', app.call('todayKey_', app.call('getConfig').tz), formatDate(opts.now, SCHOOL_TZ, 'yyyy-MM-dd'));

  // ⑧ 상담불가로 막아 둔 날짜가 그 날짜로 막히는가
  const app2 = prepare(opts);
  const blockSheet = app2.ss.getSheetByName('상담불가');
  const avail2 = app2.call('getAvailability');
  const target = avail2.days.filter(function (d) { return d.status === 'open'; })[1];
  if (target) {
    blockSheet.appendRow([target.date, '', '', '', '출장']);
    const after = app2.call('getAvailability');
    const day = after.days.filter(function (d) { return d.date === target.date; })[0];
    check(title, '⑧ 막아 둔 날짜가 그 날 막힘', day ? day.status : '(없음)', 'blocked');
  }
}

const NOW_MORNING = instantFromWall(SCHOOL_TZ, 2026, 9, 14, 9, 0, 0);
const NOW_NIGHT = instantFromWall(SCHOOL_TZ, 2026, 9, 14, 23, 30, 0);

console.log('=== 학생 상담 신청 · 날짜 기록 테스트 ===');

['sheet', 'script'].forEach(function (mode) {
  runScenario('A. 시트 시간대 = 서울 (정상), 오전 신청 [' + mode + ']', {
    spreadsheetTz: 'Asia/Seoul', dateReadTz: mode, now: NOW_MORNING
  });
  runScenario('B. 시트 시간대 = 서울 (정상), 밤 신청 [' + mode + ']', {
    spreadsheetTz: 'Asia/Seoul', dateReadTz: mode, now: NOW_NIGHT
  });
  runScenario('C. 시트 시간대 = 미국 태평양, 오전 신청 [' + mode + ']', {
    spreadsheetTz: 'America/Los_Angeles', dateReadTz: mode, now: NOW_MORNING
  });
  runScenario('D. 시트 시간대 = 미국 동부, 밤 신청 [' + mode + ']', {
    spreadsheetTz: 'America/New_York', dateReadTz: mode, now: NOW_NIGHT
  });
  runScenario('E. 시트 시간대 = UTC, 오전 신청 [' + mode + ']', {
    spreadsheetTz: 'Etc/UTC', dateReadTz: mode, now: NOW_MORNING
  });
});

console.log('\n=== 결과: ' + pass + ' 통과 / ' + fail + ' 실패 ===');
if (failures.length) {
  console.log('\n실패 목록');
  failures.forEach(function (f, i) { console.log('  ' + (i + 1) + ') ' + f); });
}
process.exit(fail ? 1 : 0);
