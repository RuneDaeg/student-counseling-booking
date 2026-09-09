/**
 * 공통 상수 · 설정 시트 읽기 · 날짜/시간 유틸
 *
 * powered by 여광재 (온양고등학교)
 * https://github.com/RuneDaeg/student-counseling-booking
 *
 * Copyright 2026 여광재 (온양고등학교)
 * SPDX-License-Identifier: Apache-2.0
 */

const SHEET_CONFIG = '설정';
const SHEET_BLOCK = '상담불가';
const SHEET_BOOKING = '예약';

const PROP_SS_ID = 'SPREADSHEET_ID';
const PROP_API_KEY = 'AI_API_KEY';
// 워크스페이스에 묶이지 않은 조직 단위 키를 쓸 때만 필요합니다.
const PROP_WORKSPACE_ID = 'ANTHROPIC_WORKSPACE_ID';

const STATUS_ACTIVE = '예약됨';
const STATUS_CANCELED = '취소됨';
const STATUS_DONE = '상담완료';

/** 설정 시트의 기본값: [항목, 기본값, 설명] */
const CONFIG_DEFAULTS = [
  ['앱 제목', '상담 신청', '학생에게 보이는 웹앱 제목입니다.'],
  ['안내 문구', '상담을 원하는 날짜와 시간을 고르고, 하고 싶은 이야기를 편하게 적어 주세요.', '첫 화면 상단 안내문입니다.'],
  ['상담 시간대', '13:10, 16:30', '학생이 고를 수 있는 시작 시각. 쉼표로 구분합니다. 예: 13:10, 16:30'],
  ['요일별 추가 시간대', '수:15:30, 금:15:30', '그 요일에만 더 여는 시간. 예: 수:15:30, 금:15:30 (없으면 비워 두세요)'],
  ['상담 1회 시간(분)', 30, '상담 한 건의 길이입니다. 끝나는 시각을 계산할 때 씁니다.'],
  ['운영 요일', '월,화,수,목,금', '상담을 받는 요일. 쉼표로 구분합니다.'],
  ['예약 시작', 1, '숫자면 오늘부터 며칠 뒤(0=오늘), 날짜면 그 날부터. 예: 1 또는 2026-09-15'],
  ['예약 종료', 21, '숫자면 오늘부터 며칠 뒤, 날짜면 그 날까지. 예: 21 또는 2026-10-15'],
  ['같은 시간대 최대 인원', 1, '한 시간대에 받을 수 있는 학생 수입니다.'],
  ['학생 1인 동시 예약 수', 1, '한 학생이 동시에 가질 수 있는 예약 건수입니다.'],
  ['마감 유예 시간(분)', 60, '상담 시작 몇 분 전까지 신청을 받을지 정합니다.'],
  ['고정 학년', 2, '모든 신청자가 같은 학년이면 적어 두세요. 학생은 입력하지 않습니다. 비우면 직접 입력합니다.'],
  ['고정 반', 10, '모든 신청자가 같은 반이면 적어 두세요. 비우면 학생이 직접 입력합니다.'],
  ['상담 유형', '학업·성적,교우관계,진로·진학,가정,정서·마음건강,학교생활,기타', '학생이 고를 수 있는 상담 주제입니다.'],
  ['고민 최소 글자수', 20, '상담 내용을 최소 몇 자 이상 쓰게 할지 정합니다.'],
  ['담당 교사 이메일', '', '비워 두면 이 스크립트를 배포한 계정으로 보냅니다.'],
  ['신청 알림 메일', 'TRUE', '학생이 신청하면 교사에게 메일을 보냅니다.'],
  ['AI 분석 사용', 'TRUE', '학생이 쓴 고민을 AI가 정리해 상담 초안을 만듭니다.'],
  ['AI 분석 동의 필수', 'TRUE', 'TRUE면 학생이 동의한 경우에만 AI가 분석합니다.'],
  ['AI 제공자', 'claude', 'claude / gemini / openai 중 하나. 바꾸면 [② AI 키 등록]에서 키도 그 회사 것으로 바꿔 주세요.'],
  ['AI 모델', '', '비워 두면 제공자별 기본 모델을 씁니다. 예: claude-opus-5 / gemini-2.5-flash / gpt-4o'],
  ['AI 분석 강도', 'medium', 'low / medium / high 중에서 고릅니다. 높을수록 꼼꼼하지만 느립니다.']
];

const DOW_NAMES = ['월', '화', '수', '목', '금', '토', '일']; // 1(월) ~ 7(일)

/** 스프레드시트 핸들. 바인딩된 시트가 없으면 스크립트 속성의 ID를 씁니다. */
function getSpreadsheet_() {
  const active = SpreadsheetApp.getActiveSpreadsheet();
  if (active) return active;
  const id = PropertiesService.getScriptProperties().getProperty(PROP_SS_ID);
  if (id) return SpreadsheetApp.openById(id);
  throw new Error('스프레드시트를 찾을 수 없습니다. 스크립트 속성에 ' + PROP_SS_ID + ' 를 넣거나, 스프레드시트에 연결된 스크립트로 만들어 주세요.');
}

function getSheet_(name) {
  const sheet = getSpreadsheet_().getSheetByName(name);
  if (!sheet) throw new Error('"' + name + '" 시트가 없습니다. 메뉴에서 [상담 관리 > 최초 설정 실행]을 먼저 눌러 주세요.');
  return sheet;
}

function getTimeZone_() {
  return getSpreadsheet_().getSpreadsheetTimeZone() || Session.getScriptTimeZone() || 'Asia/Seoul';
}

/** 설정 시트를 읽어 사용하기 쉬운 형태로 돌려줍니다. */
function getConfig() {
  const tz = getTimeZone_();
  const raw = {};
  const sheet = getSpreadsheet_().getSheetByName(SHEET_CONFIG);
  if (sheet && sheet.getLastRow() > 1) {
    sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).getValues().forEach(function (row) {
      const key = String(row[0]).trim();
      if (key) raw[key] = row[1];
    });
  }
  // 비워 두는 것이 의미 있는 항목은 기본값으로 되돌리지 않습니다.
  const keepBlank = ['담당 교사 이메일', '고정 학년', '고정 반', '요일별 추가 시간대', 'AI 모델'];
  CONFIG_DEFAULTS.forEach(function (def) {
    if (raw[def[0]] === undefined || (raw[def[0]] === '' && keepBlank.indexOf(def[0]) < 0)) {
      raw[def[0]] = def[1];
    }
  });

  const today = todayKey_(tz);
  const rangeStart = resolveRangeKey_(raw['예약 시작'], tz, today, 1);
  const rangeEnd = resolveRangeKey_(raw['예약 종료'], tz, today, 21);

  return {
    tz: tz,
    title: str_(raw['앱 제목'], '상담 신청'),
    notice: str_(raw['안내 문구'], ''),
    slotTimes: parseTimeList_(raw['상담 시간대'], tz),
    extraSlotTimes: parseDowTimes_(raw['요일별 추가 시간대'], tz),
    slotMinutes: Math.max(5, num_(raw['상담 1회 시간(분)'], 30)),
    weekdays: parseWeekdays_(raw['운영 요일']),
    fixedGrade: str_(raw['고정 학년'], ''),
    fixedClass: str_(raw['고정 반'], ''),
    rangeStartKey: rangeStart,
    firstKey: rangeStart < today ? today : rangeStart, // 이미 지난 시작일은 오늘로 당깁니다
    lastKey: rangeEnd,
    capacity: Math.max(1, num_(raw['같은 시간대 최대 인원'], 1)),
    maxPerStudent: Math.max(1, num_(raw['학생 1인 동시 예약 수'], 1)),
    cutoffMinutes: Math.max(0, num_(raw['마감 유예 시간(분)'], 60)),
    topics: splitList_(raw['상담 유형']),
    minChars: Math.max(0, num_(raw['고민 최소 글자수'], 20)),
    teacherEmail: str_(raw['담당 교사 이메일'], '') || getOwnerEmail_(),
    notifyMail: bool_(raw['신청 알림 메일'], true),
    aiEnabled: bool_(raw['AI 분석 사용'], true),
    aiConsentRequired: bool_(raw['AI 분석 동의 필수'], true),
    aiProvider: str_(raw['AI 제공자'], 'claude').toLowerCase(),
    aiModel: str_(raw['AI 모델'], ''),
    aiEffort: str_(raw['AI 분석 강도'], 'medium').toLowerCase()
  };
}

function getOwnerEmail_() {
  try {
    return Session.getEffectiveUser().getEmail() || '';
  } catch (e) {
    return '';
  }
}

/* ---------- 값 변환 유틸 ---------- */

function str_(v, fallback) {
  if (v === undefined || v === null) return fallback;
  const s = String(v).trim();
  return s === '' ? fallback : s;
}

function num_(v, fallback) {
  // 빈칸을 0 으로 읽지 않도록 합니다. (Number('') 은 0 입니다)
  if (v === undefined || v === null || String(v).trim() === '') return fallback;
  const n = Number(v);
  return isNaN(n) ? fallback : n;
}

function bool_(v, fallback) {
  if (v === undefined || v === null || v === '') return fallback;
  if (typeof v === 'boolean') return v;
  const s = String(v).trim().toLowerCase();
  if (['true', 'y', 'yes', '1', '예', 'o', 'ㅇ', '사용'].indexOf(s) >= 0) return true;
  if (['false', 'n', 'no', '0', '아니오', 'x', '미사용'].indexOf(s) >= 0) return false;
  return fallback;
}

function splitList_(v) {
  return String(v || '')
    .split(/[,\n]/)
    .map(function (s) { return s.trim(); })
    .filter(function (s) { return s !== ''; });
}

/** '월,화,수' → [1,2,3] (1=월 … 7=일) */
function parseWeekdays_(v) {
  const list = splitList_(v);
  const out = [];
  list.forEach(function (item) {
    const ch = item.replace(/요일/g, '').charAt(0);
    const idx = DOW_NAMES.indexOf(ch);
    if (idx >= 0 && out.indexOf(idx + 1) < 0) out.push(idx + 1);
  });
  return out.length ? out : [1, 2, 3, 4, 5];
}

/**
 * 예약 기간 설정값을 실제 날짜(yyyy-MM-dd)로 바꿉니다.
 * - '2026-09-15' 또는 날짜 셀  → 그 날짜 그대로 (기간 고정)
 * - 21 같은 숫자              → 오늘부터 21일 뒤 (기간이 매일 밀림)
 */
function resolveRangeKey_(v, tz, todayKey, fallbackDays) {
  const asDate = toDateKey_(v, tz);
  if (asDate) return asDate;
  return addDaysKey_(todayKey, Math.max(0, num_(v, fallbackDays)));
}

/** '13:10, 16:30' → [790, 990] (자정부터의 분, 오름차순) */
function parseTimeList_(v, tz) {
  const out = [];
  splitList_(v).forEach(function (item) {
    const min = parseTimeToMinutes_(item, tz, -1);
    if (min >= 0 && min < 24 * 60 && out.indexOf(min) < 0) out.push(min);
  });
  return out.sort(function (a, b) { return a - b; });
}

/** '수:15:30, 금:15:30' → { 3: [930], 5: [930] }  (1=월 … 7=일) */
function parseDowTimes_(v, tz) {
  const out = {};
  splitList_(v).forEach(function (item) {
    const m = String(item).match(/^\s*([^:=]+?)\s*[:=]\s*(.+)$/);
    if (!m) return;
    const dowIdx = DOW_NAMES.indexOf(m[1].replace(/요일/g, '').charAt(0));
    if (dowIdx < 0) return;
    const min = parseTimeToMinutes_(m[2], tz, -1);
    if (min < 0 || min >= 24 * 60) return;
    const dow = dowIdx + 1;
    if (!out[dow]) out[dow] = [];
    if (out[dow].indexOf(min) < 0) out[dow].push(min);
  });
  return out;
}

/** 그 요일에 열리는 시작 시각 목록 (공통 + 요일별 추가) */
function slotStartsFor_(cfg, dow) {
  const list = cfg.slotTimes.slice();
  (cfg.extraSlotTimes[dow] || []).forEach(function (m) {
    if (list.indexOf(m) < 0) list.push(m);
  });
  return list.sort(function (a, b) { return a - b; });
}

/** '15:30' 또는 시간 형식 셀(Date) → 자정부터의 분 */
function parseTimeToMinutes_(v, tz, fallback) {
  if (v === undefined || v === null || v === '') return fallback;
  if (Object.prototype.toString.call(v) === '[object Date]') {
    const hh = Number(Utilities.formatDate(v, tz, 'HH'));
    const mm = Number(Utilities.formatDate(v, tz, 'mm'));
    return hh * 60 + mm;
  }
  const s = String(v).trim();
  const m = s.match(/(\d{1,2})\s*[:시]\s*(\d{1,2})?/);
  if (!m) {
    const only = s.match(/^(\d{1,2})$/);
    return only ? Number(only[1]) * 60 : fallback;
  }
  return Number(m[1]) * 60 + Number(m[2] || 0);
}

function minutesToTime_(min) {
  return pad2_(Math.floor(min / 60)) + ':' + pad2_(min % 60);
}

function pad2_(n) {
  return (n < 10 ? '0' : '') + n;
}

/* ---------- 날짜 키(yyyy-MM-dd) 유틸 ---------- */

function todayKey_(tz) {
  return Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
}

function nowMinutes_(tz) {
  const now = new Date();
  return Number(Utilities.formatDate(now, tz, 'HH')) * 60 + Number(Utilities.formatDate(now, tz, 'mm'));
}

function addDaysKey_(key, days) {
  const p = key.split('-').map(Number);
  const dt = new Date(Date.UTC(p[0], p[1] - 1, p[2] + days));
  return Utilities.formatDate(dt, 'UTC', 'yyyy-MM-dd');
}

/** 1=월 … 7=일 */
function dowFromKey_(key) {
  const p = key.split('-').map(Number);
  const d = new Date(Date.UTC(p[0], p[1] - 1, p[2])).getUTCDay();
  return d === 0 ? 7 : d;
}

/** Date 객체 / 'yyyy-MM-dd' / '2026. 9. 8' 등을 yyyy-MM-dd 로 통일 */
function toDateKey_(v, tz) {
  if (v === undefined || v === null || v === '') return '';
  if (Object.prototype.toString.call(v) === '[object Date]') {
    return Utilities.formatDate(v, tz, 'yyyy-MM-dd');
  }
  const m = String(v).trim().match(/(\d{4})\s*[-./년]\s*(\d{1,2})\s*[-./월]\s*(\d{1,2})/);
  return m ? m[1] + '-' + pad2_(Number(m[2])) + '-' + pad2_(Number(m[3])) : '';
}

function formatDayLabel_(key) {
  const p = key.split('-').map(Number);
  return p[1] + '월 ' + p[2] + '일 (' + DOW_NAMES[dowFromKey_(key) - 1] + ')';
}

/** 시트를 헤더 이름으로 다룰 수 있게 읽어 옵니다. */
function readTable_(sheet) {
  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) { return String(h).trim(); });
  const index = {};
  headers.forEach(function (h, i) { if (h) index[h] = i; });
  const rows = lastRow > 1 ? sheet.getRange(2, 1, lastRow - 1, lastCol).getValues() : [];
  return { headers: headers, index: index, rows: rows, lastCol: lastCol };
}
